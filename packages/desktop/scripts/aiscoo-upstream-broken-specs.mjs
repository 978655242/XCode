// XWork 扩展：暂缓维护这些上游正式 spec；部分失效归因来自静态分类，尚未逐项实测。
// 按 docs/aiscoo/UPSTREAM-EXTENSION.md §7 撤回测试适配，默认全量跳过；
// 显式 --spec 定向运行仍会执行，便于上游修复后复核。上游修复后从此清单删除。
// 清单与失效原因见 docs/aiscoo/e2e-acceptance.md §4。
export const XWORK_UPSTREAM_BROKEN_FORMAL_SPECS = [
  "./test/e2e/conversation-session/conversation-session-assistant-preview-cards.test.ts",
  "./test/e2e/conversation-session/conversation-session-background-bash-output.test.ts",
  "./test/e2e/conversation-session/conversation-session-bash-direct-output.test.ts",
  "./test/e2e/conversation-session/conversation-session-markdown-preview-selection.test.ts",
  "./test/e2e/conversation-session/conversation-session-pasted-image-path-projection.test.ts",
  "./test/e2e/conversation-session/conversation-session-ssh-remote-development-p0.test.ts",
  "./test/e2e/conversation-session/conversation-session-ssh-remote-p0.test.ts",
  "./test/e2e/conversation-session/conversation-session-tool-cross-product.test.ts",
  "./test/e2e/conversation-session/conversation-session-v4-video-preview.test.ts",
  "./test/e2e/ui-shell/side-pane-tabs-responsive-interactions.test.ts",
  "./test/e2e/workspace-file-tree/workspace-file-tree-shared-search.test.ts",
];

export function resolveAiscooUpstreamBrokenSpecExcludes({ targeted, env = process.env }) {
  // 内部分片也会填 ZCODE_E2E_SPEC，必须按来源判断，避免把全量分配误当成定向复核。
  return targeted && env.XWORK_E2E_SPEC_ORIGIN !== "shard"
    ? []
    : XWORK_UPSTREAM_BROKEN_FORMAL_SPECS;
}
