# 上游同步记录

流程见 [`BRANCHING.md`](./BRANCHING.md) 第 4 节。每次同步追加一节，最新的在最上面。

已同步到：`upstream/main` @ `0a1fc56d`（ZCode v3.16.1）

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

## 2026-10-19 同步 upstream v3.16.1 (aac47556..0a1fc56d)

- 同步目标：`main → sync/upstream-20261019 → XCode-main → release`；有冲突时按用户批准的受控 `sync/promote-20261019` 适配分支晋升。同步与晋升均保留 merge commit，不向 XCode-main 回流产品代码。
- 执行依据：用户决定保留现有六项下游修复，不向上游提 PR；侧栏补丁在上游重构版上重新验证后决定是否仍需保留。

| 上游提交 | 说明 | 分类（采纳/适配/拒绝） | 备注 / 拒绝原因 |
| -------- | ---- | ---------------------- | --------------- |
| `0a1fc56d` | v3.16.1：CLI 工具与 MCP、SQLite schema 与迁移、Desktop/Host/远程协议、共享 UI 与侧栏重构、架构门禁更新 | 采纳并适配 | 整体 merge，保留上游 SHA，不挑选提交；XWork 品牌、Native New API 与已批准修复只在产品晋升阶段适配，不回流到 XCode-main |

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

单独 cherry-pick 的提交：无。

## 2026-10-18 同步 upstream v3.15.1 (29628c9a..aac47556)

- 同步 PR：#2
- 执行人：yuxi

| 上游提交 | 说明 | 分类（采纳/适配/拒绝） | 备注 / 拒绝原因 |
| -------- | ---- | ---------------------- | --------------- |
| `aac47556` | v3.15.1：UI plugins 与内联 Gen UI；desktop、远程 workspace 与 agent 能力更新；扩充内置插件与回归测试 | 采纳 | 上游以单个发布提交压缩交付；UI plugins 正式落地，包含新增 `packages/ui/src/plugin-ui`、`packages/ui/src/gen-ui`、`packages/share-ui`、`packages/stream-animate`、`packages/web-share`、13 个内置插件包与 `packages/android` |

冲突文件及取舍：

- `.husky/pre-push`：保留上游的 stdin 缓存、Git local env 清理与 `ZCODE_PRE_PUSH_STDIN` 传递，同时融合 XCode 分支策略检查（`scripts/xcode/branch-policy.mjs push`）；用缓存的 stdin 回放给分支策略脚本，保证 `verify:pre-push` 仍能拿到本次 push 的 ref 列表。

必要适配：

- `.github/workflows/xcode-pr.yml`：v3.15.1 的 `patchedDependencies` 增加后，CI 在 Linux 干净安装时稳定触发 pnpm `_tmp_*` rename 竞态（pnpm#13627 / #12880）。install 步骤改为 `taskset -c 0 pnpm install --frozen-lockfile --ignore-scripts`，本地 macOS 安装与检查不受影响。
- `packages/services/src/gen-ui/contract.test.ts`：上游把 `gen-ui-service` 声明为 managed 模块但未提供契约测试，全量架构检查报 `missing-module-artifact`。补充最小契约测试（RPC 通道名、模块公开入口、node 工厂），使 `pnpm architecture:check` 通过。

单独 cherry-pick 的提交（如有）：无

## 2026-10-05 建立基线

- `XCode-main` 从 `main` @ `29628c9`（ZCode v3.14.3）切出，此前无 XCode 改动。
- 上游 `feat/ui-plugin`（`662c30b`，UI plugins 与 Gen UI）当时未进入 `upstream/main`，暂不同步；该功能已随 v3.15.1 正式发布纳入（见 2026-10-18 同步）。
