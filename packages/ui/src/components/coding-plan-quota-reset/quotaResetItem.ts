import type { CodingPlanResetType } from "@zcode/shared";

export interface ResetRowCount {
  /** 服务端最近一次稳定读数给出的可用张数。 */
  authoritative: number;
  /** 本弹框内已成功核销、但服务端读数尚未反映的张数。 */
  consumedLocally: number;
}

export function getRemainingSeconds(expiresAt: number | null, now: number): number {
  if (expiresAt == null) return 0;
  return Math.max(0, Math.ceil((expiresAt - now) / 1_000));
}

export function resetTypeLabelId(resetType: CodingPlanResetType) {
  return resetType === "WEEK"
    ? "codingPlan.quotaReset.dialog.week"
    : "codingPlan.quotaReset.dialog.fiveHour";
}

export function resetTypeAriaId(resetType: CodingPlanResetType) {
  return resetType === "WEEK"
    ? "codingPlan.quotaReset.resetAriaWeek"
    : "codingPlan.quotaReset.resetAria";
}

/** 展示张数 = 权威张数 − 本地已核销，钳到 0；无本地记录时回退到 config 的 count。 */
export function remainingResetCount(state: ResetRowCount | undefined, fallback: number): number {
  return state ? Math.max(0, state.authoritative - state.consumedLocally) : fallback;
}
