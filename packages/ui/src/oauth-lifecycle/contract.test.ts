import { describe, expect, it } from "vitest";
import type { OAuthLifecyclePlatform } from "./contract.js";

describe("OAuth 生命周期合同", () => {
  it("未注入时保持可选", () => {
    const platform = {} as OAuthLifecyclePlatform;
    expect(platform.oauthLifecycle).toBeUndefined();
  });
});
