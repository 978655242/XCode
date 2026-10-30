# 架构检查比较基线

App affected 单测入口已按[测试规格](../testing/unit-test-quality.md)退役；工程 affected 由 `scripts/engineering-tests/scope.mjs` 使用 Vitest 官方依赖图选择，保留显式基线、remote SHA 与工作区检查语义。

<!-- XCODE: Aiscoo 产品主干为 release，main 只镜像上游。 -->

- 首次推送所有工作分支（含 `sync/upstream-*`）时，工程 affected 使用 `origin/release` 与 HEAD 的 merge-base；没有有效 upstream 的手动 push 同样如此。缺少集成分支或无共同祖先时严格失败，不创建 staging 别名。
- 架构检查的默认分支选择函数位于 `scripts/architecture/default-branch.mjs`，优先 `origin/release`，随后保留上游 `origin/staging`、`origin/HEAD`、`origin/main`、`origin/master`、`main`、`master` 候选。显式、CI、push remote SHA 和 upstream 的优先级不变。
- 工程 affected 选中整个 engineering 套件时明确报告跳过并退出 0；这不代表测试通过。日常只运行受影响文件，显式全量使用 `pnpm test:engineering`。
- Aiscoo 专属回归使用独立 `pnpm test:aiscoo <文件>` 与 `pnpm test:unit:node`，不加入上游 engineering 清单，不恢复已退役 App 单测入口。

详细推送合同见 [pre-push 说明](../testing/pre-push-hook.md)。
