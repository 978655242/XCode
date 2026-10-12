import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { NativePlanDisplayContext } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { EmbeddedWebsiteHeader } from "@/components/EmbeddedWebsiteHeader.js";
import { Button } from "@/components/ui/button.js";
import { logger } from "@/logger.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import { resolveTheme } from "@/useTheme.js";

// XCODE: Native pages get a one-use URL, never the official credential injection path.
export function NativePlanEmbeddedWebviewDialog({
  onClose,
  onOpenResult,
  initialAudience = "personal",
}: {
  onClose: () => void;
  onOpenResult?: (opened: boolean) => void;
  initialAudience?: NativePlanDisplayContext["initialAudience"];
}) {
  const { codingPlanSubscriptionService, providerSettingsService } = useServices();
  const platform = usePlatform();
  const { intl, locale } = useZCodeIntl();
  const theme = useZCodeStoreWithDefault((state) => state.theme, "zai-dark");
  const uiFontSizePx = useZCodeStoreWithDefault((state) => state.uiFontSizePx, 14);
  const subscribeToSystemTheme = useCallback(
    (onChange: () => void) => {
      if (theme !== "system") return () => {};
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [theme],
  );
  const resolvedTheme = useSyncExternalStore(
    subscribeToSystemTheme,
    () => resolveTheme(theme),
    () => (theme === "dark" || theme === "zai-dark" ? "dark" : "light"),
  );
  const [view, setView] = useState<{ url: string; partition: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [navigation, setNavigation] = useState({ loading: true, back: false, forward: false });
  const webview = useRef<ElectronWebviewTag | null>(null);
  const disposeGuestListeners = useRef<(() => void) | null>(null);
  const onCloseRef = useRef(onClose);
  const onResultRef = useRef(onOpenResult);
  onCloseRef.current = onClose;
  onResultRef.current = onOpenResult;

  useEffect(() => {
    let active = true;
    let partition: string | null = null;
    setView(null);
    setError(null);
    setNavigation({ loading: true, back: false, forward: false });
    const dispose = platform.onNativePlanWebviewInvalidated?.((invalidated) => {
      if (partition === invalidated && active) onCloseRef.current();
    });
    void (async () => {
      if (!platform.prepareNativePlanWebview || !platform.closeNativePlanWebview)
        throw new Error("XCODE_WEBVIEW_UNAVAILABLE");
      const handoff = await codingPlanSubscriptionService.createPlanWebHandoff();
      if (!active) return;
      // XCODE: Rebuild the one-use partition for every App display/entry change, never a URL hint.
      const prepared = await platform.prepareNativePlanWebview({
        ...handoff,
        displayContext: {
          version: 1,
          theme: resolvedTheme,
          locale,
          initialAudience,
          uiFontSizePx,
        },
      });
      partition = prepared.partition;
      if (!active) {
        await platform.closeNativePlanWebview(partition);
        return;
      }
      setView({ url: handoff.url, partition });
    })().catch(() => {
      if (!active) return;
      setError(intl.formatMessage({ id: "settings.modelProvider.native.handoffFailed" }));
      onResultRef.current?.(false);
    });
    return () => {
      active = false;
      dispose?.();
      if (partition)
        void platform
          .closeNativePlanWebview?.(partition)
          .catch((cause) => logger.warn("[NativePlanWebview] partition cleanup failed", { cause }));
    };
  }, [
    codingPlanSubscriptionService,
    initialAudience,
    intl,
    locale,
    platform,
    request,
    resolvedTheme,
    uiFontSizePx,
  ]);

  useEffect(
    () => () => {
      // XCODE: Display rebuilds are not payments or closes; refresh real entitlement only on exit.
      void providerSettingsService
        .refresh("native-plan-page-closed")
        .catch((cause) => logger.warn("[NativePlanWebview] refresh failed", { cause }));
    },
    [providerSettingsService],
  );

  const bindWebview = useCallback(
    (guest: ElectronWebviewTag | null) => {
      disposeGuestListeners.current?.();
      disposeGuestListeners.current = null;
      webview.current = guest;
      if (!guest) return;
      const sync = () => {
        try {
          setNavigation({
            loading: guest.isLoading(),
            back: guest.canGoBack(),
            forward: guest.canGoForward(),
          });
        } catch {
          setNavigation({ loading: true, back: false, forward: false });
        }
      };
      const ready = () => {
        sync();
        onResultRef.current?.(true);
      };
      const failed = (event: ElectronWebviewDidFailLoadEvent) => {
        if (!event.isMainFrame) return;
        setError(intl.formatMessage({ id: "settings.modelProvider.native.handoffFailed" }));
        onResultRef.current?.(false);
      };
      guest.addEventListener("dom-ready", ready);
      guest.addEventListener("did-stop-loading", sync);
      guest.addEventListener("did-start-loading", sync);
      guest.addEventListener("did-navigate", sync);
      guest.addEventListener("did-fail-load", failed);
      disposeGuestListeners.current = () => {
        guest.removeEventListener("dom-ready", ready);
        guest.removeEventListener("did-stop-loading", sync);
        guest.removeEventListener("did-start-loading", sync);
        guest.removeEventListener("did-navigate", sync);
        guest.removeEventListener("did-fail-load", failed);
      };
    },
    [intl],
  );

  return (
    <section
      className="fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-background pt-12 text-foreground"
      data-testid="coding-plan-upgrade-surface"
      data-plan-source="new-api"
    >
      <EmbeddedWebsiteHeader
        title={intl.formatMessage({ id: "settings.modelProvider.codingPlan.webview.title" })}
        contentClassName="max-w-[1352px]"
        loading={navigation.loading && !error}
        canGoBack={navigation.back}
        canGoForward={navigation.forward}
        onBack={() => webview.current?.goBack()}
        onForward={() => webview.current?.goForward()}
        onReload={() => setRequest((value) => value + 1)}
        onClose={onClose}
      />
      {/* XCODE: Only the webpage owns content width/padding; the Native guest gets the full viewport. */}
      <main className="flex min-h-0 w-full flex-1 flex-col">
        {error ? (
          <div
            role="alert"
            className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-6 py-4 text-ui-base text-destructive"
          >
            {error}
            <Button variant="outline" size="sm" onClick={() => setRequest((value) => value + 1)}>
              {intl.formatMessage({ id: "common.retry" })}
            </Button>
          </div>
        ) : null}
        {view ? (
          <webview
            key={view.partition}
            ref={bindWebview}
            src={view.url}
            partition={view.partition}
            className={error ? "hidden" : "min-h-0 w-full flex-1 bg-background"}
            data-testid="coding-plan-embedded-webview"
          />
        ) : null}
      </main>
    </section>
  );
}
