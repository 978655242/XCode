import type { Event } from "@zcode/rpc";
import type {
  OfficialCloudConnectionSnapshot,
  OfficialCloudFamily,
  OAuthStartResponse,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IOfficialCloudConnectionService {
  readonly onDidChange: Event<void>;
  getSnapshot(): Promise<OfficialCloudConnectionSnapshot>;
  startOAuth(family: OfficialCloudFamily): Promise<OAuthStartResponse>;
  handleCallback(url: string): Promise<OfficialCloudConnectionSnapshot | null>;
  logout(): Promise<void>;
  refresh(): Promise<OfficialCloudConnectionSnapshot>;
}
export const IOfficialCloudConnectionService =
  createServiceDescriptor<IOfficialCloudConnectionService>(ServiceChannels.OfficialCloudConnection);
