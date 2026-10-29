/** XCODE: 下游品牌展示通过独立模块叠加，资源和文本保持单一事实源。 */
export const xworkBrandUiModule = {
  id: "xwork-brand-ui",
  requires: ["ui", "shared", "xwork-brand"],
  provides: ["xwork-brand-ui"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
