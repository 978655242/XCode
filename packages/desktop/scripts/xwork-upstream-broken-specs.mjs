// XWork 扩展：这些正式 spec 在纯上游 ZCode 产品上同样失效（上游产品已改接口/入口，
// 测试未跟进）。按 docs/xcode/UPSTREAM-EXTENSION.md §7 不修改上游测试，默认全量跳过；
// 显式 --spec 定向运行仍会执行，便于上游修复后复核。上游修复后从此清单删除。
// 清单与失效原因见 docs/xcode/e2e-acceptance.md §4。
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

export function resolveXWorkUpstreamBrokenSpecExcludes({ targeted }) {
  return targeted ? [] : XWORK_UPSTREAM_BROKEN_FORMAL_SPECS;
}
