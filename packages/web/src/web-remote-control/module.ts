// 依赖与 architecture-policy.yaml 同步；新增文件必须属于此 managed 边界。
export const webRemoteControlModule = {
  id: "web-remote-control",
  // XCODE: 品牌组件和静态模板通过公开契约投影，不改变远控身份与设备元数据。
  requires: [
    "client",
    "mobile-ui",
    "shared",
    "ui",
    "web",
    "web-remote-relay",
    "xwork-brand-ui",
    "xwork-brand",
    // XCODE: 保留历史依赖，追加指向相同品牌契约的新 ID。
    "aiscoo-brand-ui",
    "aiscoo-brand",
  ],
  provides: ["web-remote-control"],
  publicEntrypoints: [
    "index.ts",
    "contract.ts",
    "views.ts",
    "adapters/webRemoteControlThemeSeed.ts",
  ],
} as const;
