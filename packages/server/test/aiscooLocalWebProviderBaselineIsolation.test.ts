import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 使用真实的随包基线物化器，只替换 Host 装配与 HTTP 监听，验证入口实际写入的路径。
const state = vi.hoisted(() => ({
  appConfigDir: "",
  release: JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    config: {
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
}));
const mocks = vi.hoisted(() => ({
  createFactory: vi.fn(),
  createHost: vi.fn(),
  createHttpServer: vi.fn(),
}));
vi.mock("@zcode/services/node", async () => {
  // server 包不直接依赖 provider-node；按相对路径取真实物化器，避免加载完整 Host。
  const provider =
    await import("../../provider-node/src/zcode-builtin-provider-config-materializer.js");
  return {
    materializeZCodeBuiltinProviderConfig: provider.materializeZCodeBuiltinProviderConfig,
    createLocalWebNewApiAccountFactory: mocks.createFactory,
    createServerHostServices: mocks.createHost,
    createTopicResourcePeers: () => ({ getChannel: vi.fn() }),
    disposeServiceResourcesAndWait: vi.fn(async () => {}),
    getAppConfigDir: () => state.appConfigDir,
  };
});
vi.mock("../src/bundledZCodeBuiltinProviderConfig.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/bundledZCodeBuiltinProviderConfig.js")
  >("../src/bundledZCodeBuiltinProviderConfig.js");
  return { ...actual, readBundledZCodeBuiltinProviderConfig: () => state.release };
});
vi.mock("../src/http.js", () => ({
  createHttpServer: mocks.createHttpServer,
  resolveHttpServerId: () => "test-server",
}));

const sentinel = '{"desktop-or-cli":"sentinel"}\n';

describe("本机 Web Provider 基线物化路径", () => {
  let root: string;
  const servers = new Set<Server>();
  let signals: EventEmitter;
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    root = await mkdtemp(join(tmpdir(), "aiscoo-web-baseline-"));
    state.appConfigDir = join(root, "app-config");
    // 共享基线路径预置哨兵：其他 Host/CLI 使用它，本机 Web 不能改写。
    const shared = join(state.appConfigDir, "runtime", "provider", "bundled");
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, "zcode-builtin.json"), sentinel);
    mocks.createFactory.mockReset().mockResolvedValue({ dispose: vi.fn(async () => {}) });
    mocks.createHost.mockReset().mockResolvedValue({
      services: {},
      workspaceIdentityMapper: {},
      migrationFailedPathCount: 0,
    });
    mocks.createHttpServer
      .mockReset()
      .mockImplementation((_s, port: number, o: { host?: string }) => {
        const server = createServer();
        server.on("error", () => {});
        servers.add(server);
        server.listen(0, o.host);
        return server;
      });
    signals = new EventEmitter();
    const originalOn = process.on.bind(process);
    vi.spyOn(process, "on").mockImplementation(((event: string | symbol, listener: never) => {
      if (event === "SIGTERM" || event === "SIGINT") {
        signals.on(event, listener);
        return process;
      }
      return originalOn(event, listener);
    }) as typeof process.on);
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    vi.stubEnv("AISCOO_LOCAL_WEB_ORIGINS", "http://127.0.0.1:5174");
    vi.stubEnv("NEW_API_BASE_URL", "http://127.0.0.1:3001");
    vi.stubEnv("ZCODE_SERVER_HOST", "127.0.0.1");
    vi.stubEnv("HOST", "");
    vi.stubEnv("ZCODE_SERVER_AUTH_TOKEN", "");
    vi.stubEnv("PORT", "3030");
  });

  afterEach(async () => {
    // 本机 Web 入口登记了信号处理；经受控信号完成其清理，避免关闭流程在测试结束后调用真实 exit。
    if (signals.listenerCount("SIGTERM") > 0) {
      signals.emit("SIGTERM");
      await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    }
    await Promise.all([...servers].map((s) => new Promise<void>((r) => s.close(() => r()))));
    servers.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it("本机 Web 把随包基线写入 Web 私有根，共享基线保持原样", async () => {
    vi.stubEnv("AISCOO_LOCAL_WEB", "1");
    await import("../src/entry-http.js");
    await vi.waitFor(() => expect(mocks.createHost).toHaveBeenCalledTimes(1));
    const privatePath = join(
      state.appConfigDir,
      "local-web",
      "new-api",
      "runtime",
      "provider",
      "bundled",
      "zcode-builtin.json",
    );
    expect(mocks.createHost.mock.calls[0]![0].zcodeBuiltinProviderConfigFilePath).toBe(privatePath);
    expect((await stat(privatePath)).isFile()).toBe(true);
    await expect(
      readFile(
        join(state.appConfigDir, "runtime", "provider", "bundled", "zcode-builtin.json"),
        "utf8",
      ),
    ).resolves.toBe(sentinel);
  });

  it("未启用本机 Web 时仍使用共享基线路径", async () => {
    vi.stubEnv("AISCOO_LOCAL_WEB", "");
    await import("../src/entry-http.js");
    await vi.waitFor(() => expect(mocks.createHost).toHaveBeenCalledTimes(1));
    const shared = join(state.appConfigDir, "runtime", "provider", "bundled", "zcode-builtin.json");
    expect(mocks.createHost.mock.calls[0]![0].zcodeBuiltinProviderConfigFilePath).toBe(shared);
    await expect(readFile(shared, "utf8")).resolves.not.toBe(sentinel);
  });
});
