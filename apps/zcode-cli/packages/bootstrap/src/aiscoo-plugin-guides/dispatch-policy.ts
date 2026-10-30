import { zcodeProtocolMethods } from "@zcode/shared";

export function isPluginGuideConcurrentMethod(method: string): boolean {
  return (
    method === zcodeProtocolMethods.xworkPluginGuideSource ||
    method === zcodeProtocolMethods.xworkWorkspaceStreamText
  );
}
