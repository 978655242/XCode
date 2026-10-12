import type { ReactNode } from "react";
import { ArrowRightIcon, AstroidIcon, UsersIcon } from "lucide-react";

// XCODE: 原版套餐入口统一呈现；Native 与官方只替换事实和操作，不另造卡片样式。
const CARD_CLASS = {
  start:
    "min-h-20 w-full overflow-hidden rounded-xl border border-border bg-[radial-gradient(circle_at_14%_12%,color-mix(in_srgb,var(--color-success)_24%,var(--color-background)_76%)_0%,color-mix(in_srgb,var(--color-success)_10%,var(--color-surface)_90%)_64%,var(--color-surface)_300%)] p-4 text-left transition-colors hover:border-border-hover",
  personal:
    "min-h-20 w-full overflow-hidden rounded-xl border border-border bg-[radial-gradient(circle_at_14%_12%,color-mix(in_srgb,#4099ff_24%,var(--color-background)_76%)_0%,color-mix(in_srgb,#4099ff_10%,var(--color-surface)_90%)_64%,var(--color-surface)_300%)] p-4 text-left transition-colors hover:border-border-hover",
  team: "min-h-20 w-full overflow-hidden rounded-xl border border-border bg-[radial-gradient(circle_at_14%_12%,color-mix(in_srgb,#0ea5e9_24%,var(--color-background)_76%)_0%,color-mix(in_srgb,#0ea5e9_10%,var(--color-surface)_90%)_64%,var(--color-surface)_300%)] p-4 text-left transition-colors hover:border-border-hover",
};

export function PlanEntryCard({
  tone,
  title,
  metric,
  description,
  disabled,
  onClick,
}: {
  tone: keyof typeof CARD_CLASS;
  title: string;
  metric?: ReactNode;
  description: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const Icon = tone === "team" ? UsersIcon : AstroidIcon;
  return (
    <button type="button" className={CARD_CLASS[tone]} disabled={disabled} onClick={onClick}>
      <span className="flex min-w-0 items-start gap-3">
        <Icon
          className={`mt-1 size-4 shrink-0 ${tone === "team" ? "text-warning" : tone === "start" ? "text-success" : "text-[#4099ff]"}`}
        />
        <span className="min-w-0 flex-1">
          <span className="text-ui-lg font-medium leading-6 text-foreground">{title}</span>
          {metric}
          <span className="mt-0.5 block text-ui-base leading-5 text-foreground-subtle">
            {description}
          </span>
        </span>
        <span className="flex h-6 shrink-0 items-center">
          <ArrowRightIcon className="size-4 text-foreground-subtle" />
        </span>
      </span>
    </button>
  );
}
