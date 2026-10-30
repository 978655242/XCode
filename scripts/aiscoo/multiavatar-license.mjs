// 仅复核商业应用中账号头像这一附加用途；专用许可的限制和原文见 third-party/aiscoo-multiavatar.md。
// 必须比较扫描到的原始许可字段，不能让通用归一化放行空白、对象或其他 SEE LICENSE 值。
export function isReviewedMultiavatarLicense(pkg) {
  return (
    pkg.name === "@multiavatar/multiavatar" &&
    pkg.version === "1.0.7" &&
    pkg.license === "SEE LICENSE IN LICENSE"
  );
}

// 上游 scripts/licenses.mjs 只保留一行调用：分类之后，把通过精确复核的包标为 green。
// 其余包的分类结果不变，所以其他 SEE LICENSE 值仍保持 unresolved 并阻断门禁。
export function applyReviewedMultiavatarLicense(installed, scanned) {
  for (const [key, record] of installed) {
    const raw = scanned.get(key)?.pkg;
    if (raw && isReviewedMultiavatarLicense(raw)) record.bucket = "green";
  }
}
