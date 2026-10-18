# 上游同步记录

流程见 [`BRANCHING.md`](./BRANCHING.md) 第 4 节。每次同步追加一节，最新的在最上面。

已同步到：`upstream/main` @ `aac47556`（ZCode v3.15.1）

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

单独 cherry-pick 的提交（如有）：无

## 2026-10-05 建立基线

- `XCode-main` 从 `main` @ `29628c9`（ZCode v3.14.3）切出，此前无 XCode 改动。
- 上游 `feat/ui-plugin`（`662c30b`，UI plugins 与 Gen UI）当时未进入 `upstream/main`，暂不同步；该功能已随 v3.15.1 正式发布纳入（见 2026-10-18 同步）。
