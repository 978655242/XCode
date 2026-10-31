# Aiscoo 桌面身份修复验证

日期：2026-10-31。状态：身份改动已从原工作目录的 SHA-256 快照整合到独立发布工作目录；本文件保留原工作目录记录，不把历史结果当作当前发布基线的验证通过。

## 交付范围

- Desktop：原实现位于 `fix/aiscoo-desktop-identity`（base `691b3a4e`）；当前整合分支为 `feature/reviewed-local-work`，从 `origin/release` 的 `cd4af779` 开始，仅接入身份快照与已筛选的品牌/配置改动，不包含旧本机 Web Host 草稿。
- Aiscoo Admin：身份补丁已由提交 `92682035a` 合入本地 release `c3a3fd7bb`，保留当前客户端文案；是否部署仍需独立核验。
- 规格：[desktop-product-identity.md](./desktop-product-identity.md)。
- 最终 macOS 本地产物：`packages/desktop/dist/aiscoo-identity-final/mac-arm64/Aiscoo.app`。本地产物采用 ad-hoc 签名，`codesign --verify --deep --strict` 通过；没有 Developer ID 发布签名或公证。

## 修改后行为

正式版为 `dev.aiscoo.app` / `aiscoo://oauth/callback`；Dev 为 `dev.aiscoo.app.dev` / `aiscoo-dev://oauth/callback`；Preview 为 `dev.aiscoo.app.preview` / `aiscoo-preview://oauth/callback`。构建、Main、Host、Renderer 与系统声明复用只读 profile。

New API authorize、严格 callback parser 与 token exchange 绑定同一精确 redirect；保留内部 client ID 和 refresh/logout。Aiscoo Admin 的服务端与网页同时允许三个新完整回调及旧 `zcode://oauth/callback`，不放宽 CLI 回环和 Web origin。

Electron/业务数据、设置文件、Agent storage/db/log 按渠道隔离。设置队列/锁、账号 owner 和窗口路由沿用现有实现。早期硬件加速也读取选定设置文件；审查发现的旧 HOME 误读已用 RED→GREEN 回归修复。

macOS Finder、Linux desktop/MIME/图标按渠道独立，不清理 ZCode 或其他渠道的条目；Web 分享的 Aiscoo CTA 使用 aiscoo 协议，通用链接函数默认保留 zcode。

历史钥匙串名称保持，启动不自动迁移旧数据库或凭据。

## 当前发布工作目录验证

本轮以已安装 Node 24.18.0 / pnpm 10.33.2 执行定向验证；仓库固定版本仍是 Node 24.14.0。当前身份模块架构检查已通过（0 violations / 0 baseline / 0 new）。打包/数据隔离/深链、Main OAuth 投递与 Dev bundle 共 5 个 Node 文件 33/33 通过；`pnpm test:aiscoo` 的 Native redirect、settings path、Desktop/Web branding 与 CLI callback 共 5 文件 42/42 通过；`pnpm test:engineering` 的 desktopProductIdentity 与 devElectronAppBundle 共 2 文件 20/20 通过。随后在精确 Node 24.14.0 下新增冷启动回归：修复前真实启动 owner 错误预热旧 HOME 的 workspace A；Main 复用已选设置路径后预热渠道 workspace B，未注入仍沿用 HOME。该数据隔离文件 6/6 通过，定向 lint 为 0 errors / 3 warnings（Main 既有未使用导入）。根 typecheck、lint 和推送门禁由整合负责人统一运行，以最终命令输出为准。本轮未重新打包、注册协议、启动产品或操作钥匙串，未执行全套测试、真实账号登录和计费模型请求。

## 原身份工作目录记录（本轮未复验）

下表及后续 macOS 记录来自原工作目录的验证文档；没有对应当前发布基线的重新构建，不作为本轮测试通过或发布完成的依据。

| 检查                                                                                        | 实际结果                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 根 `pnpm typecheck`                                                                         | 最终通过；初次 TS6307 已通过追加新模块 include 修复                    |
| 根 `pnpm lint`                                                                              | 最终 0 errors / 308 warnings，未把 warnings 写成零                     |
| `pnpm architecture:check --changed`                                                         | 最终 0 violations / 0 baseline / 0 new                                 |
| 本次 56 个变更文件 `oxfmt --check`、两个仓库 `git diff --check`                             | 通过                                                                   |
| `pnpm test:unit:node`                                                                       | 最终 236/236；macOS launcher Python 回归 11/11                         |
| 精确 `pnpm test:aiscoo`：Native redirect、settings path、Desktop/Web branding、CLI callback | 5 文件 42/42                                                           |
| 打包/数据/深链工程回归                                                                      | 21/21；审查后硬件回归新增 1 项，已进入上述最终 Native 236/236          |
| 现有身份/开发包工程回归                                                                     | 27/27                                                                  |
| Desktop production build                                                                    | Main/Host/preload/scheduler/Renderer 全部成功                          |
| prepare desktop runtime assets                                                              | Agent、npm、native search、macOS helper 成功                           |
| Electron/PTY                                                                                | Electron 44.7.0、ABI149，真实 PTY spawn 成功                           |
| 最终 `electron-builder --config electron-builder.config.js --dir --publish never`           | 成功，native/runtime closure 检查通过                                  |
| Admin 后端定向授权回归                                                                      | 30 个测试组通过，仅合成隔离 SQLite fixture，无 schema/存储行为变更     |
| Admin 授权网页回归                                                                          | 124/124                                                                |
| Admin Go build、Web build、`tsgo -b`                                                        | 通过                                                                   |
| Admin 原 typecheck 脚本                                                                     | 失败：脚本调用不存在的 `bun check`；替代直接 tsgo 通过，未称原脚本通过 |
| Admin 全量 lint                                                                             | 151 errors / 66 warnings；两份变更 TSX 定向为 0 errors / 0 warnings    |

主仓验证使用 Node24.14.0 / pnpm10.33.2。Admin 的 go.mod 固定 Go1.26.10 下载超时，实际以已安装 Go1.27.2 验证；没有修改 go.mod 或宣称已验证1.26.10。Bun1.4.2。

## macOS 真实运行证据

最终包 Info.plist 精确为 `dev.aiscoo.app`、显示名称 Aiscoo、仅一个 scheme `aiscoo`。

NSWorkspace 实际查询：`aiscoo://oauth/callback` 指向本次最终 Aiscoo 包，`zcode://oauth/callback` 仍指向已安装 ZCode。Dev/Preview 未安装注册，不计作实机通过。

使用全新隔离运行根启动实际产品 Main/Host：主窗口创建、数据库终态 ready、设置和 session DB 写入隔离目录。真实 safeStorage 初始化新的测试私钥；正常退出后用同根重启，新窗口/Host/数据库 ready 且测试密钥文件 checksum 不变，证明当前新包能恢复该测试数据。没有读取或复制真实账号凭据，也未验证旧 bundle 真实密文迁移。

通过系统 `open` 投递合成未登记 state 的 aiscoo OAuth 回调；最终 Aiscoo Main 收到并记录“未匹配已登记 OAuth 身份或用途，忽略此次回调”。证明热启动协议送达正确应用且未知 state 未被接纳；不代表真实 code 兑换或账号登录成功。

最终 app 与当前 ZCode 同时运行。只退出和重启本任务创建的测试实例，未停止原 ZCode 或自有账号后端。

新增静态/合成验收 runner：`packages/desktop/test/runAiscooDesktopIdentityElectron.mjs`，默认只读最终包和 OS 映射。外部 fixture 的 `--synthetic` 未执行，不能与上述实际产品重启证据混为一谈。

## 未执行与发布前置条件

Admin 身份补丁已进入本地 release，运行中的自有账号后端是否已加载新白名单尚未核验。需要先确认部署，再完成浏览器主动确认 → aiscoo 回跳 → Host 换码 → 模型目录的真实 Native E2E。账号与费用授权未就绪时不自动调用计费模型。

Windows/Linux 实机安装及协议共存、Dev/Preview 的实机 handler、安装顺序矩阵、旧用户数据和凭据迁移均未验。BigModel/Z.ai 官方云依赖对应服务端和中转支持新回调，单独协调与验收，不能由自有 Native 白名单替代。

## 上游扩展与合并预演

新增逻辑集中在 `aiscoo-desktop-identity` 共享配置与桌面适配模块。以下存量上游文件没有可直接使用的品牌身份参数，因此在已有装配点增加配置读取、可选参数或最小调用；没有新建账号/队列 owner。

原工作目录曾记录 `git merge-tree --write-tree <preview> upstream/main` 为 exit 0，tree 为 `35ec080a220915492231f21f290bd254febf3237`；该历史对象不代表当前 `cd4af779` 发布工作目录的预演。本轮不会更新原工作目录的 index 或 refs；最终整合负责人须对实际 PR tree 重新执行上游合并预演并在 PR 描述记录结果。

| 上游文件                                                                       | 最小改动理由                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| packages/desktop/electron-builder.config.js                                    | 打包装配接入 profile，平台协议与 appId 一致      |
| packages/desktop/scripts/desktop-product-identity.mjs                          | 原导出点叠加 profile，保留环境/CUA/钥匙串契约    |
| packages/desktop/scripts/desktop-product-identity.d.mts                        | 既有声明同步 profile 字段                        |
| packages/desktop/scripts/devElectronAppBundle.mjs                              | 开发副本身份配置与缓存指纹，移除旧协议残留       |
| packages/desktop/src/host/index.ts                                             | 服务工厂增加可选 Native redirect 参数            |
| packages/desktop/src/main/desktopChromiumHardwareAccelerationBootstrap.ts      | 只增加可选设置文件参数，默认保持                 |
| packages/desktop/src/main/desktopEarlyChromiumHardwareAccelerationBootstrap.ts | 装配选定设置文件                                 |
| packages/desktop/src/main/desktopDataBaseDirBootstrap.ts                       | 只增加可选设置文件参数，原恢复 owner 不变        |
| packages/desktop/src/main/desktopEarlyDataBaseDirBootstrap.ts                  | 调用独立下游 bootstrap 包装                      |
| packages/desktop/src/main/desktopDeepLinkUrl.ts                                | scheme 常量从可选 profile 读取，未注入保持 zcode |
| packages/desktop/src/main/desktopOAuthDeepLink.ts                              | 注册和 Native canonical 校验读取同一 profile     |
| packages/desktop/src/main/desktopFinderOpenFolderWorkflow.ts                   | 配置级名称、协议、归属列表，防止清理其他产品     |
| packages/desktop/src/main/desktopLinuxAppImageIcon.ts                          | 可选 iconName，默认路径不变                      |
| packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts                  | 渠道 desktop/MIME/icon/归属列表配置              |
| packages/desktop/src/main/desktopRuntimeEnv.ts                                 | 数据名与已有 CLI storage/db/log 环境覆盖键接线   |
| packages/desktop/src/main/index.ts                                             | Windows AUMID 装配优先读取 profile               |
| packages/desktop/test/desktopProductIdentity.test.ts                           | 既有工程断言反映确认后的身份                     |
| packages/desktop/test/devElectronAppBundle.test.ts                             | 既有工程断言反映独立开发副本                     |
| packages/desktop/tsconfig.main.json                                            | 编译清单只追加独立适配模块；严格 JSON 不能写注释 |
| packages/desktop/tsup.config.ts                                                | 构建期追加渠道 define                            |
| packages/desktop/vite.config.ts                                                | Renderer 追加同源渠道 define                     |
| packages/services/src/node.ts                                                  | 服务工厂可选 redirect 注入                       |
| packages/services/src/setting/settingService.ts                                | 可选精确设置路径，实例创建时固定                 |
| packages/shared/package.json                                                   | exports 只追加身份子路径；严格 JSON 不能写注释   |
| packages/web/src/share/conversationSharePreviewClient.ts                       | 可选 scheme 参数，默认 zcode 保持                |
| packages/web/src/share/ConversationShareLandingPage.tsx                        | 下游 Aiscoo CTA 装配精确 scheme                  |

代码接线处使用 XCODE 中文原因注释。没有提交/推送/PR，因此上述材料是后续 PR 描述依据，不宣称已经完成远端合并或发布。
