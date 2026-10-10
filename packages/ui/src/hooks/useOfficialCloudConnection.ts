import { useCallback, useEffect, useRef, useState } from "react";
import type { OfficialCloudConnectionSnapshot, OfficialCloudFamily } from "@zcode/shared";
import { NEW_API_PROVIDER_ID } from "@zcode/shared";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { useServices } from "./useServices.js";
import { usePlatform } from "./usePlatform.js";

export const OFFICIAL_CLOUD_CONNECTION_CHANGED_CHANNEL = "official-cloud-connection-changed";

/** Independent cloud login; Host owns the pending flow and broadcasts its projection. */
export function useOfficialCloudConnection() {
  const { officialCloudConnectionService: service, broadcastService, oauthService } = useServices();
  const platform = usePlatform();
  const userId = useZCodeStore((state) => state.user?.id ?? null);
  const authSessionSeq = useZCodeStore((state) => state.authSessionSeq);
  const [projection, setProjection] = useState<{
    userId: string | null;
    authSessionSeq: number;
    snapshot: OfficialCloudConnectionSnapshot;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reads = useRef(0);
  const commands = useRef(0);
  const [mode, setMode] = useState<{ service: typeof oauthService; native: boolean } | null>(null);
  const nativeMode = mode?.service === oauthService && mode.native;
  useEffect(() => {
    let active = true;
    setMode(null);
    reads.current++;
    commands.current++;
    void oauthService.getProviders().then(
      (providers) => {
        if (active)
          setMode({
            service: oauthService,
            native: providers.some((provider) => provider.id === NEW_API_PROVIDER_ID),
          });
      },
      (cause) => {
        if (active) {
          setMode({ service: oauthService, native: false });
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [oauthService]);
  const refreshSnapshot = useCallback(async () => {
    if (!nativeMode || !service) return;
    const request = ++reads.current;
    try {
      const snapshot = await service.getSnapshot();
      if (request === reads.current) setProjection({ userId, authSessionSeq, snapshot });
    } catch (cause) {
      if (request === reads.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [nativeMode, service, userId, authSessionSeq]);
  useEffect(() => {
    commands.current++;
    setProjection(null);
    setLoading(false);
    setError(null);
    if (!nativeMode) return;
    const subscription = service?.onDidChange(() => {
      reads.current++;
      setProjection(null);
      void refreshSnapshot();
    });
    void refreshSnapshot();
    return () => {
      reads.current++;
      commands.current++;
      subscription?.dispose();
    };
  }, [nativeMode, service, refreshSnapshot]);
  useEffect(() => {
    if (!nativeMode) return;
    const subscription = broadcastService.onMessage((message) => {
      if (message.channel !== OFFICIAL_CLOUD_CONNECTION_CHANGED_CHANNEL) return;
      const payload =
        message.payload && typeof message.payload === "object" && "status" in message.payload
          ? message.payload
          : null;
      setLoading(false);
      setError(payload?.status === "failed" ? "Official cloud connection failed" : null);
      void refreshSnapshot();
    });
    return () => subscription.dispose();
  }, [broadcastService, nativeMode, refreshSnapshot]);
  const startOAuth = useCallback(
    async (family: OfficialCloudFamily) => {
      const command = ++commands.current;
      setLoading(true);
      setError(null);
      try {
        if (!nativeMode || !service)
          throw new Error("Official cloud connection is unavailable on this Host");
        const flow = await service.startOAuth(family);
        if (command !== commands.current) return;
        if (flow.purpose !== "official-cloud" || flow.provider !== family)
          throw new Error("Invalid official cloud OAuth purpose");
        platform.registerOAuthState({
          state: flow.state,
          provider: flow.provider,
          purpose: "official-cloud",
        });
        platform.openExternal(flow.authorizeUrl);
        await refreshSnapshot();
      } catch (cause) {
        if (command === commands.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (command === commands.current) setLoading(false);
      }
    },
    [nativeMode, platform, service, refreshSnapshot],
  );
  const logout = useCallback(async () => {
    if (!nativeMode || !service) return;
    const command = ++commands.current;
    reads.current++;
    setProjection(null);
    setLoading(true);
    setError(null);
    try {
      await service.logout();
      if (command === commands.current) await refreshSnapshot();
    } catch (cause) {
      if (command === commands.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (command === commands.current) setLoading(false);
    }
  }, [nativeMode, service, refreshSnapshot]);
  const refreshCloud = useCallback(async () => {
    const command = ++commands.current;
    setLoading(true);
    setError(null);
    try {
      if (!nativeMode || !service)
        throw new Error("Official cloud connection is unavailable on this Host");
      await service.refresh();
      if (command === commands.current) await refreshSnapshot();
    } catch (cause) {
      if (command === commands.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (command === commands.current) setLoading(false);
    }
  }, [nativeMode, service, refreshSnapshot]);
  const snapshot =
    nativeMode && projection?.userId === userId && projection.authSessionSeq === authSessionSeq
      ? projection.snapshot
      : null;
  return {
    snapshot,
    loading: loading || mode?.service !== oauthService || Boolean(snapshot?.pendingFamily),
    error,
    startOAuth,
    logout,
    refresh: refreshCloud,
  };
}
