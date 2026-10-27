export const xworkPluginGuidesProtocolModule = {
  id: "xwork-plugin-guides-protocol",
  requires: ["shared"],
  provides: ["xwork-plugin-guides-protocol"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
