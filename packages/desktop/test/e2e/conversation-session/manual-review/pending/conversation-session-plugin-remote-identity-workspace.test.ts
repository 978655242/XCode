import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getPluginList,
  getPluginReferenceCatalog,
} from "../../../helpers/plugin-management-lifecycle.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  createSSHLifecycleProvider,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readDualSSHRuntimeConfig,
  readHostProcesses,
  runSSHCommand,
  waitForRemoteTab,
  type SSHConnectionConfig,
} from "../../../helpers/ssh-remote-p0.js";
import { prepareV4ConversationE2E, selectV4TaskById } from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_WPL_010_REMOTE_IDENTITY";
const PLUGIN_NAME = "wpl-remote-identity";
const PLUGIN_ID = `${PLUGIN_NAME}@inline`;

type RemoteFixtureCommandResult = { code: number | null; stderr: string; stdout: string };

describe("WPL-010 remote Workspace Plugin identity/path authority E2E", () => {
  let providerA: SSHLifecycleProvider | null = null;
  let providerB: SSHLifecycleProvider | null = null;
  let targetA: SSHConnectionConfig | null = null;
  let targetB: SSHConnectionConfig | null = null;
  let workspacePath = "";

  after(async () => {
    // XCODE: 独占 fixture 的清理失败必须上报，不能吞掉路径拒绝或远端非零退出。
    const cleanupResults = await Promise.allSettled([
      providerA?.tunnel.close(),
      providerB?.tunnel.close(),
      targetA && workspacePath ? cleanupRemoteFixture(targetA, workspacePath, "A") : undefined,
      targetB && workspacePath ? cleanupRemoteFixture(targetB, workspacePath, "B") : undefined,
    ]);
    await browser.electron.restoreAllMocks();
    await clearAppData();
    const failures = cleanupResults.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        `${CASE_MARKER}: cleanup failed`,
      );
    }
  });

  it("reads the same path from each target while isolating catalog and runtime by identity", async function () {
    this.timeout(40 * 60_000);

    const dual = readDualSSHRuntimeConfig(CASE_MARKER);
    [targetA, targetB] = dual.targets;
    workspacePath = dual.workspacePath;
    await seedRemoteFixture(targetA, workspacePath, "A");
    await seedRemoteFixture(targetB, workspacePath, "B");

    const remoteConfigA = await readRemoteWorkspaceConfig(targetA, workspacePath);
    const remoteConfigB = await readRemoteWorkspaceConfig(targetB, workspacePath);
    expect(remoteConfigA).toContain('"marker": "A"');
    expect(remoteConfigA).not.toContain('"marker": "B"');
    expect(remoteConfigB).toContain('"marker": "B"');
    expect(remoteConfigB).not.toContain('"marker": "A"');

    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();
    expect(initialHosts).toHaveLength(1);

    providerA = await createSSHLifecycleProvider(targetA, `${CASE_MARKER}_A`);
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: targetA,
      label: "A",
      provider: providerA,
      workspacePath,
    });
    const workspaceCatalogA = await getPluginReferenceCatalog({
      workspaceIdentity: taskA.identity,
      workspacePath,
    });
    expectCatalogMarker(workspaceCatalogA.plugins, "A");
    const pluginA = (await getPluginList(workspacePath, taskA.identity)).plugins.find(
      (plugin) => plugin.id === PLUGIN_ID,
    );
    expect(pluginA).toMatchObject({
      configuredOptions: { marker: "A" },
      enabled: true,
      enabledSource: "workspace",
      rootPath: posix.join(workspacePath, "plugin"),
    });
    const sessionCatalogA = await getPluginReferenceCatalog({
      sessionId: taskA.taskId,
      workspaceIdentity: taskA.identity,
      workspacePath,
    });
    expect(sessionCatalogA.authority).toBe("session");
    expectCatalogMarker(sessionCatalogA.plugins, "A");

    // Bug 根因：两个 remote lifecycle provider 使用同一个测试 model id；若在连接 A 前
    // 连续创建 A/B，后创建的 B 会替换模型列表中的 A。按目标串行创建可保持真实切换顺序，
    // 同时避免测试夹具先于 identity 隔离断言互相覆盖。
    providerB = await createSSHLifecycleProvider(targetB, `${CASE_MARKER}_B`);
    const taskB = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: targetB,
      label: "B",
      provider: providerB,
      workspacePath,
    });
    const workspaceCatalogB = await getPluginReferenceCatalog({
      workspaceIdentity: taskB.identity,
      workspacePath,
    });
    expectCatalogMarker(workspaceCatalogB.plugins, "B");
    const pluginB = (await getPluginList(workspacePath, taskB.identity)).plugins.find(
      (plugin) => plugin.id === PLUGIN_ID,
    );
    expect(pluginB).toMatchObject({
      configuredOptions: { marker: "B" },
      enabled: true,
      enabledSource: "workspace",
      rootPath: posix.join(workspacePath, "plugin"),
    });
    const sessionCatalogB = await getPluginReferenceCatalog({
      sessionId: taskB.taskId,
      workspaceIdentity: taskB.identity,
      workspacePath,
    });
    expect(sessionCatalogB.authority).toBe("session");
    expectCatalogMarker(sessionCatalogB.plugins, "B");

    expect(taskA.workspacePath).toBe(taskB.workspacePath);
    expect(taskA.identity).not.toBe(taskB.identity);
    expect(taskA.remoteSessionId).not.toBe(taskB.remoteSessionId);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspacePath,
      expectedRemoteSessionId: taskA.remoteSessionId,
      requireActive: false,
    });
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskB.identity,
      expectedPath: workspacePath,
      expectedRemoteSessionId: taskB.remoteSessionId,
    });
    expect(await readHostProcesses()).toEqual(initialHosts);

    // 非活动 remote Session 不保留在当前 target 的 Agent 内；先经真实 task 导航切回 A，
    // 再查它的 session-owned catalog，证明 B 的异步加载没有覆盖 A 的 workspace-keyed 状态。
    await selectV4TaskById(taskA.taskId, 30_000);
    await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspacePath,
      expectedRemoteSessionId: taskA.remoteSessionId,
    });
    expectCatalogMarker(
      (
        await getPluginReferenceCatalog({
          sessionId: taskA.taskId,
          workspaceIdentity: taskA.identity,
          workspacePath,
        })
      ).plugins,
      "A",
    );
    expectCatalogMarker(sessionCatalogA.plugins, "A");
    expectCatalogMarker(sessionCatalogB.plugins, "B");
  });
});

async function seedRemoteFixture(
  target: SSHConnectionConfig,
  workspacePath: string,
  marker: "A" | "B",
): Promise<void> {
  assertAllowedRemoteWorkspace(workspacePath);
  const pluginRoot = posix.join(workspacePath, "plugin");
  const manifest = {
    name: PLUGIN_NAME,
    version: "0.0.0",
    description: `WPL-010 target ${marker}`,
    skills: "skills",
    userConfig: {
      marker: {
        type: "string",
        title: "Target marker",
      },
    },
  };
  const config = {
    plugins: {
      dirs: [pluginRoot],
      enabledPlugins: { [PLUGIN_ID]: true },
      options: { [PLUGIN_ID]: { marker } },
    },
  };
  const skill = [
    "---",
    `name: target-${marker.toLowerCase()}`,
    `description: WPL-010 target ${marker} runtime marker`,
    "---",
    "",
    `WPL_010_TARGET_${marker}`,
    "",
  ].join("\n");
  const command = [
    "set -eu",
    `rm -rf -- ${quoteShell(workspacePath)}`,
    `mkdir -p -- ${quoteShell(posix.join(pluginRoot, ".zcode-plugin"))}`,
    `mkdir -p -- ${quoteShell(posix.join(pluginRoot, "skills", "identity"))}`,
    `mkdir -p -- ${quoteShell(posix.join(workspacePath, ".zcode"))}`,
    writeBase64Command(
      posix.join(pluginRoot, ".zcode-plugin", "plugin.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
    writeBase64Command(posix.join(pluginRoot, "skills", "identity", "SKILL.md"), skill),
    writeBase64Command(
      posix.join(workspacePath, ".zcode", "config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    ),
  ].join(" && ");
  await runFixtureCommand(target, command, workspacePath, marker, "seed");
}

async function readRemoteWorkspaceConfig(
  target: SSHConnectionConfig,
  workspacePath: string,
): Promise<string> {
  const result = await runSSHCommand(
    target,
    `cat -- ${quoteShell(posix.join(workspacePath, ".zcode", "config.json"))}`,
  );
  expect(result.code).toBe(0);
  return result.stdout;
}

async function cleanupRemoteFixture(
  target: SSHConnectionConfig,
  workspacePath: string,
  marker: "A" | "B",
): Promise<void> {
  assertAllowedRemoteWorkspace(workspacePath);
  await runFixtureCommand(
    target,
    `rm -rf -- ${quoteShell(workspacePath)}`,
    workspacePath,
    marker,
    "cleanup",
  );
}

function assertAllowedRemoteWorkspace(workspacePath: string): void {
  // XCODE: seed 与 cleanup 共用严格目录授权；覆盖值本身也必须是本 case 专属 namespace。
  const allowedPath = process.env.ZCODE_E2E_WPL010_WORKSPACE?.trim() || "/workspace";
  if (
    (allowedPath !== "/workspace" &&
      !/^\/(?:home\/[a-zA-Z0-9_][a-zA-Z0-9_-]*|root)\/\.zcode-e2e\/wpl-010$/u.test(allowedPath)) ||
    workspacePath !== allowedPath
  ) {
    throw new Error(`${CASE_MARKER}: refusing to reset unexpected remote path`);
  }
}

async function runFixtureCommand(
  target: SSHConnectionConfig,
  command: string,
  workspacePath: string,
  marker: "A" | "B",
  phase: "seed" | "cleanup",
): Promise<void> {
  const artifactDir = process.env.ZCODE_E2E_ARTIFACT_DIR?.trim();
  if (!artifactDir)
    throw new Error(`${CASE_MARKER}: fixture evidence requires ZCODE_E2E_ARTIFACT_DIR`);
  const evidenceDir = artifactDir;
  await mkdir(artifactDir, { recursive: true });
  let result: RemoteFixtureCommandResult;
  try {
    result = await runSSHCommand(target, command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveFailure({ code: null, stdout: "", stderr: message });
    throw new Error(sanitize(message));
  }
  if (result.code !== 0 || result.stderr !== "") await saveFailure(result);
  expect(result.code).toBe(0);
  expect(sanitize(result.stderr)).toBe("");

  function sanitize(text: string): string {
    const credentials = [target.password, target.host, target.username].sort(
      (a, b) => b.length - a.length,
    );
    for (const value of credentials) {
      if (value) text = text.replaceAll(value, "[redacted]");
    }
    return text;
  }

  async function saveFailure(failure: RemoteFixtureCommandResult): Promise<void> {
    // XCODE: 先落盘原始退出证据的脱敏副本，再保留原断言；不记录目标配置或环境。
    await writeFile(
      join(evidenceDir, `wpl-010-${phase}-${marker}-failure-${Date.now()}.json`),
      `${JSON.stringify(
        {
          phase,
          target: marker,
          namespace: workspacePath,
          code: failure.code,
          stdout: sanitize(failure.stdout),
          stderr: sanitize(failure.stderr),
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
}

function expectCatalogMarker(
  plugins: Awaited<ReturnType<typeof getPluginReferenceCatalog>>["plugins"],
  marker: "A" | "B",
): void {
  const plugin = plugins.find((entry) => entry.pluginId === PLUGIN_ID);
  expect(plugin).toMatchObject({
    enabled: true,
    skillQualifiedNames: [`${PLUGIN_NAME}:target-${marker.toLowerCase()}`],
  });
  expect(plugin?.skillQualifiedNames).not.toContain(
    `${PLUGIN_NAME}:target-${marker === "A" ? "b" : "a"}`,
  );
}

function writeBase64Command(path: string, content: string): string {
  const encoded = Buffer.from(content, "utf8").toString("base64");
  return `printf '%s' ${quoteShell(encoded)} | base64 -d > ${quoteShell(path)}`;
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
