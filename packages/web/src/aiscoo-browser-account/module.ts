export const aiscooBrowserAccountWebModule = {
  id: "aiscoo-browser-account-web",
  requires: ["shared", "services", "rpc"],
  provides: ["browser-new-api-account"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
