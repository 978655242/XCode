import { buildStartPlanEntitlementOptions } from "@/lib/startPlanEntitlementOptions.js";
import { useCallback } from "react";
import {
  getModelProviderFamilySpec,
  normalizeProviderFamilyDomain,
  resolvePlanIdentitySnapshot,
  type PlanIdentitySnapshot,
  type ProviderFamilyConnectionSelection,
  type ProviderFamilyDomain,
} from "@zcode/shared";
import type { IUsageStatsService } from "@zcode/services";
import { useUsageEntitlementWithService } from "@/hooks/useUsageEntitlement.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { resolveEntitledAccountProviderAccessFingerprint } from "@/lib/accountProviderAccess.js";
import { resolveAccountProviderInspectionAccess } from "@/lib/accountProviderAccess.js";
import {
  buildUsageEntitlementCacheKey,
  USAGE_ENTITLEMENT_CACHE_TTL_MS,
} from "@/lib/usageEntitlementCache.js";

export function usePlanIdentitySnapshot(
  providerFamilyDomain: ProviderFamilyDomain | null | undefined,
  connectionSelection: ProviderFamilyConnectionSelection | null | undefined,
  usageStatsService?: IUsageStatsService,
): () => PlanIdentitySnapshot {
  const normalizedDomain = normalizeProviderFamilyDomain(providerFamilyDomain);
  const providerSettingsRead = useProviderSettingsView();
  const providerSettingsView =
    providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;
  const familySpec = normalizedDomain ? getModelProviderFamilySpec(normalizedDomain) : null;
  const nativeProvider = providerSettingsView?.providers.find(
    (provider) => provider.effectiveConfig.access?.type === "new-api-account",
  );
  const nativeAccess = nativeProvider
    ? resolveAccountProviderInspectionAccess(providerSettingsView, nativeProvider.providerId)
    : null;
  const codingPlanProviderId =
    nativeProvider?.providerId ??
    (familySpec
      ? connectionSelection?.kind === "team-coding-plan"
        ? familySpec.teamCodingPlanProviderId
        : familySpec.individualCodingPlanProviderId
      : "");
  const startPlanProviderId = nativeProvider ? "" : (familySpec?.startPlanProviderId ?? "");
  const codingPlanRefreshFingerprint = nativeAccess
    ? JSON.stringify([
        nativeProvider?.accountState?.connectionKey,
        nativeAccess.providerId,
        nativeAccess.access,
      ])
    : resolveEntitledAccountProviderAccessFingerprint(providerSettingsView, codingPlanProviderId);
  const codingPlanEntitlement = useUsageEntitlementWithService(usageStatsService, {
    enabled: Boolean((nativeProvider || normalizedDomain) && codingPlanRefreshFingerprint),
    includeSubscription: true,
    preferredProviderId: codingPlanProviderId,
    accountAccess:
      nativeAccess?.access ??
      (normalizedDomain
        ? {
            type: "zhipu-account",
            family: normalizedDomain,
            ...(connectionSelection?.kind === "team-coding-plan"
              ? ({
                  planKind: "team-coding-plan",
                  productId: connectionSelection.productId,
                  organizationId: connectionSelection.organizationId,
                  projectId: connectionSelection.projectId,
                } as const)
              : ({ planKind: "individual-coding-plan" } as const)),
          }
        : undefined),
    allowDisabledPreferredProvider: true,
    requirePreferredProvider: true,
    allowEnvApiKey: false,
    cacheKey: buildUsageEntitlementCacheKey({
      providerId: codingPlanProviderId,
      providerFingerprint: codingPlanRefreshFingerprint,
    }),
    refreshOnMount: false,
  });
  const startPlanEntitlement = useUsageEntitlementWithService(
    usageStatsService,
    buildStartPlanEntitlementOptions(providerSettingsView, startPlanProviderId),
  );

  return useCallback(() => {
    if (nativeProvider) {
      const snapshot = codingPlanEntitlement.snapshot;
      const current =
        snapshot?.source === "new-api" &&
        snapshot.authenticated &&
        Date.now() - snapshot.generatedAt <= USAGE_ENTITLEMENT_CACHE_TTL_MS;
      return {
        generatedAt: snapshot?.generatedAt ?? Date.now(),
        planStatus:
          !current || snapshot.unavailableReason === "unavailable"
            ? "unknown"
            : snapshot.unavailableReason === "no_plan"
              ? "no_plan"
              : snapshot.subscription?.details.length
                ? "coding_plan"
                : "unknown",
        planProductId: current ? (snapshot.subscription?.details[0]?.productId ?? "") : "",
      };
    }
    return resolvePlanIdentitySnapshot({
      providerFamilyDomain: normalizedDomain,
      codingPlanEntitlement: codingPlanEntitlement.snapshot,
      startPlanEntitlement: startPlanEntitlement.snapshot,
      now: Date.now(),
      entitlementCacheTtlMs: USAGE_ENTITLEMENT_CACHE_TTL_MS,
    });
  }, [
    codingPlanEntitlement.snapshot,
    connectionSelection,
    normalizedDomain,
    startPlanEntitlement.snapshot,
    nativeProvider?.providerId,
  ]);
}
