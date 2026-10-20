# Push 前 affected 单测比较基线

v3.16.1 使用上游新版 `scripts/affected-unit-tests/scope.mjs` 解析比较范围，由 Vitest 官方选择关联测试。旧的默认分支候选 helper 只保留上游架构检查仍在使用的接口，不再承担 affected 范围解析。

- 显式 `--base`、`ZCODE_AFFECTED_TEST_BASE`、`ZCODE_PRE_PUSH_BASE` 按此顺序优先，覆盖 hook 提供的远端基线。
- 已存在远端分支使用远端 SHA；重写历史后改用双方 merge-base。
- 首次推送没有远端 SHA：所有分支（含 `sync/upstream-*`）统一使用产品主干 `origin/release`，取与 HEAD 的 merge-base；手动 push 范围没有 ref 输入时同样如此。`main` 仅镜像上游，不充当产品测试基线，也不创建 `staging` 别名。
- 预期集成分支缺失、无公共祖先、推送目标不是 HEAD、工作区有未提交/未跟踪改动时，严格报错；不自动 stash、不猜测其他分支、不退回全量来掩盖配置问题。
- 配置或公共依赖令 Vitest 选中整个根套件时，按上游规则明确提示“未执行测试”后成功退出；它不构成测试通过的证据，完整验证需另外执行 `pnpm test:unit`。
- XWork 保留的 `node:test` 用例继续由既有 `test:unit:node` 独立执行，并在根 Vitest 中排除；不能误扫、漏跑或与上游已迁入 Vitest 的测试重复执行。

架构检查保留上游独立的显式/CI/remote SHA/upstream 选择顺序。没有这些基线时，其默认候选在 XWork 优先 `origin/release`，再沿用上游候选；不以镜像 `main` 误算产品历史差异。affected 首推仍采用上述按分支角色严格选择的规则，不借架构检查的宽松 fallback 掩盖缺失远端。
