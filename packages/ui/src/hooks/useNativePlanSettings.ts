import { useCallback, useEffect, useRef, useState } from "react";
import { isNativeCodingPlanRead, type NativeCodingPlanReadSnapshot } from "@zcode/shared";
import type { ICodingPlanSubscriptionService } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useUsageAccountScope } from "@/hooks/useUsageAccountScope.js";
import { logger } from "@/logger.js";

export interface NativePlanSettingsRead {
  snapshot: NativeCodingPlanReadSnapshot | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

interface OwnedPlanRead {
  service: ICodingPlanSubscriptionService;
  scopeKey: string;
  snapshot: NativeCodingPlanReadSnapshot | null;
  loading: boolean;
  error: string | null;
}

export function useNativePlanSettings(providerId?: string): NativePlanSettingsRead {
  const { codingPlanSubscriptionService: service, providerSettingsService } = useServices();
  const scope = useUsageAccountScope(providerId);
  const scopeKey = scope.ownerKey;
  const connected = Boolean(providerId && scopeKey);
  const latest = useRef({ service, scopeKey, request: 0 });
  latest.current.service = service;
  latest.current.scopeKey = scopeKey;
  const [state, setState] = useState<OwnedPlanRead | null>(null);
  const refresh = useCallback(async () => {
    const request = ++latest.current.request;
    if (!connected) return;
    const isCurrent = () =>
      latest.current.service === service &&
      latest.current.scopeKey === scopeKey &&
      latest.current.request === request;
    setState({ service, scopeKey, snapshot: null, loading: true, error: null });
    try {
      const snapshot = await service.getStaticProducts();
      if (!isNativeCodingPlanRead(snapshot)) throw new Error("XCODE_NATIVE_PLAN_SOURCE_REQUIRED");
      if (isCurrent()) setState({ service, scopeKey, snapshot, loading: false, error: null });
    } catch (cause) {
      if (!isCurrent()) return;
      logger.warn("[NativePlanSettings] 套餐读取失败", { providerId });
      setState({
        service,
        scopeKey,
        snapshot: null,
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [connected, providerId, scopeKey, service]);
  useEffect(() => {
    void refresh();
    // 关闭现有订阅弹窗会刷新 Host；即使目录 revision 不变，也重新读取真实参考价。
    const subscription = providerSettingsService.onDidChange(() => void refresh());
    return () => {
      latest.current.request++;
      subscription.dispose();
    };
  }, [providerSettingsService, refresh]);
  // XCODE: effect 清理晚于 render；换号/退出首帧也不能展示上一 owner 的套餐。
  const current =
    connected && state?.service === service && state.scopeKey === scopeKey ? state : null;
  return {
    connected,
    snapshot: current?.snapshot ?? null,
    loading: connected && (current?.loading ?? true),
    error: current?.error ?? null,
    refresh,
  };
}
