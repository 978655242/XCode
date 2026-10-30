import type { Event } from "@zcode/rpc";
import { NEW_API_PROVIDER_ID, type OAuthProviderId, type OAuthStartResponse } from "@zcode/shared";
import { logger } from "@/logger.js";
import type { OAuthLoginContext, OAuthLoginLifecycle } from "@/oauth-lifecycle/contract.js";

export function createLocalWebLogin(context: OAuthLoginContext): OAuthLoginLifecycle {
  let attempt: { id: number; state: string | null; earlyFailures: Set<string> } | null = null;
  let popup: ReturnType<NonNullable<typeof context.platform.prepareLocalWebOAuthWindow>> = null;
  let localOpening = false;
  let ready: Promise<boolean> | null = null;
  let mounted = false;

  const clear = () => {
    attempt = null;
    localOpening = false;
    popup?.close();
    popup = null;
    context.setManualAuthorizationUrl(null);
  };
  const fail = () => {
    clear();
    context.fail();
  };

  return {
    mount() {
      mounted = true;
      let disposed = false;
      let subscription: { dispose(): void } | undefined;
      const oauth = context.oauthService as {
        onDidFailAuthorization?: Event<{
          provider: OAuthProviderId;
          state: string;
          reason: "expired" | "backend-unavailable" | "authorization-failed";
        }>;
        getLocalWebAuthorizationCapabilities?: () => Promise<{ failureEvents: boolean }>;
      };
      ready = (async () => {
        try {
          // 旧 Host 不支持该事件时 listen 会失败，须先探测并以第二次请求作为有序 RPC 栅栏。
          const capability = await oauth.getLocalWebAuthorizationCapabilities?.();
          if (disposed || capability?.failureEvents !== true || !oauth.onDidFailAuthorization)
            return false;
          subscription = oauth.onDidFailAuthorization((event) => {
            if (!attempt || attempt.id !== context.currentAttempt() || event.provider !== NEW_API_PROVIDER_ID)
              return;
            // 修复原因：失败事件可先于启动 RPC 返回，必须等返回 state 后再匹配当前尝试。
            if (attempt.state === null) attempt.earlyFailures.add(event.state);
            else if (attempt.state === event.state) fail();
          });
          const barrier = await oauth.getLocalWebAuthorizationCapabilities?.();
          return !disposed && barrier?.failureEvents === true;
        } catch (error) {
          if (!disposed) logger.warn("[useOAuth] 本机 Web 授权失败事件订阅失败", { error });
          return false;
        }
      })();
      return () => {
        disposed = true;
        mounted = false;
        subscription?.dispose();
        clear();
        context.invalidateAttempt();
      };
    },
    begin(provider, id, userGesture) {
      clear();
      localOpening = provider === NEW_API_PROVIDER_ID;
      if (!localOpening) return;
      attempt = { id, state: null, earlyFailures: new Set() };
      if (userGesture) {
        try {
          popup = context.platform.prepareLocalWebOAuthWindow?.() ?? null;
        } catch {
          popup = null;
        }
      }
    },
    beforeStart(id) {
      if (!attempt || attempt.id !== id) return undefined;
      return (async () => {
        const subscribed = await ready;
        if (!mounted || context.currentAttempt() !== id) return false;
        if (!subscribed) {
          fail();
          return false;
        }
        return true;
      })();
    },
    acceptResponse(id, response: OAuthStartResponse) {
      if (attempt?.id !== id) return () => false;
      if (response.provider !== NEW_API_PROVIDER_ID) {
        attempt = null;
      } else {
        attempt.state = response.state;
        if (attempt.earlyFailures.has(response.state)) {
          fail();
          return null;
        }
        attempt.earlyFailures.clear();
      }
      return () => {
        if (!localOpening) return false;
        if (!popup?.navigate(response.authorizeUrl)) {
          popup?.close();
          popup = null;
          context.setManualAuthorizationUrl(response.authorizeUrl);
        }
        return true;
      };
    },
    clear(invalidateAttempt) {
      clear();
      if (invalidateAttempt) context.invalidateAttempt();
    },
  };
}
