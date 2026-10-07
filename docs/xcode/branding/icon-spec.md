# XWork 图标与显示名

采用用户确认的断笔几何 X：保留 ZCode 图标的黑色渐变圆角底板、白色粗斜笔、原有字标外接矩形与留白。右上到左下为完整主笔，另一斜笔在交叉位置断开，切口与主笔平行。不修改供应商 ZAI/BigModel 标志。

品牌资源为唯一视觉来源；桌面 PNG/ICNS/ICO、Linux 多尺寸 PNG、Web favicon 和公共品牌图标同步更新。安装器保留黑色包装盒，仅替换盒面字标；DMG 背景组合字标使用 XWork，保留背景风格。UI 关于页、独立桌面 About 窗口、启动页、字标组合与草稿首页浅色/深色装饰图均使用断笔 X，保留尺寸、主题颜色与动画。产品显示名遵守下方统一规则。

验收：1024px 与 16/32px 均可辨识 X；透明边缘与原底板保留；各平台图标解码有效；启动页、桌面独立 About 窗口及首页两种主题不再显示 Z 字标。macOS 开发 .app 内的 CFBundleIconFile 指向当前产品 ICNS，缓存命中时仍同步图标，不因 Electron 二进制未变化而保留旧图标；不修改 node_modules。

按用户要求，首页装饰 X 恢复背景式展示：使用原有绝对定位、`min(72vw,25rem)` 尺寸和浅色向下渐隐遮罩；深色恢复原渐变描边与柔和填充。不再为图形增加文档流高度，不改变问候语与输入框原有位置。下半部淡出是此样式的预期效果；X 品牌路径及其他图标替换保持不变。

## 产品显示名

产品对用户显示的名称统一为 `XWork`，变体为 `XWork Preview`、`XWork Dev`、`XWork Desktop App`。适用范围包括所有语言文案、按钮与菜单、输入框提示、可访问性标签、页面/窗口标题、通知和错误提示、原生授权提示、安装器与应用展示名、运行时 Agent/CLI 提示和产品介绍。复用既有语言资源与产品身份配置，不通过运行时全局字符串替换覆盖外部内容。

本次仅迁移展示层：保留内部 `@zcode/*` 包名、导出符号、协议字段、请求来源身份、URL scheme、环境变量、数据库/目录 key、持久化分段标记、应用 ID、CLI 命令、服务端地址、仓库路径、`XCode-main` 分支和 `// XCODE:` 上游同步标记。用户项目/工作区名称、会话内容及历史数据不改写。历史 `XCode` / `ZCode` 错误文案、窗口标题和桌面条目只用于兼容识别，不再生成旧产品文案。上游来源 URL、法律归属和供应商 ZAI/BigModel 名称不属于本产品显示名，不伪造来源或归属。

验收：桌面应用/菜单/About、首页输入框、设置与引导、Web 标题和分享页面、通知/授权、安装器、CLI 帮助、TUI 字标与运行时文案均为 XWork；macOS Finder 服务新建为 `Open in XWork.workflow`，并仅在旧 workflow 的 bundle ID 属于本应用时移除 `Open in ZCode.workflow`。新生成内容不得再将产品称为 XCode 或 ZCode。实际启动和历史工作区恢复正常，已有草稿不丢失。

桌面展示身份与存储身份由 `desktopRuntimeEnv.ts` 统一派生。`app.setName` / `process.title` 使用 XWork 变体；`runtimeUserDataPath` / `runtimeSessionDataPath` 继续使用原数据身份，显式测试覆盖保持既有语义：

```mermaid
flowchart LR
  Flavor["打包状态 + product flavor"] --> Display["XWork / XWork Dev / XWork Preview"]
  Display --> Surface["OS 应用名、菜单和产品 UI"]
  Flavor --> Legacy["原存储身份 ZCode / Dev / Preview"]
  Legacy --> Paths["userData + sessionData"]
  Paths --> History["既有工作区、会话和草稿"]
```

## 生成与验证

生成脚本：`scripts/xcode/generate-icons.py`（Python + Pillow）。从仓库根目录执行，复用现有底板并导出平台资源。修改显示名后必须验证桌面真实 About 窗口、首页、Web、CLI/TUI 和历史数据恢复；正式安装包未实际运行的平台必须如实标注。
