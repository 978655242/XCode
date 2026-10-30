import { describe, expect, it } from "vitest";
import { BROWSER_ACCOUNT_CHANNEL, BROWSER_ACCOUNT_OAUTH_METHODS } from "./contract.js";
import { createBrowserAccountBridge } from "./index.js";
import { aiscooBrowserAccountServerModule } from "./module.js";

describe("browser account server contract", () => {
  it("declares a fixed channel and OAuth allowlist without credential accessors", () => {
    expect(BROWSER_ACCOUNT_CHANNEL).toBe("aiscoo/browser-account");
    expect(new Set(BROWSER_ACCOUNT_OAUTH_METHODS).size).toBe(BROWSER_ACCOUNT_OAUTH_METHODS.length);
    expect(BROWSER_ACCOUNT_OAUTH_METHODS).not.toContain("getRelayCredential");
    expect(BROWSER_ACCOUNT_OAUTH_METHODS).not.toContain("withControlSession");
    expect(aiscooBrowserAccountServerModule.requires).toEqual(["services", "shared", "rpc"]);
  });

  it("has no usable credential authority without an attachment", async () => {
    const bridge = createBrowserAccountBridge("https://account.example.test/");
    expect(bridge.authority.getOwner()).toBeNull();
    await expect(bridge.authority.withControlSession(async () => "unused")).rejects.toThrow(
      "XCODE_BROWSER_ACCOUNT_UNAVAILABLE",
    );
    bridge.dispose();
  });
});
