export const xworkPluginGuidesServiceModule = {
  id: "xwork-plugin-guides-service",
  requires: ["services", "shared", "rpc", "provider", "xwork-plugin-guides-protocol"],
  provides: ["xwork-plugin-guides-service"],
  publicEntrypoints: ["index.ts", "contract.ts", "node.ts"],
} as const;
