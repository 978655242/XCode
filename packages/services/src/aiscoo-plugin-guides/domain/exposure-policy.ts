import type { ServiceExposurePolicy } from "../../collection.js";
import { IPluginGuideService } from "../contract.js";

/** Add the reviewed product channel at attachment assembly; preserve upstream policy defaults. */
export function withPluginGuideExposure(
  policy: ServiceExposurePolicy | undefined,
): ServiceExposurePolicy | undefined {
  return policy
    ? { allowedChannels: new Set([...policy.allowedChannels, IPluginGuideService.channelName]) }
    : undefined;
}
