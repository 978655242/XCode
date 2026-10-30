import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelClient,
  ChannelServer,
  createQueuePair,
  Emitter,
  type IChannel,
  type IChannelClient,
} from "@zcode/rpc";
import type { NewApiOwner, OAuthSessionState } from "@zcode/shared";
import {
  BROWSER_ACCOUNT_CHANNEL,
  createBrowserAccountBridge,
  type BrowserAccountBridgeOptions,
  type BrowserAccountRestoreResult,
  type BrowserAccountSessionEvent,
} from "../src/aiscoo-browser-account/index.js";

const origin = "https://account.example.test";
const owner: NewApiOwner = { origin, userId: "1", sid: "session-a", authGeneration: 1 };
const nextOwner: NewApiOwner = { ...owner, userId: "2", sid: "session-b", authGeneration: 2 };
const restoreResult = (account: NewApiOwner | null = owner): BrowserAccountRestoreResult => ({
  owner: account,
  session: account
    ? {
        status: "authenticated",
        userInfo: { id: account.userId, username: "user", displayName: "User" },
      }
    : { status: "signed-out" },
});
const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose()),
);

function peer() {
  const events = new Emitter<BrowserAccountSessionEvent>();
  const call = vi.fn(async (command: string, _arg?: unknown): Promise<unknown> => {
    switch (command) {
      case "restore":
        return restoreResult();
      case "control":
        return { owner, accessToken: "test-control" };
      case "relay":
        return { token: "sk-test-relay", expiresAt: Date.now() + 60_000 };
      case "oauth":
        return undefined;
      default:
        throw new Error("unexpected command");
    }
  });
  const channel: IChannel = {
    call: <T>(command: string, arg?: unknown) => call(command, arg) as Promise<T>,
    listen: <T>(event: string) => {
      expect(event).toBe("session");
      return events.event as import("@zcode/rpc").Event<T>;
    },
  };
  const client: IChannelClient = {
    getChannel<T extends IChannel>(name: string): T {
      expect(name).toBe(BROWSER_ACCOUNT_CHANNEL);
      return channel as T;
    },
  };
  cleanups.push(() => events.dispose());
  return { client, channel, events, call };
}
function fixture(options: BrowserAccountBridgeOptions = {}) {
  const bridge = createBrowserAccountBridge(origin, options);
  const browser = peer();
  cleanups.push(() => bridge.dispose());
  return { bridge, authority: bridge.authority, browser };
}

// 连接身份与 owner 修订必须同时校验，避免断连或换号后的迟到凭据进入新请求。
describe("browser account reverse bridge", () => {
  it("restores over the existing RPC transport and exposes only OAuth methods", async () => {
    const { bridge, authority, browser } = fixture();
    const [serverProtocol, clientProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "browser");
    const client = new ChannelClient(clientProtocol);
    server.registerChannel(BROWSER_ACCOUNT_CHANNEL, {
      call: <T>(_ctx: string, command: string, arg?: unknown) =>
        browser.channel.call<T>(command, arg),
      listen: <T>(_ctx: string, event: string) => browser.channel.listen<T>(event),
    });
    cleanups.push(() => {
      client.dispose();
      server.dispose();
    });
    const changes: OAuthSessionState[] = [];
    authority.oauth.onDidChangeSession((state) => changes.push(state));
    await bridge.attach(client).ready;
    expect(authority.getOwner()).toEqual(owner);
    expect(changes).toEqual(["signed-in"]);
    expect(browser.call).toHaveBeenCalledExactlyOnceWith("restore", undefined);
    expect(Object.keys(authority.oauth)).not.toContain("getRelayCredential");
    expect(Object.keys(authority.oauth)).not.toContain("withControlSession");
    expect(Object.isFrozen(authority.getOwner())).toBe(true);
  });

  it("accepts the initial session echo before the full-duplex restore result and waits for its hook", async () => {
    const accepted = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const { bridge, authority, browser } = fixture({
      onOwnerChanged: () => {
        entered.resolve();
        return accepted.promise;
      },
    });
    const [serverProtocol, clientProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "browser");
    const client = new ChannelClient(clientProtocol);
    server.registerChannel(BROWSER_ACCOUNT_CHANNEL, {
      call: async <T>(_ctx: string, command: string) => {
        expect(command).toBe("restore");
        browser.events.fire({ owner });
        return restoreResult() as T;
      },
      listen: <T>(_ctx: string, event: string) => browser.channel.listen<T>(event),
    });
    cleanups.push(() => {
      client.dispose();
      server.dispose();
    });
    const changes: OAuthSessionState[] = [];
    authority.oauth.onDidChangeSession((state) => changes.push(state));
    const attached = bridge.attach(client);
    await entered.promise;
    expect(authority.getOwner()).toEqual(owner);
    expect(changes).toEqual([]);
    accepted.resolve();
    await attached.ready;
    expect(changes).toEqual(["signed-in"]);
  });

  it("rejects a second attachment synchronously and allows a new one after detach", async () => {
    const { bridge, authority, browser } = fixture();
    const attached = bridge.attach(browser.client);
    expect(() => bridge.attach(peer().client)).toThrow("XCODE_BROWSER_ACCOUNT_ATTACHED");
    await attached.ready;
    attached.dispose();
    expect(authority.getOwner()).toBeNull();
    const second = bridge.attach(peer().client);
    await second.ready;
    attached.dispose();
    expect(authority.isCurrent(owner)).toBe(true);
    bridge.dispose();
    expect(authority.getOwner()).toBeNull();
    expect(() => bridge.attach(browser.client)).toThrow("XCODE_BROWSER_ACCOUNT_DISPOSED");
  });

  it("rejects a late restore from a detached attachment even with the same new owner", async () => {
    const { bridge, authority, browser } = fixture();
    const pending = Promise.withResolvers<BrowserAccountRestoreResult>();
    browser.call.mockImplementationOnce(() => pending.promise);
    const old = bridge.attach(browser.client);
    const rejected = expect(old.ready).rejects.toThrow("XCODE_STALE_OWNER");
    old.dispose();
    await bridge.attach(peer().client).ready;
    pending.resolve(restoreResult());
    await rejected;
    expect(authority.getOwner()).toEqual(owner);
  });

  it.each(["control", "relay"])("rejects late %s after detach and replacement", async (command) => {
    const { bridge, authority, browser } = fixture();
    const attached = bridge.attach(browser.client);
    await attached.ready;
    const response = Promise.withResolvers<unknown>();
    browser.call.mockImplementationOnce(() => response.promise);
    const action = vi.fn(async () => "completed");
    const reading =
      command === "control"
        ? authority.withControlSession(action)
        : authority.getRelayCredential(owner);
    const rejected = expect(reading).rejects.toThrow("XCODE_STALE_OWNER");
    attached.dispose();
    await bridge.attach(peer().client).ready;
    response.resolve(
      command === "control"
        ? { owner, accessToken: "late-control" }
        : { token: "sk-late-relay", expiresAt: Date.now() + 60_000 },
    );
    await rejected;
    expect(action).not.toHaveBeenCalled();
  });

  it("invalidates an old read before the async owner hook completes", async () => {
    const accepted = Promise.withResolvers<void>();
    const hook = vi.fn((account: NewApiOwner | null) =>
      account?.sid === nextOwner.sid ? accepted.promise : undefined,
    );
    const { bridge, authority, browser } = fixture({ onOwnerChanged: hook });
    await bridge.attach(browser.client).ready;
    const changes: OAuthSessionState[] = [];
    authority.oauth.onDidChangeSession((state) => changes.push(state));
    const response = Promise.withResolvers<unknown>();
    browser.call.mockImplementationOnce(() => response.promise);
    const reading = authority.getRelayCredential(owner);
    const rejected = expect(reading).rejects.toThrow("XCODE_STALE_OWNER");
    browser.events.fire({ owner: nextOwner });
    expect(authority.isCurrent(owner)).toBe(false);
    expect(hook).toHaveBeenLastCalledWith(nextOwner);
    expect(changes).toEqual([]);
    response.resolve({ token: "sk-old-relay", expiresAt: Date.now() + 60_000 });
    await rejected;
    accepted.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(changes).toEqual(["signed-in"]);
  });

  it("fences the control action result after the action awaits", async () => {
    const { bridge, authority, browser } = fixture();
    await bridge.attach(browser.client).ready;
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<string>();
    const reading = authority.withControlSession(async (token, captured) => {
      expect(token).toBe("test-control");
      expect(captured).toEqual(owner);
      started.resolve();
      return finished.promise;
    });
    const rejected = expect(reading).rejects.toThrow("XCODE_STALE_OWNER");
    await started.promise;
    browser.events.fire({ owner: nextOwner });
    finished.resolve("late result");
    await rejected;
  });

  it("invalidates synchronously before the detach hook and delays signed-out until acceptance", async () => {
    const accepted = Promise.withResolvers<void>();
    const { bridge, authority, browser } = fixture({
      onOwnerChanged: (account) => {
        if (!account) {
          expect(authority.getOwner()).toBeNull();
          return accepted.promise;
        }
      },
    });
    const attached = bridge.attach(browser.client);
    await attached.ready;
    const changes: OAuthSessionState[] = [];
    authority.oauth.onDidChangeSession((state) => changes.push(state));
    attached.dispose();
    expect(authority.getOwner()).toBeNull();
    expect(changes).toEqual([]);
    accepted.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(changes).toEqual(["signed-out"]);
  });

  it("restores again for cached reads and projects away credential fields", async () => {
    const { bridge, authority, browser } = fixture();
    await bridge.attach(browser.client).ready;
    browser.call.mockResolvedValueOnce({
      ...restoreResult(),
      session: {
        status: "authenticated",
        userInfo: { id: "1", username: "user", displayName: "User", refreshToken: "never-return" },
        refreshToken: "never-return",
      },
      refreshToken: "never-return",
    });
    expect(await authority.oauth.restoreCachedSessionState()).toEqual(restoreResult().session);
    browser.call.mockResolvedValueOnce({
      token: "sk-test-relay",
      expiresAt: Date.now() + 60_000,
      refreshToken: "never-return",
    });
    expect(Object.keys(await authority.getRelayCredential(owner)).sort()).toEqual([
      "expiresAt",
      "token",
    ]);
    browser.call.mockResolvedValueOnce({ refreshToken: "never-return" });
    expect(await authority.oauth.refreshToken()).toBeUndefined();
    expect(browser.call).toHaveBeenLastCalledWith("oauth", { method: "refreshToken", args: [] });
  });

  it.each([
    { ...owner, origin: `${origin}/` },
    { ...owner, origin: "https://another.example.test" },
    { ...owner, userId: "0" },
    { ...owner, sid: " " },
    { ...owner, authGeneration: 0 },
    { ...owner, authGeneration: Number.MAX_SAFE_INTEGER + 1 },
    { ...owner, refreshToken: "must-not-retain" },
  ])("rejects invalid owner projection %#", async (invalidOwner) => {
    const { bridge, authority, browser } = fixture();
    browser.call.mockResolvedValueOnce({ ...restoreResult(), owner: invalidOwner });
    await expect(bridge.attach(browser.client).ready).rejects.toThrow("XCODE_PROTOCOL_INVALID");
    expect(authority.getOwner()).toBeNull();
  });

  it("rejects a control response for another owner and expired relay credentials", async () => {
    const { bridge, authority, browser } = fixture();
    await bridge.attach(browser.client).ready;
    browser.call.mockResolvedValueOnce({ owner: nextOwner, accessToken: "never-release" });
    const action = vi.fn();
    await expect(authority.withControlSession(action)).rejects.toThrow("XCODE_STALE_OWNER");
    expect(action).not.toHaveBeenCalled();
    browser.call.mockResolvedValueOnce({ token: "sk-expired", expiresAt: 1 });
    await expect(authority.getRelayCredential(owner)).rejects.toThrow("XCODE_SESSION_INVALID");
  });

  it("delegates one confirmed control-expiry refresh to the browser before retrying", async () => {
    const { bridge, authority, browser } = fixture();
    await bridge.attach(browser.client).ready;
    const expired = Object.assign(new Error("remote secret"), { code: "XCODE_ACCESS_EXPIRED" });
    const action = vi.fn().mockRejectedValueOnce(expired).mockResolvedValueOnce("retried");
    await expect(authority.withControlSession(action)).resolves.toBe("retried");
    expect(browser.call.mock.calls.map(([command]) => command)).toEqual([
      "restore",
      "control",
      "oauth",
      "control",
    ]);
    expect(browser.call.mock.calls[2]).toEqual([
      "oauth",
      { method: "refreshToken", args: ["new-api"] },
    ]);
    expect(action).toHaveBeenCalledTimes(2);
    browser.call.mockClear();
    await expect(authority.withControlSession(vi.fn().mockRejectedValue(expired))).rejects.toThrow(
      "XCODE_ACCESS_EXPIRED",
    );
    expect(browser.call.mock.calls.map(([command]) => command)).toEqual([
      "control",
      "oauth",
      "control",
    ]);
  });

  it("does not retry a control action if its browser refresh completes after owner change", async () => {
    const { bridge, authority, browser } = fixture();
    await bridge.attach(browser.client).ready;
    const refresh = Promise.withResolvers<unknown>();
    const started = Promise.withResolvers<void>();
    browser.call.mockImplementation(async (command) => {
      if (command === "control") return { owner, accessToken: "test-control" };
      if (command === "oauth") {
        started.resolve();
        return refresh.promise;
      }
      throw new Error("unexpected command");
    });
    const action = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("expired"), { code: "XCODE_ACCESS_EXPIRED" }));
    const reading = authority.withControlSession(action);
    const rejected = expect(reading).rejects.toThrow("XCODE_STALE_OWNER");
    await started.promise;
    browser.events.fire({ owner: nextOwner });
    refresh.resolve(undefined);
    await rejected;
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("sanitizes remote errors without retaining messages, stacks, or token data", async () => {
    const { bridge, authority, browser } = fixture();
    await bridge.attach(browser.client).ready;
    browser.call.mockRejectedValueOnce(
      Object.assign(new Error("secret-control secret-refresh"), {
        code: "UNRECOGNIZED-secret",
        data: { refreshToken: "secret-refresh" },
      }),
    );
    const error = await authority.getRelayCredential(owner).catch((error: unknown) => error);
    expect(error).toMatchObject({
      message: "XCODE_BROWSER_ACCOUNT_UNAVAILABLE",
      code: "XCODE_BROWSER_ACCOUNT_UNAVAILABLE",
    });
    expect(String((error as Error).stack)).not.toContain("secret");
    expect(error).not.toHaveProperty("data");
  });
});
