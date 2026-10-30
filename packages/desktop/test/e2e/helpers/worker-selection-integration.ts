import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  MutableAccountProviderConfigSource,
  ProviderConfig,
  ProviderConfigMap,
  ZhipuAccountAccessConfig,
  createAccountProviderConfigSnapshot,
  createFailClosedAccountProviderConfigSnapshot,
  type ModelSelectionViewInput,
} from "@zcode/provider";
import { NodeProviderRegistryRuntime, createNodeModelSelectionFacade } from "@zcode/provider-node";
import {
  createZCodeAgentService,
  createZCodeTaskServiceAdapter,
  getDataBaseDir,
  setDataBaseDir,
} from "@zcode/services/node";
import type { IModelSelectionService } from "@zcode/services";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";
import { createProjectService } from "../../../../services/src/project/index.js";
import { TaskIndexRepo } from "../../../../services/src/session/taskIndexRepo.js";
import { createZCodeTaskIndexSyncer } from "../../../../services/src/zcode-agent/zcodeTaskIndexSyncer.js";
import { getE2EAppDataPaths } from "./desktop-app.js";

type WorkerSelectionIntegration = {
  home: string;
  repo: TaskIndexRepo;
  projects: Awaited<ReturnType<TaskIndexRepo["getProjectRepository"]>>;
  workspacePath: string;
  projectId: string | null;
  additionalDirectories: string[];
  projectService: ReturnType<typeof createProjectService>;
  agent: ReturnType<typeof createZCodeAgentService>;
  task: ReturnType<typeof createZCodeTaskServiceAdapter>;
  modelSelectionService: Pick<IModelSelectionService, "getView" | "onDidChange">;
  selectAccount(providerId: string): Promise<void>;
  setDeliveryPaused(paused: boolean): Promise<void>;
  dispose(): Promise<void>;
};

/** 独立测试 Host + 真实 stdio Worker；仅账号上游和模型 HTTP 使用隔离 fixture。 */
export async function createWorkerSelectionIntegration(
  directory?: string,
  options: { workspacePath?: string; cliNodeArgs?: string[] } = {},
): Promise<WorkerSelectionIntegration> {
  const paths = getE2EAppDataPaths();
  // XCODE: 显式目录承担冷重开持久回归；默认调用仍独占随机 HOME，空目录复用该轮 E2E HOME。
  const home =
    directory === undefined
      ? await mkdtemp(join(paths.homeDir, "worker-selection-host-"))
      : join(paths.homeDir, directory);
  const workspacePath = options.workspacePath ?? join(home, "workspace");
  await mkdir(workspacePath, { recursive: true });
  const previousDataDir = getDataBaseDir();
  setDataBaseDir(home);
  const cleanup: Array<() => void | Promise<void>> = [() => setDataBaseDir(previousDataDir)];
  const dispose = async () => {
    const errors: unknown[] = [];
    for (const release of cleanup.splice(0).reverse()) {
      try {
        await release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Worker selection fixture cleanup failed");
  };
  try {
    const source = new MutableAccountProviderConfigSource();
    const deliverySource = new MutableAccountProviderConfigSource();
    let deliveryPaused = false;
    const runtimePaths = {
      zcodeBuiltinFilePath: resolve("../../config/provider/zcode-builtin.json"),
      personalFilePath: join(home, ".zcode/v2/provider_config.json"),
    };
    // XCODE: 新版账号请求保留 HTTPS endpoint，独立 Worker 也必须经当前隔离代理。
    const httpProxy = process.env.ZCODE_HTTP_PROXY?.trim();
    const caCertFile = process.env.ZCODE_AGENT_CA_CERT?.trim();
    if (!httpProxy || !caCertFile) throw new Error("Worker 选择回归缺少隔离 HTTPS 数据面代理");
    await mkdir(join(home, ".zcode/cli"), { recursive: true });
    await writeFile(
      join(home, ".zcode/cli/config.json"),
      JSON.stringify({ network: { httpProxy, caCertFile, noProxy: process.env.ZCODE_NO_PROXY } }),
    );
    const runtime = new NodeProviderRegistryRuntime({
      ...runtimePaths,
      accountSource: source,
      watch: false,
      personalPollingIntervalMs: false,
    });
    cleanup.push(() => runtime.dispose());
    await runtime.start();
    const config = await runtime.configService.read();
    const individual = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
    const team = BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan;
    const modelId = "GLM-5.3-Flash";
    async function selectAccount(providerId: string) {
      const base = createFailClosedAccountProviderConfigSnapshot(config);
      const providers = new Map(base.providers.entries());
      for (const id of [individual, team]) {
        providers.set(
          id,
          new ProviderConfig({
            access: new ZhipuAccountAccessConfig({ entitled: true }),
            builtinModelIds: [modelId],
          }),
        );
      }
      source.replace(
        createAccountProviderConfigSnapshot(
          config.zcodeBuiltinRevision,
          new ProviderConfigMap([...providers]),
          Object.fromEntries(
            [individual, team].map((id) => [
              id,
              { availability: "available" as const, entitled: true, current: id === providerId },
            ]),
          ),
        ),
      );
      await runtime.registryService.refresh("test-account-change");
      if (!deliveryPaused) deliverySource.replace(await source.read());
    }
    await selectAccount(individual);
    const facade = createNodeModelSelectionFacade(runtime.registryService);
    const modelSelectionService = {
      getView: async (input?: ModelSelectionViewInput) =>
        facade.getView(undefined, undefined, input),
      onDidChange: (listener: Parameters<typeof facade.onDidChange>[0]) => ({
        dispose: facade.onDidChange(listener),
      }),
    };
    const repo = new TaskIndexRepo();
    cleanup.push(() => repo.close());
    const projects = await repo.getProjectRepository();
    const projectService = createProjectService({
      repository: () => repo.getProjectRepository(),
      workspaceDirectory: join(home, "conversations"),
    });
    const project = projects.saveProject({
      name: "Worker selection fixture",
      roots: [workspacePath],
    });
    const prepared = await projectService.prepareSession({ projectId: project.id });
    const agent = createZCodeAgentService({
      // XCODE: 创建和恢复都必须经过同一真实项目库；缺少端口会在 CLI 执行前拒绝 Session。
      prepareSessionCreation: async (target, assertCurrentSync) => {
        const repository = await repo.getProjectRepository();
        assertCurrentSync?.();
        const prepared = repository.reserveCreatedTask({
          task: { ...target, taskId: target.sessionId },
          projectId: target.projectId,
          creationCommand: target.creationCommand,
          additionalDirectories: target.additionalDirectories,
        });
        return {
          sessionId: prepared.taskId,
          additionalDirectories: prepared.additionalDirectories,
        };
      },
      resolveSessionDirectories: async (target) =>
        (await projectService.resolveSessionDirectories({ ...target, taskId: target.sessionId }))
          .additionalDirectories,
      commandResolver: () => ({
        command: process.execPath,
        args: [
          ...(options.cliNodeArgs ?? []),
          resolve("../../apps/zcode-cli/packages/cli/dist/zcode.cjs"),
          "app-server",
          "--stdio",
        ],
        env: {
          HOME: home,
          USERPROFILE: home,
          ZCODE_DATA_BASE_DIR: home,
          // XCODE: 嵌套 Worker 的三条独立 CLI 路径不能继承父进程的数据目录。
          ZCODE_STORAGE_DIR: join(home, ".zcode"),
          ZCODE_SESSION_DB_PATH: join(home, ".zcode/cli/db/db.sqlite"),
          ZCODE_LOG_DIR: join(home, ".zcode/cli/log"),
          ZCODE_RUNTIME_ENV: "development",
          ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: runtimePaths.zcodeBuiltinFilePath,
          ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: runtimePaths.personalFilePath,
        },
      }),
      modelSelectionReadinessSource: modelSelectionService,
      accountProviderConfigSource: deliverySource,
      // 测试只核对选择合同；不使用真实账号、真实 secret 或外部 IM 网络。
      accountRequestAuthService: {
        resolveAccessCurrent: async () => ({
          type: "zhipu-account",
          family: "bigmodel",
          planKind: "team-coding-plan",
          productId: "product-team-a",
          organizationId: "org-team-a",
          projectId: "proj-team-a",
        }),
        resolveCurrent: async () => ({ apiKey: "e2e-fixture-key.synthetic-secret" }),
        assertCurrent: async () => {},
      },
      readRequestVerificationConfig: async () => null,
    });
    cleanup.push(() => agent.disposeAllAndWait());
    const syncer = createZCodeTaskIndexSyncer({ agentService: agent, taskIndexRepo: repo });
    cleanup.push(() => syncer.disposeAll());
    const task = createZCodeTaskServiceAdapter({
      zcodeAgentService: agent,
      taskIndexRepo: repo,
      taskIndexSyncer: syncer,
    });
    return {
      home,
      repo,
      projects,
      ...prepared,
      projectService,
      agent,
      task,
      modelSelectionService,
      selectAccount,
      async setDeliveryPaused(paused: boolean) {
        deliveryPaused = paused;
        if (!paused) deliverySource.replace(await source.read());
      },
      dispose,
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Worker selection fixture setup failed");
    }
    throw error;
  }
}
