// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:5174/"}
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { act, createElement, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roots: [] as Root[],
  connect: vi.fn(),
  renderRoot: vi.fn(),
}));

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      mocks.roots.push(root);
      return root;
    },
  };
});

vi.mock("@zcode/ui", () => ({
  AppErrorBoundary: ({ children }: { children: ReactNode }) => children,
  Root: (props: unknown) => {
    mocks.renderRoot(props);
    return createElement("div", { "data-testid": "app-root" });
  },
  generateMobileDeviceFingerprint: () => "local-web-test",
  installDocumentHiddenMotionPause: vi.fn(),
  playTaskNotificationSound: vi.fn(),
  setStreamClientId: vi.fn(),
  setWebRemoteControlTerminalTransportState: vi.fn(),
}));
vi.mock("@zcode/ui/aiscoo-startup-context", () => ({ createAiscooRoot: (root: unknown) => root }));
vi.mock("@zcode/ui/aiscoo-account-avatar", () => ({
  createAiscooAccountAvatarRoot: (root: unknown) => root,
}));
vi.mock("@zcode/ui/aiscoo-brand", () => ({
  AiscooIntlProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@zcode/client", () => ({ connectViaWebSocket: mocks.connect }));
vi.mock("@web/auth/WebLoginPage.js", () => ({
  WebLoginPage: () => createElement("div", { "data-testid": "official-remote-login" }),
}));
vi.mock("@web/share/ConversationShareLandingPage.js", () => ({
  ConversationShareLandingLoader: () => createElement("div", { "data-testid": "share-preview" }),
  ConversationShareLandingStatus: () => createElement("div", { "data-testid": "share-status" }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("VITE_AISCOO_LOCAL_WEB", "1");
  vi.stubEnv("VITE_WEB_REMOTE_CONTROL_ROUTE_PATH", "/remote/__test__");
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.lang = "en";
  document.body.innerHTML = '<div id="root"></div>';
  mocks.renderRoot.mockReset();
  mocks.connect.mockReset();
  mocks.connect.mockResolvedValue({ settingService: {}, broadcastService: {} });
});

afterEach(async () => {
  await act(async () => {
    for (const root of mocks.roots.splice(0)) root.unmount();
  });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function bootstrap(
  path: string,
  options: { cachedOfficialSession?: boolean; fetchImpl?: typeof fetch } = {},
) {
  window.history.replaceState(null, "", path);
  const fetch = vi.fn(
    options.fetchImpl ??
      (async (input: RequestInfo | URL) => {
        if (String(input) === "/api/local-web/session")
          return { ok: true, json: async () => ({ token: "a".repeat(43) }) } as Response;
        if (String(input) === "/api/server-info")
          return { ok: true, json: async () => ({}) } as Response;
        throw new Error(`Unexpected request: ${String(input)}`);
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const { WebAuthService } = await import("@web/auth/webAuthService.js");
  const { WebRemoteControlEntry } = await import("#src/web-remote-control/index.js");
  const handleCallback = vi
    .spyOn(WebAuthService.prototype, "handleCallback")
    .mockResolvedValue(null);
  const startLogin = vi.spyOn(WebAuthService.prototype, "startLogin");
  const getToken = vi
    .spyOn(WebAuthService.prototype, "getZCodeJwtToken")
    .mockReturnValue(options.cachedOfficialSession ? "official-session" : null);
  const startRemote = vi.spyOn(WebRemoteControlEntry.prototype, "start");
  if (options.cachedOfficialSession) startRemote.mockResolvedValue(undefined);
  await act(async () => {
    await import("@web/main.js");
    if (options.fetchImpl) {
      await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce(), { timeout: 5_000 });
    }
  });
  return { fetch, handleCallback, startLogin, getToken, startRemote };
}

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("本机 Web 路由边界", () => {
  it.each([
    "/remote",
    "/remote/",
    "/remote/v4",
    "/remote/v4/",
    "/remote/__test__?sid=secret-device",
    "/remote/v4?state=secret-state&code=secret-code",
    "/remote/v4/?state=secret-state&authCode=secret-code",
    "/remote/v4?state=secret-state&error=access_denied",
    "/share/callback?state=secret-state&code=secret-code",
    "/cn/share/callback?state=secret-state&authCode=secret-code",
    "/share/callback?state=secret-state",
    "/share/secret-share",
    "/cn/share/secret-share",
    "/unknown",
    "/?remote=secret-workspace",
    "/?remote=",
  ])("拒绝 %s 并且不触发官方流程或连接", async (path) => {
    const test = await bootstrap(path, { cachedOfficialSession: true });
    expect(document.body.textContent).toContain("not supported");
    expect(document.body.textContent).not.toMatch(/secret-|BigModel|Z\.ai/);
    expect(document.querySelectorAll("a")).toHaveLength(1);
    expect(document.querySelector("a")?.getAttribute("href")).toBe("/");
    expect(document.querySelector("button")).toBeNull();
    expect(document.querySelector('[data-testid="official-remote-login"]')).toBeNull();
    expect(document.querySelector('[data-testid="share-preview"]')).toBeNull();
    expect(test.handleCallback).not.toHaveBeenCalled();
    expect(test.startLogin).not.toHaveBeenCalled();
    expect(test.getToken).not.toHaveBeenCalled();
    expect(test.startRemote).not.toHaveBeenCalled();
    expect(test.fetch).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("server-info 重定向到其他端口时不转发本机会话令牌", async () => {
    const receivedTokens: Array<string | undefined> = [];
    const destination = createServer((request, response) => {
      receivedTokens.push(request.headers["x-aiscoo-local-web-token"] as string | undefined);
      response.setHeader("access-control-allow-origin", "*");
      response.end("{}");
    });
    const destinationPort = await listen(destination);
    const source = createServer((request, response) => {
      if (request.url === "/api/local-web/session") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ token: "a".repeat(43) }));
      } else if (request.url === "/api/server-info") {
        response.writeHead(302, { location: `http://127.0.0.1:${destinationPort}/sink` });
        response.end();
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    const sourcePort = await listen(source);
    const sourceOrigin = `http://127.0.0.1:${sourcePort}`;
    const nativeFetch = globalThis.fetch;
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(String(input), sourceOrigin);
      if (url.origin !== sourceOrigin) throw new Error("Unexpected initial request origin");
      return nativeFetch(url, init);
    };
    try {
      // 先证明该跨端口 302 可到达目标，并且缺省跟随时确实会转发自定义头。
      const probe = await nativeFetch(`${sourceOrigin}/api/server-info`, {
        headers: { "x-aiscoo-local-web-token": "probe" },
      });
      expect(probe.status).toBe(200);
      expect(receivedTokens).toEqual(["probe"]);
      receivedTokens.length = 0;

      const test = await bootstrap("/", { fetchImpl });
      expect(test.fetch).toHaveBeenCalledTimes(2);
      expect(test.fetch).toHaveBeenLastCalledWith(
        "/api/server-info",
        expect.objectContaining({ redirect: "error" }),
      );
      expect(receivedTokens).toEqual([]);
      expect(mocks.connect).toHaveBeenCalledOnce();
    } finally {
      await Promise.all([close(source), close(destination)]);
    }
  });

  it("中文环境提供本机不支持提示和返回首页", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("zh-CN");
    await bootstrap("/remote/v4");
    expect(document.body.textContent).toContain("本机 Web 不支持此页面");
    expect(document.querySelector("a")?.textContent).toContain("返回首页");
  });

  it("根页面先建立本机会话，再连接本机应用", async () => {
    const test = await bootstrap("/?view=default");
    expect(test.fetch).toHaveBeenNthCalledWith(1, "/api/local-web/session", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
    });
    expect(test.fetch).toHaveBeenNthCalledWith(2, "/api/server-info", {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: { "x-aiscoo-local-web-token": "a".repeat(43) },
    });
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.connect.mock.calls[0]?.[1]).toMatchObject({
      protocols: ["aiscoo-local-web-v1", `aiscoo-local-web-token.${"a".repeat(43)}`],
    });
    expect(mocks.renderRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: expect.objectContaining({ aiscooLocalWebOAuthSync: true }),
      }),
    );
    expect(document.querySelector('[data-testid="app-root"]')).not.toBeNull();
    expect(test.startRemote).not.toHaveBeenCalled();
    expect(test.handleCallback).not.toHaveBeenCalled();
  });
});

describe("非本机 Web 保持既有路由", () => {
  beforeEach(() => vi.stubEnv("VITE_AISCOO_LOCAL_WEB", "0"));

  it("远控路由仍显示原登录入口", async () => {
    const test = await bootstrap("/remote/v4");
    expect(test.startRemote).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-testid="official-remote-login"]')).not.toBeNull();
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it("官方 OAuth 回调仍交给原认证服务", async () => {
    const test = await bootstrap("/remote/v4?state=old-state&code=old-code");
    expect(test.handleCallback).toHaveBeenCalledExactlyOnceWith(window.location.href);
    expect(test.startRemote).not.toHaveBeenCalled();
  });

  it("分享路径仍进入原预览页", async () => {
    const test = await bootstrap("/share/example");
    expect(document.querySelector('[data-testid="share-preview"]')).not.toBeNull();
    expect(test.startRemote).not.toHaveBeenCalled();
    expect(test.handleCallback).not.toHaveBeenCalled();
  });
});
