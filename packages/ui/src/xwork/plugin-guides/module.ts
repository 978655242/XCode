export const xworkPluginGuidesModule = {
  id: "xwork-plugin-guides-ui",
  requires: [
    "ui",
    "services",
    "shared",
    "xwork-plugin-guides-protocol",
    "xwork-plugin-guides-service",
  ],
  provides: ["xwork-plugin-guides-ui"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
