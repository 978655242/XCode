# Windows 页面左上角 Logo

## 范围

- Windows 桌面端的 `SettingsPage` 左上角补充应用 logo。
- 仅增加品牌标识，不新增点击行为，也不改变现有返回、打开工作区、设置分区等交互。

## 实现

- UI 使用 `packages/ui/src/WindowsTopLeftLogo.tsx`，渲染静态 `AiscooMark`；浅深主题使用同源 `ai` SVG，中性胶囊眼与原稿比例以 [Aiscoo 图标与显示名](../aiscoo/branding/icon-spec.md) 为准。
- `SettingsPage` 只在 `isWindowsDesktop` 条件下渲染该组件，继续保留顶部 `app-region:drag`。

## 桌面 Logo 样式迁移

- Windows/Linux 工作区左上角由 `DesktopTopOverlay` 展示 20px 静态 Aiscoo 应用图标；Windows 设置页在同尺寸占位中展示 20px 透明 `ai` 标志。两处保持各自现有容器，不再以旧渐变底座、13px SVG 作为当前视觉规格。
- 工作区保留现有 28px 点击区域、导航位置、侧栏切换回调及 hover 图标；键盘聚焦同样显示侧栏图标。设置页保留原有定位和展示语义，不新增点击行为。
- Logo 外部占位为 20px；工作区保留 28px 点击区域，设置页外部占位左上角保留 17px/19px，保持原中心点。启动页与职业引导页的默认 96px 容器消费同源 Aiscoo 资源；启动动效使用 10 秒胶囊眼、笑眼与整头弹跳循环，减少动态效果时回退静态标志。各入口布局与动静态选择以当前源码为准。
- 不迁移独立标题栏、原生窗控、面板按钮、圆角或留白。状态仍由现有 Sidebar owner 管理，不增加状态、协议或远程消息链路。
- 回归：组件测试验证静态 SVG、尺寸与默认 hero；SPT-E2E-000 验证工作区 Logo 尺寸、hover 与点击切换；UP-00 验证设置页 Logo 和双主题定位。运行结果在对应覆盖矩阵记录。E2E 前置复用本地账号控制面 mock，工作区使用标准启动准备 helper 等待首屏和跳过职业引导，不以修改产品登录状态或隐藏弹窗替代验证。

历史验证（2026-10-09，品牌迁移前）：当时验收尺寸为 20px 底座、13px SVG、4px 圆角、28px 工作区点击区。8 项组件测试、typecheck、typecheck:e2e、lint、架构检查通过；Windows SPT-E2E-000 run desktop-e2e-20261009074039183-p26228-1224c47db4432985、UP-00 run desktop-e2e-20261009074139434-p10168-0faa703391ebcbc2 均通过。该记录不代表现行 Aiscoo 图形已通过同一验收；现行品牌验证见 [迁移清单](../aiscoo/branding/aiscoo-migration.md)，原记录中的 Linux 真机验证待补。
