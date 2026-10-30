# 机器人眼型与自动表情更新验证

2026-10-30。用户确认采用自动循环，仅优化圆形机器人及眼睛，并要求 ai / aiscoo、客户端 / 管理端同步。

## 当前修订：饱满笑眼、整头弹跳与 10 秒循环

用户批准第二轮方案后，将细描边笑眼改为宽 13.4 的闭合填充圆拱，使用圆润两端和内凹下沿。中性胶囊眼先收短，在 3.62 秒同时切换可见层，再展开笑眼；5.40 秒切回中性眼并于 5.55 秒恢复。两层使用互补的离散可见性，不交叉淡化。

`.head > .bounce > .tilt` 分别负责收起、整头跳动与偏头。3.52 秒蓄力纵压 6%，3.82 秒跳至 -8.2，4.10 秒落地纵压 5%，4.27 秒小回弹至 -2.1，4.50 秒恢复单位缩放。笑眼继续保持至 5.30 秒。`anim.py` 以秒定义 10 秒周期；原探出、眨眼、转眼与圆点跳动的绝对时刻保持，收起片段整体后移 2 秒：6.032 秒开始、6.224 秒到 -3、6.608 秒到 21。`ai._stretch` 仅保留给旧 `oo_preview.py` 实验预览的导入兼容，正式资源不再经过它。

### 本轮自动验证

| 检查 | 实际结果 |
| --- | --- |
| freshness、architecture changed | 通过；架构 0 violations |
| `pnpm typecheck` | 通过，Node 24.14.0 |
| `pnpm lint` | 退出码 0，0 errors / 319 warnings |
| 客户端定向 Vitest | 共 5 文件、66 项通过 |
| 客户端资源／机器人 Python | 9 + 3 项通过 |
| 管理端资源 Python／品牌 Vitest | 4 + 5 项通过 |
| 设计栅格／客户端发布／管理端同步只读检查 | 18 / 44 / 20 项一致 |
| 本轮修改前后静态栅格 SHA-256 | 86 / 86 字节一致，未重新导出设计栅格 |
| 两仓 `git diff --check` | 通过 |

共 87 项定向测试通过，未运行全量测试。子代理的只读验证环境禁止 Vite 写入 `.vite-temp`，曾使 Web 启动页 10 项跳过；随后主会话用原始 Vitest 命令单独执行该文件，10/10 通过。管理端 5 项使用 `--configLoader runner` 执行。管理端既有 typecheck／build:check／lint 失败见下方环境记录，本轮未修改管理端 TS/TSX，也未重复运行这三个命令。

### 本轮浏览器验收

- 使用生产 SVG 的同一时间轴检查两轮，每轮每 10ms 取样，共 1,001 个时刻；变换、眼高、可见性及圆点状态最大差为浏览器浮点误差 `7.4607e-14`，在 `1e-6` 容差内相同。20 秒接缝仍为 x=21 的收起姿态。
- 3.45–5.60 秒每 5ms 检查一次，两套眼睛从未同时可见。关键姿态验证了 3.6px 眨眼高度、-8.2 主跳、-2.1 回弹、4.50 秒单位缩放及 6.224/6.608 秒的 -3/21 收起位置；采样关键帧处于画布垂直边界内。
- 视觉检查 10 张分镜、浅深色 20/24/32/64px 笑眼和 240px 页头：厚圆拱可辨，其他字母与布局保持。390px 预览 `scrollWidth=390`，无横向溢出。
- 临时将生产 `prefers-reduced-motion` 规则作为生效分支置于预览样式末尾，确认所有动画为 none、头部 x=21、中性眼高 17.2、笑眼 opacity=0；检查后移除临时样式。此为 CSS 分支验证，未修改真实系统偏好。
- 管理端当前开发页刷新后，导航区两张浅深 `wordmark-animated` 图片均加载成功；从实际图片 URL 读取的资源均包含 10 秒周期、bounce 和闭合填充笑眼。
- 可播放交付为 `docs/brand/aiscoo/preview.html`（资源自包含），含两种主题、分镜和实际尺寸对照。本轮未重试上轮超时的浏览器录屏。

以下保留第一轮实施与环境记录；其中 8 秒周期和旧笑眼已由本节的 10 秒修订取代。

## 已实现范围

- 共享源 `docs/brand/aiscoo/source/ai.py` 使用宽 7.4、高 17.2、中心距 18 的竖胶囊眼，头部直径仍为 61。
- `source/anim.py` 添加约 216ms 短眨眼、约 336ms 笑眼停留，转头幅度约 3.5°，眼神先动。眨眼改变胶囊高度，避免把圆头压成尖线；笑眼与常态眼做短交叉淡变。
- 8 秒周期、探出／收起 peek 的全部关键帧与缓动、圆点 hop、其他字母、画布比例和裁剪边界均保持。静态及减少动态效果继续使用收起姿态。
- 18 个设计栅格、44 个客户端发布资产、20 个管理端品牌资产完成生成／同步。16 张设计 PNG、ICO 六档、ICNS 八个可解码尺度保持原尺寸与 alpha；眼区之外保持原图像素与阴影。
- 管理端继续使用现有 HeaderLogo 与静态／动态场景、自定义 Logo、主题与失败回退。未修改页面布局、业务组件或登录逻辑。

唯一设计源 → SVG／设计栅格 → Aiscoo 发布资产 → aiscoo-admin 复制分发。新增 `source/export_rasters.py` 与管理端 `electron/sync-brand-assets.py` 支持只读检查及隔离输出。

## 自动验证

| 检查 | 实际结果 |
| --- | --- |
| 工作区 freshness | 通过；当前功能分支无远端跟踪，工具跳过 behind-remote 检查 |
| `pnpm architecture:check --changed` | 通过，0 violations |
| `pnpm typecheck` | 通过，Node 24.14.0 |
| `pnpm lint` | 退出码 0，319 warnings / 0 errors；警告来自已有代码 |
| 品牌、登录、Web 启动、桌面启动主题定向 Vitest | 5 文件、66 项通过；有 jsdom Canvas 未实现提示 |
| `scripts/aiscoo/aiscoo-assets.test.py` | 9 项通过 |
| `scripts/aiscoo/robot-motion.test.py` | 3 项通过，包含机器人外部几何固定哈希、peek/hop 原值与共用眼型 |
| `source/export_rasters.py --check` | 18 项一致 |
| `scripts/aiscoo/generate-icons.py --check` | 44 项一致 |
| admin `electron/brand-assets.test.py` | 4 项通过，包含重复生成、跨仓一致性与只读拒绝过期资源 |
| admin 既有 `branding.test.tsx` | 5 项通过 |
| 两仓 `git diff --check` | 通过 |

以上定向自动测试共 87 项通过；未运行全量测试。

## 浏览器检查

- 本地 `preview.html`：检查浅深色 ai / aiscoo、收起静态姿态、侧看、眨眼、看圆点、笑眼与收回分镜；390px 宽度无横向溢出。
- 在浏览器中用同源 SVG 的 CSS animation currentTime 定位两个周期，验证 0、1.5、1.835、2.98、3.6、4.224、4.608 秒及下一轮对应时刻。两个周期状态一致，眨眼高度 3.6px、笑眼 opacity 1、收起预备位 -3px、收起位 21px，首尾一致。
- 管理端 390px 登录页确认新版完整字标加载；1280px 公共页确认浅深资源加载，临时切换 DOM 深色 class 观察后恢复，不写用户主题设置。
- 减少动态效果的资源接线与样式由定向测试检查；浏览器强制该 CSS 分支的最后一次操作超时，未取得成功结果，不能视为真实系统偏好的验收。
- 浏览器录屏超时，未生成可交付视频。交付为可播放 HTML 预览与关键帧分镜。

## 环境限制与既有失败

管理端原始命令 `bun run typecheck`、`bun run build:check` 均失败：`Script not found "check"`。当前 Bun 为 1.4.2，清单指定 1.4.4，脚本调用 `bun check -b`；未升级环境或改脚本。`bun run lint` 失败，151 errors / 66 warnings，位于已有 TS/TSX 等文件；本次仅同步资源、Python 脚本和说明。

补充诊断：使用现成 Node 24.14.0 与 Aiscoo 已安装的 TypeScript 6.0.2 对管理端 `web/tsconfig.json` 执行 `tsc -b` 通过；直接执行管理端现有 Rsbuild 2.1.6 build 通过。这不替代原命令失败事实。

当前 Aiscoo 源码的本地 Web 在 18792 返回 HTTP 200，启动 HTML 四张品牌图均内联新版 SVG。但现有后端拒绝该端口的 Host/Origin（403），完整 React 登录页、对话空态及原生桌面 E2E 本轮未实测；对应组件与启动接线已由定向测试覆盖。未修改白名单、登录状态或其他服务。

## 上游边界

本次逻辑位于 Aiscoo 品牌专属源和脚本，没有改写上游业务函数。以下上游既有二进制路径接收生成后的产品资源，沿用路径避免变更现有打包与运行时接口；二进制无法加入 XCODE 注释：

- `packages/desktop/build/`：`dmg_background.png`、`dmg_background@2x.png`、`icon.icns`、`icon.ico`、`icon.png`、`icon_installer.icns`、`icon_installer.ico`、`icon_installer.png`、`icon_windows.png`。
- `packages/desktop/build/icons/`：16/24/32/48/64/128/256/512/1024 的 `NxN.png`。
- `packages/web/public/favicon.ico`。
- `public/icon_512@2x.png`，`public/logo/icons/icon.icns`、`icon.ico` 及16/24/32/48/64/128/256/512/1024 的 `NxN.png`。

执行 `git merge-tree --write-tree --name-only HEAD upstream/main` 返回退出码 1，当前已提交基线存在多处上游冲突；该命令未包含本次未提交工作树，不能声称本次改动已通过完整合并预演。没有提交、推送或创建 PR，保留了原有无关本地修改。
