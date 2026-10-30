# Aiscoo 官网

直接打开 `index.html`，或从仓库根目录执行 `python3 -I -m http.server 18813 --bind 127.0.0.1 --directory website` 后访问 http://127.0.0.1:18813 。页面不需要安装依赖或构建。

`index.html` 是唯一静态页面文件（约 3.7 MB），内嵌全部 HTML、CSS、JavaScript、品牌 SVG、背景 PNG 和产品截图。本 README 与验证记录属于源码说明，不随页面发布；公开发布前仍需核实背景素材授权、正式域名及适用的备案或法律信息。

## 内容与素材依据

- Aiscoo 品牌：复用 `packages/ui/src/xwork/brand/assets/wordmark-dark.svg` 与 `mark-dark.svg`，内嵌内容与当前品牌资源逐字节一致。
- 工作区实图：复用 `docs/images/ui-plugins/excalidraw-canvas.png`。截图展示真实对话与 Excalidraw 画布，保留原始内容；界面细节可能随版本和主题变化。
- 背景：用户提供的 745×194 PNG，以 data URL 内嵌，SHA-256 为 `f8ccdbd5ed5ae9bc308fc20d0d12b200623733be13af6edfcaaaaefabd68ed08`。仓库未包含该素材的独立许可证明，不将提供素材等同于已确认公开分发授权。
- 产品能力与获取方式：依据项目 `README.md`、`UI_PLUGIN.md`、`docs/document-skills-plugin.md`；获取区链接源码和初始化、构建说明，不推断未核验的远端安装包发布状态。
- 运营主体：沿用 `packages/shared/src/xwork-brand/brand.json` 中的“杭州艾思酷国际贸易有限公司”，两种语言均保留原中文主体。第一方源码许可见根 [LICENSE](../LICENSE)，第三方范围见 [NOTICE.md](../NOTICE.md)；不自行补写备案号、法定英文名或协议地址。

## 页面交互

首页可自然向下滚动，依次阅读产品实图、使用场景、开发者、获取方式、关于与页脚。顶部导航、首屏按钮及向下浏览入口使用原生锚点链接；可直接访问 `#product`、`#scenarios`、`#developers`、`#download`、`#about`，也支持浏览器后退。主要内容不使用弹窗。

手机菜单在顶部展开，选择区块后收起；支持 Escape 关闭。场景标签在页面内切换，支持方向键、Home、End。开发者区可复制初始化命令。语言按钮更新中英文内容并保留场景选择。背景由一个 Web Animation 时钟驱动，点阵和按钮光环使用同一个纯函数节奏，支持暂停和系统减少动态效果偏好。

从仓库根目录执行 `node --test website/navigation.test.mjs`，检查常驻内容、原生链接、锚点目标以及禁止主要内容退回弹窗的合同。浏览器验证记录见 [VERIFICATION.md](VERIFICATION.md)。

独立规格见 [official-website.md](../docs/aiscoo/specs/official-website.md)。页面没有账号、会话或业务数据连接。
