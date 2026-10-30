// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { WebSocket, WebSocketServer } from "ws";
import {
  ChannelServer,
  Emitter,
  ProxyChannel,
  SocketProtocol,
  VSBuffer,
  type ISocket,
} from "@zcode/rpc";
import { connectViaWebSocket } from "../../client/src/websocket.js";
import { ServiceChannels, type OAuthProviderId } from "@zcode/shared";
import { afterEach, expect, it, vi } from "vitest";
import { useOAuth } from "@/hooks/useOAuth.js";
import { aiscooLocalWebOAuthLifecycle } from "@/aiscoo/local-web-oauth/index.js";

interface Failure {
  provider: OAuthProviderId;
  state: string;
  reason: "expired" | "backend-unavailable" | "authorization-failed";
}
const mocks = vi.hoisted(() => ({
  oauth: null as unknown,
  platform: { aiscooLocalWebOAuthSync: true, openExternal: vi.fn(), registerOAuthState: vi.fn() },
  setOAuthPollingActive: vi.fn(),
  intl: { formatMessage: ({ id }: { id: string }) => id },
}));
vi.mock("@/hooks/useServices.js", () => ({ useServices: () => ({ oauthService: mocks.oauth }) }));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => mocks.platform }));
vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (select: (state: unknown) => unknown) =>
    select({ setOAuthPollingActive: mocks.setOAuthPollingActive }),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({ useZCodeIntl: () => ({ intl: mocks.intl }) }));
vi.mock("@/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/appTelemetry.js", () => ({ reportAppTelemetryEvent: vi.fn(async () => {}) }));

function wrapServerSocket(ws: WebSocket): ISocket {
  const data = new Emitter<VSBuffer>();
  const close = new Emitter<void>();
  ws.on("message", (raw) => data.fire(VSBuffer.wrap(new Uint8Array(raw as Buffer))));
  ws.on("close", () => close.fire());
  return {
    onData: data.event,
    onClose: close.event,
    onEnd: close.event,
    write: (buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(buffer.buffer);
    },
    end: () => ws.close(),
    dispose: () => ws.close(),
    drain: async () => {},
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("本机浏览器通过真实 WebSocket/ProxyChannel 收到授权失败并结束等待", async () => {
  vi.stubGlobal("WebSocket", WebSocket);
  const failures = new Emitter<Failure>();
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  let channelServer: ChannelServer | undefined;
  let socket: WebSocket | undefined;
  let clientSocket: globalThis.WebSocket | undefined;
  const received: string[] = [];
  server.on("connection", (peer) => {
    socket = peer;
    channelServer = new ChannelServer(new SocketProtocol(wrapServerSocket(peer)), "test");
    const channel = ProxyChannel.fromService({
      onDidFailAuthorization: failures.event,
      getProviders: async () => [{ id: "new-api", displayName: "Aiscoo", enabled: true, order: 0 }],
      getActiveProvider: async () => null,
      getLocalWebAuthorizationCapabilities: async () => {
        received.push("capabilities");
        return { failureEvents: true };
      },
      startOAuth: async () => {
        received.push("start");
        return {
          provider: "new-api",
          state: "rpc-flow",
          purpose: "primary-account",
          authorizeUrl: "https://example.test/authorize",
        };
      },
    });
    channelServer.registerChannel(ServiceChannels.OAuth, {
      ...channel,
      listen(ctx, event, arg) {
        received.push(`listen:${event}`);
        return channel.listen(ctx, event, arg);
      },
    });
  });
  try {
    const services = await connectViaWebSocket(`ws://127.0.0.1:${address.port}`, {
      onOpenSocket: (ws) => {
        clientSocket = ws;
      },
    });
    mocks.oauth = services.oauthService;
    Object.assign(mocks.platform, { oauthLifecycle: aiscooLocalWebOAuthLifecycle });
    const hook = renderHook(() => useOAuth());
    await waitFor(() => expect(hook.result.current.loadingProviders).toBe(false));
    await act(async () => hook.result.current.startLogin("new-api"));
    expect(hook.result.current.status).toBe("waiting");
    expect(received).toEqual([
      "capabilities",
      "listen:onDidFailAuthorization",
      "capabilities",
      "start",
    ]);
    act(() => failures.fire({ provider: "new-api", state: "rpc-flow", reason: "expired" }));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    expect(hook.result.current.error).toBe("login.oauth.loginFailure");
    hook.unmount();
  } finally {
    clientSocket?.close();
    socket?.terminate();
    channelServer?.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    failures.dispose();
  }
});
