# 上游同步记录

流程见 [`BRANCHING.md`](./BRANCHING.md) 第 4 节。每次同步追加一节，最新的在最上面。

已同步到：`upstream/main` @ `a60ba6a7`（ZCode v3.17.1；同步分支已集成，合入 release 以同步 PR 状态为准）

## 模板

```markdown
## YYYY-MM-DD 同步 upstream <版本> (<旧 SHA>..<新 SHA>)

- 同步 PR：#
- 执行人：

| 上游提交 | 说明 | 分类（采纳/适配/拒绝） | 备注 / 拒绝原因 |
| -------- | ---- | ---------------------- | --------------- |

冲突文件及取舍：

- `path/to/file`：

单独 cherry-pick 的提交（如有）：
```

## 2026-10-30 同步 upstream v3.17.1 (3c5b2276..a60ba6a7)

- 状态：上游与最新 release 已通过 merge commit 集成，待同步 PR 评审；必须使用 Create a merge commit，不能 squash 或 rebase。
- 同步分支：`sync/upstream-20261030`，从 `origin/release` @ `b5333ac1` 切出；整体合并上游并保留原始 SHA，不 cherry-pick。

| 上游提交   | 说明                                                                                     | 分类（采纳/适配/拒绝） | 备注 / 拒绝原因                                      |
| ---------- | ---------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------- |
| `a60ba6a7` | v3.17.1：远端数据同步、项目管理、任务重启、提供商与模型配置、Electron 升级及工程测试调整 | 采纳并适配             | 整体 merge；保留 Aiscoo 品牌、New API 与既有下游扩展 |

同步约束与验收依据：

- 复用新版公开契约、数据同步与运行时单一 owner；New API 主账号和官方云连接各自持有原有凭据/代次，不新增认证缓存或接受队列。
- 桌面 `desktop-continuous` 与手机 `web-remote-replayable` 继续通过原 Host attachment 与 owner/lease 路由；身份使用 `workspaceIdentity?.trim() || workspacePath`。
- 上游退役的业务单测采用新版工程测试入口；Aiscoo 专属回归保留独立入口，不能为通过门禁削弱断言或恢复已移除业务模块。
- 运行类型、Lint、架构、schema、CLI 及相关 Aiscoo 回归；桌面/远控涉及的协议适配需提供可重复场景，环境限制如实登记。

```text
Renderer / 手机输入 → 可信 attachment → Host owner/lease → CLI CommandInbox
New API 账号 owner → 已核验会话事件 → Provider 投影 / worker 配置
独立官方云连接 → 原命名空间凭据 → 官方 MCP / 闲时任务
```

冲突文件及取舍：

- CLI bootstrap/core：采用新版生命周期 owner、同轮通知与完整 prompt 合同；保留 New API 请求期凭据 fence。分享导入已提交后即使初始化与关闭同时失败，仍返回 `sharedImportCommit`，保留聚合 cause，不重复清理持久资源；`provider-regression` 仅读取显式静态 Key。
- services/Host：任务创建适配 `{ sessionId, additionalDirectories }` 与 `creationCommand`，保留同步 owner fence；官方 MCP 采用新版 `plugin-command` 模式并继续独立凭据 namespace；闲时过期采用失败收口和手动 Continue，保留 expectedTask CAS、核销 outbox 与 handoff。
- UI/Web：采用数据同步、新职业引导、session config pending 与生命周期恢复；品牌、法律信息、Native 额度、模型菜单与插件指南仍由各自扩展装配，不恢复删除的旧 onboarding。
- Desktop：融合新版 provider provisioning、手机 MCP allowlist 与指南访问策略；Electron 开发包在品牌资源与入口就绪后签名，缓存指纹升为 format=4；迁移 E2E/helper 的 imports 与模型菜单断言。
- 工程与许可：采用上游 engineering-only 清单、四份模块契约和 App 单测退役；只迁出已有 Aiscoo 场景到独立 `test:aiscoo`，原生回归仍单独执行。依赖锁与许可清单由工具生成，下游 UI 回归保留原测试库。

阶段验证（合入同步期间新到的 release 前）：

- Node 24.14.0、pnpm 10.33.2；根 Lint 0 errors / 310 warnings；CLI Lint 0 errors / 54 warnings；CLI 34 包 typecheck 与构建通过。
- 完整 Aiscoo Node 回归 198/198、本机启动器 9/9；UI/Web 23 文件 178/178；services/protocol 11 文件 105/105；Desktop 专属 4 文件 30/30，开发包工程 10/10；架构工程回归 53/53，schema 8/8 与两份 baseline 兼容。
- CLI 定向首轮 18 文件 395/396，唯一 workflow 稳定归档标识失败已修并补跑；workflow/项目凭据 22/22、共享导入 5/5、Provider 工具 30/30、SEA 资产 44/44 最终通过。
- 关键账号边界定向 63/63；覆盖 desktop-continuous / web-remote-replayable、同步事务 precommit fence、官方云在途换号及手动 Continue。
- 根 typecheck 最后一个 E2E 返回类型注解已修，最终整体验证待接入最新 release 后执行。真实 Electron 首个上下文场景通过，周期详情旧夹具预期已按规格修正；完整八组及钥匙串验收尚待最终结果。
- 工程 affected 官方选择 157/157，按上游合同明确跳过，未执行全量工程套件；不将此记为测试通过。许可标识与声明新鲜度检查通过，仍有上游既有 19 项材料需发布前复核。
- 同步期间 `release` 新增 PR #48（浏览器持有凭据），随后以 merge commit 整合，最终验证和 PR 链接在提交前补齐。

最终整合验证：

- `release` @ `855579e8`（PR #48）已由 merge commit `3d9e5c54` 整合；上游原始提交仍可达。远端 `origin/main` 已快进至 `a60ba6a7`，与 `upstream/main` 完全相同。
- 根 `pnpm typecheck`、`pnpm lint`（0 errors / 308 warnings）、完整 `pnpm architecture:check`（0 违规）、CLI 34 包 typecheck/rebuild、Web build 与桌面 Main/Host/preload 编译通过。
- 下游独立 Vitest 63 文件 496/496；完整原生账号回归 198/198、本机启动器 9/9；浏览器启动配置 6/6、真实 Git 推送钩子 15/15。最终套件包含浏览器 owner→Registry→真实 CLI 回环模型请求，未发外部计费请求。
- 最终测试夹具按新版真实协议适配：Agent 能力协商、Source Server 必填 ROOT 与 glibc 告警继续、手机 Terminal 已开放但 provisioning/source management 仍拒绝；旧失败与修复依据保留，不降低产品断言。
- `git merge-tree --write-tree --name-only HEAD upstream/main` 退出 0，无冲突。同步总量包含大量原样上游测试退役与工程改动；PR 附完整上游路径清单与实际下游适配理由。
- Electron 44 真实上下文、周期详情、handoff、升级展示、模型能力、法律入口与头像场景均通过；法律入口覆盖 16 布局 / 32 点击。模型设置在六组串行 runner 中正常退出，但不输出单独摘要。handoff/升级首轮的旧外部路径失败已改为测试专用 `XCODE_NEW_API_SOURCE_DIR`，默认同级 `aiscoo-admin`；真实 bootstrap blob `9548cb4969afb8210af483f4d402a8b6b0b46dc7`。能力场景首轮缺截图目录，准备隔离证据目录后复验通过；未访问真实账号、支付或计费推理。
- Electron 44 钥匙串 smoke 两轮 development/seed 均在 15 秒内未完成，临时应用日志有 sandbox/启动延迟；未调大超时或修改安全存储策略，该项不宣称通过。尚未执行 Windows/Linux、完整用户数据冷恢复及手机真实设备端到端验收。
- 最终逐文件审查修正了 5 份 fixture 的旧 pending 路径及 About、子代理、guide 回放的 3 处旧品牌预期；6 个正式场景通过现有 fixture 校验器（4 个路径场景修前失败、修后通过），不计为真实 Electron 复跑。修后根 typecheck、Lint（0 errors / 308 warnings）及变更架构检查通过。
- 首次真实推送钩子通过并推送同步分支；本机 PR 策略默认 HTTPS fetch 曾遇 GitHub 空响应，随后使用同一 canonical 上游 SSH 地址复验退出 0。未修改策略或绕过门禁。

单独 cherry-pick 的提交：无。

## 2026-10-21 同步 upstream v3.16.2 (0a1fc56d..3c5b2276)

- 同步 PR：#18
- 首次按两分支模型执行：`main` 快进到 `3c5b2276` 并推送 → `sync/upstream-20261021` 从 `release` 切出 → `git merge --no-ff main` → PR 到 `release`（Create a merge commit）。

| 上游提交   | 说明                                                                                                      | 分类（采纳/适配/拒绝） | 备注 / 拒绝原因                                       |
| ---------- | --------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| `3c5b2276` | v3.16.2：Bash 临时输出路径隔离、只读/辅助会话类型、远控 HTTP 兼容、server-cli NAS 符号链接与打包、UI 更新 | 采纳并适配             | 整体 merge，保留上游 SHA；13 个文件冲突按下方取舍解决 |

冲突文件及取舍：

- `README.md`、`README.en.md`：保留 XWork 同步日志格式，追加 v3.16.2 条目。
- `apps/zcode-cli/docs/design/v2/tool/00-tool-change-chain.md`：两侧新增章节并存（XWork ReplyToChannel schema + 上游 Bash 临时输出）。
- `bash-direct-execution.test.ts`、`bash-shutdown.test.ts`：融合，保留 XWork 隔离 HOME 的 `processEnv`，加入上游 `bashOutputTempDir`。
- `server-operations.ts`、`v4-bridge.ts`、`zcodeAgentService.ts`、`zcodeTaskServiceAdapter.ts`：仅导入头冲突，保留 `// XCODE:` 标记并采用上游新增导入。
- `provider-registry-app-runtime.test.ts`、`releaseInstaller.test.ts`：导入并集。
- `stableLauncher.ts`：保留 XWork Server 文案，采用上游 `cd -P`/`pwd -P` 修复及注释。
- `composerModelThinking.test.ts`：采用上游拆分后的用例；新用例沿用 XWork 不显示 Vision 徽标的预期（`// XCODE:` 注释）。

单独 cherry-pick 的提交：无。

## 2026-10-19 同步 upstream v3.16.1 (aac47556..0a1fc56d)

- 同步目标：`main → sync/upstream-20261019 → XCode-main → release`；有冲突时按用户批准的受控 `sync/promote-20261019` 适配分支晋升。同步与晋升均保留 merge commit，不向 XCode-main 回流产品代码。
- 执行依据：用户决定保留现有六项下游修复，不向上游提 PR；侧栏补丁在上游重构版上重新验证后决定是否仍需保留。

| 上游提交   | 说明                                                                                                   | 分类（采纳/适配/拒绝） | 备注 / 拒绝原因                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `0a1fc56d` | v3.16.1：CLI 工具与 MCP、SQLite schema 与迁移、Desktop/Host/远程协议、共享 UI 与侧栏重构、架构门禁更新 | 采纳并适配             | 整体 merge，保留上游 SHA，不挑选提交；XWork 品牌、Native New API 与已批准修复只在产品晋升阶段适配，不回流到 XCode-main |

第一阶段：

- `main` 仅快进上游原始提交；`sync/upstream-20261019` 从已推送的 `origin/XCode-main` 切出，整体合并 `main`。
- 自动合并无内容冲突；既有分支策略与上次同步适配继续保留。按新版本命令验证后才提交与创建 PR。

验证与构建基线：

- 使用 `mise.toml` 固定的 Node 24.14.0 与 pnpm 10.33.2；根 typecheck、lint（0 errors / 96 warnings）、全量架构检查、36 项架构回归、SQLite schema 检查及迁移/Gen UI/Worker/模型分组定向回归（6 文件、109 项）已通过。
- CLI 包属于仓库根 workspace，并引用根 `@zcode/shared`、`@zcode/model-option-map`；从根安装并按上游依赖顺序构建，不在子 workspace 独立安装。构建真实 CLI 后，在隔离 HOME 下执行 `zcode.cjs --version` 输出 `0.17.0`。未更新现有 Desktop 的 bundled-agent，也未启动用户工作区；产品晋升后再做完整回归和侧栏 smoke。

产品晋升要求：

- 保留探针 `min(1024, max)`、docx settings 顺序、Gen UI 锁释放后 rescan、容量精确显示及缓存 unknown；侧栏以新版真实布局结果为准，不恢复上游已删除的旧组件。
- 保留 Native New API 的认证归属、owner/lease、workspaceIdentity、桌面 continuous 与手机 replayable 边界；沿用上游新协议及迁移路径，不添加双状态或兼容别名。
- 已用 `git merge-tree` 确认 release 与新上游存在内容冲突；晋升冲突必须在不向 XCode-main 回流产品代码的前提下解决。

产品晋升适配与验收：

- 上游同步已通过 PR #12 合入 `XCode-main`（`d8c0d170`）；受控晋升规则先由 PR #11 合入 `release`。`sync/promote-20261019` 从 release 切出，首个提交保留 release 与已审查 XCode-main 两个父提交，不向同步分支回流产品代码。
- 采用上游 session-execution、runtime-subagents、CLI facts 单写入与新版菜单/思考滑杆；迁移 Native owner、请求栅栏与公开服务接口的调用者，移除旧执行上下文、旧同步入口及无消费者的凭据包装，不添加兼容别名。已发布 Native migration 内容/校验值保持不变，schema baseline 按当前源码重新生成。
- 正式提交后的 pre-push 检出了驻留票据 helper 的 `unmanaged-new-file`：将其纯结构迁至既有 `task-facts` 命令交接 owner，经公开 index 迁移唯一生产消费者和两个测试；CLI 仍独占后台事实，原 owner fence 对象原样透传。未改 policy、baseline 或 exception；迁移后根 typecheck、11 项驻留交接回归与 185 项 Native Node 回归通过。PR 模板同步补齐受控晋升路径。
- 五项独立下游修复继续保留；侧栏采用上游单导航 `overflow-clip` 与右侧文件管理器，删除旧双面板及其 `inert` 补丁，不恢复 CollapsedRail。完整隔离 Desktop 中 31 项目/80 文件、两轮文件树往返、真实纵滚、焦点、账号菜单及横向位移验收通过，详见[侧栏规格](./specs/workspace-sidebar-layout.md)。
- 根 `pnpm test:unit` 完整通过：Vitest 2041 文件、19858 项通过，2 文件/9 项跳过；随后原生 Node 185 项全部通过。测试入口在导入业务模块前隔离 HOME 与数据根，迁移备份也不再落入调用者目录；真实 SQLite/备份 red-green 回归覆盖该边界。
- 根 `pnpm typecheck`、`pnpm lint`（0 errors / 315 warnings）、`pnpm architecture:check --changed`（0 违规）、SQLite schema 检查（8 项与两份 baseline）及修改文件格式检查通过。CLI 根目录 Turbo 入口在本机缺少可执行文件，改用根 workspace 的 `pnpm --recursive --filter './apps/zcode-cli/packages/*' typecheck` 完成现有包脚本，不另装子 workspace 或增加依赖。
- CLI 定向回归、SEA 与 cli.unit 回归、DOCX 外部校验通过；真实构建后的 Worker 通过 matching A → mismatching B 拒绝准入 → matching C 恢复的状态迁移，明确区分 receivedRevision 与 appliedRevision，未发送模型输入。
- 六组真实 Electron smoke 通过，覆盖上下文/额度、周期详情、嵌入页请求 guard、升级展示、模型设置及新版能力/思考选择。Web fixture 使用真实前端与私有优化缓存，Vite 独占 HTTP/HMR，等待 crawl 与原生 optimizer 完成后关闭；不通过重试、忽略信号或强制成功退出掩盖失败。隔离桌面与临时 driver 已清理，未部署后端、重启用户应用或完成真实账号授权/交易。

单独 cherry-pick 的提交：无。

## 2026-10-18 同步 upstream v3.15.1 (29628c9a..aac47556)

- 同步 PR：#2
- 执行人：yuxi

| 上游提交   | 说明                                                                                                 | 分类（采纳/适配/拒绝） | 备注 / 拒绝原因                                                                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aac47556` | v3.15.1：UI plugins 与内联 Gen UI；desktop、远程 workspace 与 agent 能力更新；扩充内置插件与回归测试 | 采纳                   | 上游以单个发布提交压缩交付；UI plugins 正式落地，包含新增 `packages/ui/src/plugin-ui`、`packages/ui/src/gen-ui`、`packages/share-ui`、`packages/stream-animate`、`packages/web-share`、13 个内置插件包与 `packages/android` |

冲突文件及取舍：

- `.husky/pre-push`：保留上游的 stdin 缓存、Git local env 清理与 `ZCODE_PRE_PUSH_STDIN` 传递，同时融合 XCode 分支策略检查（`scripts/xcode/branch-policy.mjs push`）；用缓存的 stdin 回放给分支策略脚本，保证 `verify:pre-push` 仍能拿到本次 push 的 ref 列表。

必要适配：

- `.github/workflows/xcode-pr.yml`：v3.15.1 的 `patchedDependencies` 增加后，CI 在 Linux 干净安装时稳定触发 pnpm `_tmp_*` rename 竞态（pnpm#13627 / #12880）。install 步骤改为 `taskset -c 0 pnpm install --frozen-lockfile --ignore-scripts`，本地 macOS 安装与检查不受影响。
- `packages/services/src/gen-ui/contract.test.ts`：上游把 `gen-ui-service` 声明为 managed 模块但未提供契约测试，全量架构检查报 `missing-module-artifact`。补充最小契约测试（RPC 通道名、模块公开入口、node 工厂），使 `pnpm architecture:check` 通过。

单独 cherry-pick 的提交（如有）：无

## 2026-10-05 建立基线

- `XCode-main` 从 `main` @ `29628c9`（ZCode v3.14.3）切出，此前无 XCode 改动。
- 上游 `feat/ui-plugin`（`662c30b`，UI plugins 与 Gen UI）当时未进入 `upstream/main`，暂不同步；该功能已随 v3.15.1 正式发布纳入（见 2026-10-18 同步）。
