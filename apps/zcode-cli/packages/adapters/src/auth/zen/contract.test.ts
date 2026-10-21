import { describe, expect, it } from "vitest";
import { receiveAuthorization } from "./contract.example.js";
import type { ZenAuthorizationListener } from "./contract.js";

// 契约测试只 import contract 与 example，不依赖具体实现；由 tests/zen-contract.test.ts 纳入 CLI 测试入口。
describe("cli-zen-auth contract", () => {
  it("always closes the listener, including when waiting is canceled", async () => {
    let closed = 0;
    const listener: ZenAuthorizationListener = {
      redirectUri: "http://127.0.0.1:1/oauth/callback",
      wait: async (signal) => {
        signal?.throwIfAborted();
        return { code: "c", state: "s" };
      },
      close: async () => {
        closed++;
      },
    };
    await expect(receiveAuthorization(listener, new AbortController().signal)).resolves.toEqual({
      code: "c",
      state: "s",
    });
    await expect(receiveAuthorization(listener, AbortSignal.abort())).rejects.toThrow();
    expect(closed).toBe(2);
  });
});
