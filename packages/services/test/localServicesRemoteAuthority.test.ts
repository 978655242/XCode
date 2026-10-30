// XCODE: Aiscoo 专属回归；上游 App 业务套件已退役，仅保留下游差异的断言。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskIndexRepo as TaskIndexRepository } from "../src/session/taskIndexRepo.js";
const originalHome = process.env.HOME;
const tempHomes: string[] = [];
function makeTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "aiscoo-session-owner-"));
  tempHomes.push(home);
  return home;
}
function writeZCodeBuiltinProviderConfig(home: string): string {
  const configDir = join(home, ".zcode", "provider-test");
  mkdirSync(configDir, { recursive: true });
  const filePath = join(configDir, "zcodeBuiltin.json");
  writeFileSync(
    filePath,
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      config: {
        // 装配测试必须使用当前发布合同；上面的 config.json 才是待迁移的旧数据。
        providerConfigRules: { templateRules: [], providerRules: [] },
        modelConfigRules: {
          modelRules: [],
          modelApiRules: [],
          providerSiteRules: [],
          templateModelRules: [],
          builtinProviderModelRules: [],
        },
      },
    }),
    "utf-8",
  );
  return filePath;
}

afterEach(() => {
  process.env.HOME = originalHome;
  vi.restoreAllMocks();
  vi.resetModules();
  for (const home of tempHomes.splice(0))
    rmSync(home, { recursive: true, force: true });
});
describe("Aiscoo session reservation owner", () => {
  it("does not reserve a session when its owner changes while the repository becomes ready", async () => {
    const home = makeTempHome();
    process.env.HOME = home;
    const [
      { createLocalServices, disposeServiceResourcesAndWait },
      { IZCodeAgentService },
      { sessionCreateAdmission },
      { TaskIndexRepo },
    ] = await Promise.all([
      import("../src/node.js"),
      import("../src/index.js"),
      import("../src/zcode-agent/zcodeAgent.js"),
      import("../src/session/taskIndexRepo.js"),
    ]);
    const commandResolver = vi.fn(() => null);
    const services = createLocalServices({
      zcodeBuiltinProviderConfigFilePath: writeZCodeBuiltinProviderConfig(home),
      serviceAuthorityMode: "desktop-attached-remote",
      zcodeAgentCommandResolver: commandResolver,
      hostApiNetworkTransport: {
        fetch: vi.fn(async () => {
          throw new Error("Unexpected network request");
        }),
        dispose: () => {},
        disposeAndWait: async () => {},
      },
    });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let database: DatabaseSync | undefined;
    let current = true;
    let preparingSession = false;
    const assertCurrentSync = () => {
      if (!current) throw new Error("stale owner");
      preparingSession = true;
    };
    try {
      const getRepository = TaskIndexRepo.prototype.getProjectRepository;
      vi.spyOn(
        TaskIndexRepo.prototype,
        "getProjectRepository",
      ).mockImplementation(async function (this: TaskIndexRepository) {
        const gatePreparation = preparingSession;
        const repository = await getRepository.call(this);
        if (gatePreparation) {
          // XCODE: 观察同一服务持有的连接，不另起冷 Repo 与异步迁移争写锁。
          database = await this.getOrganizationDatabase();
          entered.resolve();
          await release.promise;
        }
        return repository;
      });
      const sessionId = "stale-owner-reservation";
      const pending = services.get(IZCodeAgentService).createSession({
        workspacePath: home,
        sessionId,
        [sessionCreateAdmission]: {
          assertCurrent: async () => {
            if (!current) throw new Error("stale owner");
          },
          assertCurrentSync,
          onCommitted: vi.fn(),
        },
      });
      const rejected = expect(pending).rejects.toThrow("stale owner");
      await entered.promise;
      current = false;
      release.resolve();
      await rejected;
      if (!database)
        throw new Error("Session preparation did not expose its database");
      expect(
        database
          .prepare("SELECT task_id FROM tasks WHERE task_id=?")
          .all(sessionId),
      ).toEqual([]);
      expect(commandResolver).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await disposeServiceResourcesAndWait(services);
    }
  });
});
