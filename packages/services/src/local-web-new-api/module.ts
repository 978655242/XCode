/**
 * local-web-new-api 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const localWebNewApiModule = {
  id: "local-web-new-api",
  requires: ["services", "shared", "zcode-cli", "cli-zen-auth"],
  provides: ["local-web-new-api"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
