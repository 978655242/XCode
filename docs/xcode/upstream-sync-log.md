# 上游同步记录

流程见 [`BRANCHING.md`](./BRANCHING.md) 第 4 节。每次同步追加一节，最新的在最上面。

已同步到：`upstream/main` @ `29628c9`（ZCode v3.14.3）

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

## 2026-10-05 建立基线

- `XCode-main` 从 `main` @ `29628c9`（ZCode v3.14.3）切出，此前无 XCode 改动。
- 上游 `feat/ui-plugin`（`662c30b`，UI plugins 与 Gen UI）未进入 `upstream/main`，暂不同步。
