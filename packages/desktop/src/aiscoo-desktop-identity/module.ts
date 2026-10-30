export const aiscooDesktopRuntimeModule = {
  id: "aiscoo-desktop-runtime",
  requires: ["aiscoo-desktop-identity"],
  provides: ["aiscoo-desktop-runtime"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
