export const aiscooBrowserAccountServerModule = {
  id: "aiscoo-browser-account-server",
  requires: ["services", "shared", "rpc"],
  provides: ["aiscoo-browser-account-server"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
