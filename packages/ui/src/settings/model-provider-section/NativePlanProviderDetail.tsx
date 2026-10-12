import type { ReactNode } from "react";
import { InfoIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { ZCodeAboutLogo } from "@/components/ui/ZCodeAboutLogo.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { NativePlanSettingsRead } from "@/hooks/useNativePlanSettings.js";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { PlanStatusCardSurface } from "./StatusCards.js";
import { PlanEntryCard } from "./PlanEntryCard.js";
import {
  formatNativePlanPrice,
  getNativePlanReferenceOffers,
} from "./nativePlanSettingsPresentation.js";

// XCODE: 保留原版套餐详情的呈现，仅消费 Native 事实，不套用官方支付或额度语义。
export function NativePlanProviderDetail({
  provider,
  read,
  onOpenPlans,
  children,
}: {
  provider: ProviderSettingsFormProvider;
  read: NativePlanSettingsRead;
  onOpenPlans: () => void;
  children?: ReactNode;
}) {
  const { intl, locale } = useZCodeIntl();
  const snapshot = read.snapshot;
  const subscription = snapshot?.entitlement.subscription;
  const quota = snapshot?.entitlement.quota;
  const statusId = !read.connected
    ? "settings.modelProvider.codingPlan.status.loginRequired"
    : read.loading
      ? "settings.modelProvider.codingPlan.status.checking"
      : read.error
        ? "settings.modelProvider.codingPlan.status.unavailable"
        : snapshot?.entitlement.status === "unassigned"
          ? "settings.modelProvider.codingPlan.status.notPurchased"
          : `settings.usage.nativeAuthorization.${snapshot?.entitlement.status ?? "unassigned"}`;
  const offers = getNativePlanReferenceOffers(snapshot?.plans ?? []);
  const quantity = new Intl.NumberFormat(locale);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-native-plan-detail="true">
      <div className="flex h-8 min-w-0 items-center gap-2">
        <ZCodeAboutLogo className="size-5" />
        <h3 className="truncate text-ui-lg font-medium text-foreground">{provider.providerName}</h3>
      </div>
      <div className="space-y-3">
        <PlanStatusCardSurface
          planTitle={
            subscription?.plan_title ||
            intl.formatMessage({ id: "settings.modelProvider.planCard.codingPlan" })
          }
          statusMeta={
            <>
              {read.loading ? (
                <Loader2Icon className="size-3.5 animate-spin text-foreground-subtle" />
              ) : (
                <InfoIcon className="size-3.5 text-foreground-subtle" />
              )}
              <span
                className="text-ui-base text-foreground-subtle"
                role={read.error ? "alert" : "status"}
              >
                {intl.formatMessage({ id: statusId })}
              </span>
              {subscription?.end_time != null ? (
                <span className="text-ui-caption text-foreground-subtle">
                  {intl.formatMessage(
                    { id: "settings.modelProvider.native.expiresAt" },
                    {
                      time: new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(subscription.end_time),
                    },
                  )}
                </span>
              ) : null}
              {read.error ? (
                <Button variant="ghost" size="sm" onClick={() => void read.refresh()}>
                  {intl.formatMessage({ id: "common.retry" })}
                </Button>
              ) : null}
            </>
          }
          trailingAction={
            <Button disabled={!read.connected} onClick={onOpenPlans}>
              {intl.formatMessage({
                id:
                  snapshot?.entitlement.status === "active"
                    ? "settings.modelProvider.codingPlan.upgrade"
                    : "settings.modelProvider.codingPlan.subscribe",
              })}
            </Button>
          }
          usageContent={
            quota ? (
              <p className="text-ui-base text-foreground-subtle">
                {quota.unlimited
                  ? intl.formatMessage({ id: "settings.usage.nativeUnlimited" })
                  : intl.formatMessage(
                      { id: "settings.usage.nativeQuotaAmounts" },
                      {
                        used: quantity.format(BigInt(quota.used)),
                        total: quota.total === null ? "—" : quantity.format(BigInt(quota.total)),
                        remaining:
                          quota.remaining === null ? "—" : quantity.format(BigInt(quota.remaining)),
                      },
                    )}
              </p>
            ) : undefined
          }
        />
        <PlanEntryCard
          tone="personal"
          title={intl.formatMessage({
            id: "settings.modelProvider.codingPlan.purchaseBanner.personalTitle",
          })}
          disabled={!read.connected || read.loading}
          onClick={onOpenPlans}
          metric={offers.map((offer) => (
            <span
              key={offer.id}
              className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"
            >
              <span className="text-ui-xl font-bold leading-none text-foreground">
                {formatNativePlanPrice(offer.priceAmount, offer.currency, locale)}
              </span>
              <span className="text-ui-base font-medium text-foreground-subtle">
                {intl.formatMessage(
                  { id: "settings.modelProvider.native.referencePeriod" },
                  {
                    period: intl.formatMessage(
                      { id: `settings.modelProvider.native.duration.${offer.durationUnit}` },
                      {
                        count:
                          offer.durationUnit === "custom"
                            ? offer.durationCustomSeconds
                            : offer.durationValue,
                      },
                    ),
                  },
                )}
              </span>
            </span>
          ))}
          description={
            read.loading ? (
              intl.formatMessage({ id: "purchase.entry.loading" })
            ) : read.error ? (
              intl.formatMessage({ id: "settings.modelProvider.codingPlan.productsError" })
            ) : (
              <>
                {offers
                  .map((offer) => offer.subtitle)
                  .filter(Boolean)
                  .join(" · ") ||
                  intl.formatMessage({ id: "settings.modelProvider.native.personalDescription" })}
                <span className="block text-ui-caption">
                  {intl.formatMessage({
                    id: offers.length
                      ? "settings.modelProvider.native.referenceNotice"
                      : "settings.modelProvider.native.noOffers",
                  })}
                </span>
              </>
            )
          }
        />
        <PlanEntryCard
          tone="team"
          title={intl.formatMessage({
            id: "settings.modelProvider.codingPlan.purchaseBanner.teamTitle",
          })}
          description={intl.formatMessage({ id: "settings.modelProvider.native.teamUnsupported" })}
          disabled
        />
        {snapshot?.entitlement.status === "active" && provider.executable ? children : null}
      </div>
    </div>
  );
}
