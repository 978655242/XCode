export const cliBrandModule = {
  id: "cli-brand",
  requires: ["zcode-cli", "xwork-brand"],
  provides: ["cli-brand"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
