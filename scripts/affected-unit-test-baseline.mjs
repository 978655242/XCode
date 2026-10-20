export function selectDefaultBranchRef({ originHead, hasCommit }) {
  // XCODE: 架构检查的产品基线优先 release；affected 已由新版 scope 按分支角色解析。
  return [
    "origin/release",
    "origin/staging",
    originHead,
    "origin/main",
    "origin/master",
    "main",
    "master",
  ].find((candidate) => candidate && hasCommit(candidate));
}
