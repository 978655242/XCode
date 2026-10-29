// 仅复核商业应用中账号头像这一附加用途；专用许可的限制和原文见 third-party/SPEC.md。
// 必须比较扫描到的原始许可字段，不能让通用归一化放行空白、对象或其他 SEE LICENSE 值。
export function isReviewedMultiavatarLicense(pkg) {
  return (
    pkg.name === "@multiavatar/multiavatar" &&
    pkg.version === "1.0.7" &&
    pkg.license === "SEE LICENSE IN LICENSE"
  );
}
