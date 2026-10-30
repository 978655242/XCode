import type { OAuthLifecyclePlatform } from "./contract.js";
import { aiscooLocalWebOAuthLifecycle } from "./index.js";

/** 仅在本机 Web 平台装配时启用。 */
export function attachLocalWebOAuth(platform: OAuthLifecyclePlatform): OAuthLifecyclePlatform {
  return Object.assign(platform, { oauthLifecycle: aiscooLocalWebOAuthLifecycle });
}
