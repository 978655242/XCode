export const oauthLifecycleModule = {
  id: "ui-oauth-lifecycle",
  requires: ["shared", "rpc"],
  provides: ["ui-oauth-lifecycle"],
  publicEntrypoints: ["contract.ts"],
} as const;
