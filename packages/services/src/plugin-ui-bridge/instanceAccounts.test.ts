import { describe, expect, it, vi } from "vitest";
import type { NewApiOwner } from "@zcode/shared";
import { createPluginUiAccountBindings } from "./instanceAccounts.js";
const instance = { runtimeId: "agent", generation: 1, token: "one", appIdentity: "a".repeat(64) };
const params = {
  workspacePath: "/w",
  sessionId: "s",
  pluginId: "p",
  serverName: "server",
  scopeId: "view",
  resourceUri: "ui://app",
  ownerWebContentsId: 1,
};
describe("Host account identity", () => {
  it("uses stable account facts and revokes only captured old credentials", async () => {
    let account = "alice";
    const close = vi.fn(async () => {});
    const open = vi.fn(async () => instance);
    const owner = createPluginUiAccountBindings({
      readAccount: async () => ["provider", account],
      open,
      close,
    });
    await owner.open(params);
    await owner.open(params);
    expect(open.mock.calls[0]).toEqual(open.mock.calls[1]);
    owner.invalidate();
    account = "bob";
    await owner.open(params);
    expect(open.mock.calls[2]).not.toEqual(open.mock.calls[0]);
    expect(close).toHaveBeenCalledExactlyOnceWith({ ...params, instance });
  });
  it("closes an open result arriving after account revocation", async () => {
    const gate = Promise.withResolvers<typeof instance>();
    const entered = Promise.withResolvers<void>();
    const close = vi.fn(async () => {});
    const owner = createPluginUiAccountBindings({
      readAccount: async () => "alice",
      open: () => {
        entered.resolve();
        return gate.promise;
      },
      close,
    });
    const pending = owner.open(params);
    const rejected = expect(pending).rejects.toThrow("account changed");
    await entered.promise;
    owner.invalidate();
    gate.resolve(instance);
    await rejected;
    expect(close).toHaveBeenCalledExactlyOnceWith({ ...params, instance });
  });
  it.each([
    { userId: "bob", sid: "sid-b", authGeneration: 2 },
    { userId: "alice", sid: "sid-a-new", authGeneration: 2 },
  ])("fences Native owner changes to $userId/$sid", async (next) => {
    let account: NewApiOwner = {
      origin: "http://127.0.0.1:3001",
      userId: "alice",
      sid: "sid-a",
      authGeneration: 1,
    };
    const gate = Promise.withResolvers<typeof instance>();
    const entered = Promise.withResolvers<void>();
    const currentInstance = { ...instance, token: "current" };
    const open = vi.fn<Parameters<typeof createPluginUiAccountBindings>[0]["open"]>(
      async () => currentInstance,
    );
    open.mockImplementationOnce(() => {
      entered.resolve();
      return gate.promise;
    });
    const close = vi.fn(async () => {});
    const owner = createPluginUiAccountBindings({
      readAccount: async () => account,
      open,
      close,
    });
    const stale = owner.open(params);
    const rejected = expect(stale).rejects.toThrow("account changed");
    await entered.promise;
    account = { ...account, ...next };
    owner.invalidate();
    expect(await owner.open(params)).toEqual(currentInstance);
    expect(open.mock.calls[1]).not.toEqual(open.mock.calls[0]);
    gate.resolve(instance);
    await rejected;
    expect(close).toHaveBeenCalledExactlyOnceWith({ ...params, instance });
    owner.invalidate();
    expect(close).toHaveBeenLastCalledWith({ ...params, instance: currentInstance });
  });
});
