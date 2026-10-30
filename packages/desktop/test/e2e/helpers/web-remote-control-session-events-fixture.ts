import { join, resolve } from "node:path";
import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createFakeRelayV2 } from "@zcode/shared/testing/fake-relay-v2";
import { tmpdir } from "node:os";

export const WEB_REMOTE_CONTROL_FIXTURE_CREDENTIALS = {
  "oauth:active_provider": "zai",
  "oauth:zai:access_token": "mock-token",
  "oauth:zai:user_info": JSON.stringify({
    id: "zcode-e2e-user",
    username: "ZCode E2E",
    displayName: "ZCode E2E",
  }),
  zcodejwttoken: "mock-token",
};

/** 单窗口真实 OAuth owner → RPC → renderer → Main 回归，只替换外部 relay。 */
export async function prepareWebRemoteControlSessionEventsFixture(options: {
  credentialsFile: string;
  settingsFile: string;
  workspacePath: string;
  webUrl?: string;
  mobilePush?: boolean;
}): Promise<() => Promise<void>> {
  const relay = await createFakeRelayV2({
    users: { "mock-token": "zcode-e2e-user" },
    onHttp: (call) => {
      if (options.mobilePush && call.path === "/api/v1/remote/notification/status")
        return {
          status: 200,
          body: {
            code: 0,
            data: { protocol_version: 1, event_transport: "http", status: "available" },
          },
        };
      if (options.mobilePush && call.path === "/__e2e/push")
        return {
          status: 200,
          body: {
            messages: relay.messages,
            queries: relay.httpCalls.filter((x) => x.path === "/api/v1/remote/notification/status")
              .length,
          },
        };
      if (call.path.startsWith("/api/v1/remote/")) return;
      // 完整工作区会读取推荐场景；配置对象不能冒充场景数组，否则真实首页渲染会崩溃。
      if (call.path === "/api/v1/client/scenes")
        return { status: 200, body: { code: 0, msg: "", data: [] } };
      if (options.webUrl && !call.path.includes("config"))
        return {
          status: 503,
          body: { code: 503, msg: "not configured in mobile file-navigation fixture" },
        };
      return {
        status: 200,
        body: {
          code: 0,
          data: { configs: {}, builtinModels: [], config_version: "session-events" },
        },
      };
    },
  });
  const envPatch = {
    // 账号后台请求也必须走 loopback；合成凭据发到默认业务 API 会触发401并提前登出。
    ...(options.webUrl ? { VITE_ZCODE_E2E_STORE_BRIDGE: "1" } : {}),
    ZAI_BUSINESS_BASE_URL: relay.httpUrl,
    ZCODE_E2E_REMOTE_AUTH_GATE_URL: relay.httpUrl,
    ZCODE_BASE_URL: relay.httpUrl,
    ZCODE_ENDPOINT_ORIGIN: relay.httpUrl,
    ZCODE_TEST_BASE_URL: relay.httpUrl,
    ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL: relay.wsUrl,
    ZCODE_WEB_REMOTE_CONTROL_URL: `${relay.httpUrl}/remote/v4`,
  };
  const previous = Object.fromEntries(Object.keys(envPatch).map((key) => [key, process.env[key]]));
  Object.assign(process.env, envPatch);
  // XCODE: 当前 Web 与原生 watcher 由独立 Node child 持有，退出握手后才释放 relay。
  let web: ChildProcess | undefined;
  let webCacheDirectory: string | undefined;
  let webExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  let webClosed = false;
  let webStderr = "";
  let webPhase = "startup";
  // XCODE: 显式关闭与失败后的 finally 共用同次关闭，不能重复关闭 relay 掩盖原始错误。
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= closeResources());
  async function closeResources() {
    try {
      if (web) {
        if (web.connected) web.send({ type: "close" });
        const result = await webExit!;
        if (result.code !== 0 || !webClosed) {
          throw new Error(
            `Mobile Web fixture failed to close during ${webPhase}: ${result.code ?? result.signal}\n${webStderr}`,
          );
        }
      }
    } finally {
      try {
        await relay.close();
      } finally {
        try {
          // child 已退出，原生优化器不再持有 cache 的 mmap/文件句柄。
          if (webCacheDirectory) {
            if (webExit) await webExit;
            await rm(webCacheDirectory, { recursive: true, force: true });
          }
        } finally {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
    }
  }
  try {
    if (options.webUrl) {
      webCacheDirectory = await mkdtemp(join(tmpdir(), "zcode-web-remote-vite-"));
      web = fork(
        resolve(import.meta.dirname, "../fixtures/web-remote-control-frontend.mjs"),
        [webCacheDirectory, new URL(options.webUrl).port || "5173"],
        {
          cwd: resolve(import.meta.dirname, "../../../../../packages/web"),
          env: { ...process.env, NO_COLOR: "1" },
          execArgv: [],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      const child = web;
      const exit = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
      webExit = exit.promise;
      child.once("close", (code, signal) => exit.resolve({ code, signal }));
      child.stderr!.on("data", (chunk) => {
        webStderr += String(chunk);
      });
      const ready = Promise.withResolvers<string>();
      child.once("error", ready.reject);
      child.once("close", (code, signal) =>
        ready.reject(
          new Error(`Mobile Web fixture exited before ready: ${code ?? signal}\n${webStderr}`),
        ),
      );
      child.on("message", (message: { type?: string; origin?: string; phase?: string }) => {
        if (message.type === "ready" && message.origin) ready.resolve(message.origin);
        if (message.type === "closed") webClosed = true;
        if (message.type === "stage" && message.phase) webPhase = message.phase;
      });
      const origin = await ready.promise;
      process.env.ZCODE_WEB_REMOTE_CONTROL_URL = new URL(
        new URL(options.webUrl).pathname,
        origin,
      ).href;
    }
    await writeFile(
      options.credentialsFile,
      JSON.stringify(WEB_REMOTE_CONTROL_FIXTURE_CREDENTIALS),
      { mode: 0o600 },
    );
    const settings = JSON.parse(await readFile(options.settingsFile, "utf8"));
    await writeFile(
      options.settingsFile,
      JSON.stringify({
        ...settings,
        zcodeEndpointOrigin: relay.httpUrl,
        webRemoteControlLastEnabledContext: options.mobilePush
          ? undefined
          : { workspacePath: options.workspacePath },
      }),
    );
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
