export const aiscooLocalWebOAuthUiModule = {
  id: "aiscoo-local-web-oauth-ui",
  requires: ["ui", "shared", "rpc", "ui-oauth-lifecycle"],
  provides: ["aiscoo-local-web-oauth-ui"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
