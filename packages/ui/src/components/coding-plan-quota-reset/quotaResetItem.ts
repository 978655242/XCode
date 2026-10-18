import type { CodingPlanResetType } from "@zcode/shared";

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

