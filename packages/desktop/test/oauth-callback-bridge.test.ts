import { describe, expect, it, vi } from "vitest";
import { createOAuthCallbackHandler } from "../src/preload/oauthCallbackBridge.js";

describe("oauth callback bridge", () => {
  it("notifies main process after async callback resolves", async () => {
    const notifyHandled = vi.fn();
    const payload = {
      url: "zcode://oauth/callback?code=123",
      provider: "bigmodel" as const,
      purpose: "official-cloud" as const,
    };
    const callback = vi.fn(async (_event: typeof payload) => {});
    const handler = createOAuthCallbackHandler(callback, notifyHandled);

    await handler({}, payload);

    expect(callback).toHaveBeenCalledWith(payload);
    expect(notifyHandled).toHaveBeenCalledTimes(1);
  });

  it("still notifies main process when callback rejects", async () => {
    const notifyHandled = vi.fn();
    const callback = vi.fn(async () => {
      throw new Error("callback failed");
    });
    const handler = createOAuthCallbackHandler(callback, notifyHandled);

    await expect(
      handler(
        {},
        {
          url: "zcode://oauth/callback?code=123",
          provider: "bigmodel",
          purpose: "official-cloud",
        },
      ),
    ).resolves.toBeUndefined();
    expect(notifyHandled).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledOnce();
  });

  it.each([
    "zcode://oauth/callback?code=123",
    { url: "zcode://oauth/callback?code=123", provider: "bigmodel" },
    { url: "zcode://oauth/callback?code=123", provider: "new-api", purpose: "official-cloud" },
  ])("acknowledges but does not deliver an unbound callback: %j", async (payload) => {
    const callback = vi.fn();
    const notifyHandled = vi.fn();
    await createOAuthCallbackHandler(callback, notifyHandled)({}, payload);
    expect(callback).not.toHaveBeenCalled();
    expect(notifyHandled).toHaveBeenCalledOnce();
  });
});
