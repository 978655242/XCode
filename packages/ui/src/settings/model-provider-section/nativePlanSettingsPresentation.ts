import type { NativeCodingPlanReadSnapshot, UsageQuotaLimit } from "@zcode/shared";

export type NativePlanReferenceOffer = NativeCodingPlanReadSnapshot["plans"][number];

export type NativePlanQuota = Pick<
  NonNullable<UsageQuotaLimit["native"]>,
  | "unlimited"
  | "usedPercentage"
  | "period"
  | "nextResetTime"
  | "resetTimeZone"
  | "resetUtcOffsetSeconds"
>;

// XCODE: 重置时间沿用服务端时区，避免电脑时区使设置页与浮层显示不同重置日。
export function formatNativePlanQuotaResetTime(
  locale: string,
  quota: NativePlanQuota,
  format: "date" | "dateTime" = "dateTime",
): string | undefined {
  if (quota.period === "never" || quota.nextResetTime == null) return undefined;
  return new Intl.DateTimeFormat(locale, {
    timeZone: quota.resetTimeZone === "server-local" ? "UTC" : quota.resetTimeZone,
    month: "short",
    day: "numeric",
    ...(format === "dateTime"
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
      : {}),
  }).format(
    quota.nextResetTime +
      (quota.resetTimeZone === "server-local" ? quota.resetUtcOffsetSeconds * 1000 : 0),
  );
}

/** XCODE: 只比较同币种和完整周期的参考价，不能将季度总价当成月价或混算币种。 */
export function getNativePlanReferenceOffers(plans: readonly NativePlanReferenceOffer[]) {
  const offers = new Map<string, NativePlanReferenceOffer>();
  for (const plan of plans) {
    if (!plan.enabled) continue;
    const key = JSON.stringify([
      plan.currency,
      plan.durationUnit,
      plan.durationValue,
      plan.durationUnit === "custom" ? plan.durationCustomSeconds : "0",
    ]);
    const current = offers.get(key);
    if (!current || compareDecimalAmounts(plan.priceAmount, current.priceAmount) < 0) {
      offers.set(key, plan);
    }
  }
  return [...offers.values()];
}

/** XCODE: 参考金额保留原十进制精度，不能经过 Number 丢失尾数。 */
export function formatNativePlanPrice(amount: string, currency: string, locale: string) {
  const [whole, fraction = ""] = amount.split(".");
  const digits = Math.max(2, fraction.length);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
      .formatToParts(BigInt(whole!))
      .map((part) => (part.type === "fraction" ? fraction.padEnd(digits, "0") : part.value))
      .join("");
  } catch {
    // 原生目录允许非 ISO 币种；仍呈现真实值，不猜汇率或替用其他币种。
    return `${amount} ${currency}`;
  }
}

function compareDecimalAmounts(left: string, right: string) {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const a = BigInt(leftWhole + leftFraction.padEnd(scale, "0"));
  const b = BigInt(rightWhole + rightFraction.padEnd(scale, "0"));
  return a < b ? -1 : a > b ? 1 : 0;
}
