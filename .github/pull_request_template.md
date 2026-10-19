## 变更说明

<!-- 做了什么、为什么 -->

## PR 类型

- [ ] 功能 / 修复（`feature/`、`fix/`、`hotfix/` → `release`，Squash merge）
- [ ] 上游同步（`sync/upstream-*` → `XCode-main`，必须 Create a merge commit，不得夹带功能）
- [ ] 同步晋升（`XCode-main` → `release`，必须 Create a merge commit）

## 检查项

- [ ] 目标分支正确：功能/修复 → `release`；`sync/` → `XCode-main`；`XCode-main` → `release`；从不指向 `main`
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm verify:pre-push` 通过
- [ ] 修改上游文件处已加 `// XCODE: <原因>` 注释，且无无关格式化
- [ ] 上游同步：已更新 `docs/xcode/upstream-sync-log.md`（分类、冲突取舍、拒绝原因）

规范：`docs/xcode/BRANCHING.md`
