import type { OAuthLifecycleExtension, OAuthLifecyclePlatform } from "./contract.js";

/** 产品装配时显式注入；缺省不干预现有行为。 */
export function withOAuthLifecycle(
  platform: OAuthLifecyclePlatform,
  lifecycle: OAuthLifecycleExtension,
): OAuthLifecyclePlatform {
  return Object.assign(platform, { oauthLifecycle: lifecycle });
}
