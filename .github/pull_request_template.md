## 变更说明

<!-- 做了什么、为什么 -->

## PR 类型

- [ ] 功能 / 修复（`feature/`、`fix/`、`hotfix/`，Squash merge）
- [ ] 上游同步（`sync/upstream-*`，必须 Create a merge commit，不得夹带功能）

## 检查项

- [ ] 目标分支是 `XCode-main`，不是 `main`
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm verify:pre-push` 通过
- [ ] 修改上游文件处已加 `// XCODE: <原因>` 注释，且无无关格式化
- [ ] 上游同步：已更新 `docs/xcode/upstream-sync-log.md`（分类、冲突取舍、拒绝原因）

规范：`docs/xcode/BRANCHING.md`
