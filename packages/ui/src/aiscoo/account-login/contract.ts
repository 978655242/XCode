import type { IServiceAccessor } from "@zcode/services";
import type { IPlatformService } from "@zcode/shared";
import type { OAuthLifecyclePlatform } from "@/oauth-lifecycle/contract.js";

/** 只读产品装配，不拥有账号、凭据、pending flow 或第二份身份状态。 */
export interface AiscooAccountLoginAssembly {
  services(services: IServiceAccessor): IServiceAccessor;
  platform(platform: IPlatformService): OAuthLifecyclePlatform;
}
