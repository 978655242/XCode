## 变更说明

<!-- 做了什么、为什么 -->

## PR 类型

- [ ] 功能 / 修复（`feature/`、`fix/`、`hotfix/` → `release`，Squash merge）
- [ ] 上游同步（`sync/upstream-*` → `release`，必须 Create a merge commit，不得夹带功能）

## 检查项

- [ ] 目标分支正确：所有 PR → `release`；从不指向 `main`
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm verify:pre-push` 通过
- [ ] 通用功能按 `docs/xcode/UPSTREAM-EXTENSION.md`：先复用上游能力、再扩展，未改写上游函数实现，共享清单只追加
- [ ] 已列出本 PR 修改、删除或改名的上游文件及理由（`git diff --no-renames --diff-filter=MD` 对照 `origin/main`），改动处有 `// XCODE: <原因>` 注释，且无无关格式化
- [ ] `git merge-tree --write-tree --name-only HEAD upstream/main` 预演结果已写入描述，无本 PR 新引入的冲突
- [ ] 上游同步：已更新 `docs/xcode/upstream-sync-log.md`（分类、冲突取舍、拒绝原因）

规范：`docs/xcode/UPSTREAM-EXTENSION.md`、`docs/xcode/BRANCHING.md`
