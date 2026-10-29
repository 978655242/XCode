export const cliBrandModule = {
  id: "cli-brand",
  requires: ["zcode-cli", "aiscoo-brand"],
  provides: ["cli-brand"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
