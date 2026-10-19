export function selectDefaultBranchRef({ originHead, hasCommit }) {
  // Bug 原因：新分支首次 push 没有 remote SHA；若直接回退 origin/main，
  // 会把 staging 尚未合入 main 的历史差异误算成本分支变更，并错误触发全量单测。
  // XCODE: XCode 产品主干是 release（docs/xcode/BRANCHING.md），main 仅镜像上游；
  // 开发分支从 release 切出，无 staging 时以 origin/release 为默认 base，
  // 避免把已合入 release 的历史重复计入 affected 范围（fix/pre-push-affected-release-base）。
  return [
    "origin/staging",
    "origin/release",
    originHead,
    "origin/main",
    "origin/master",
    "main",
    "master",
  ].find((candidate) => candidate && hasCommit(candidate));
}
