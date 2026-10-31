/**
 * aiscoo-desktop-identity 模块清单（architecture-governance managed 模块）。
 * 层：domain。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const aiscooDesktopIdentityModule = {
  id: "aiscoo-desktop-identity",
  requires: [],
  provides: ["aiscoo-desktop-identity"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
