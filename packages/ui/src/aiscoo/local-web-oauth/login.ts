import type { Event } from "@zcode/rpc";
import { NEW_API_PROVIDER_ID, type OAuthProviderId, type OAuthStartResponse } from "@zcode/shared";
import { logger } from "@/logger.js";
import type { OAuthLoginContext, OAuthLoginLifecycle } from "@/oauth-lifecycle/contract.js";

export function createLocalWebLogin(context: OAuthLoginContext): OAuthLoginLifecycle {
  let attempt: { id: number; state: string | null; earlyFailures: Set<string> } | null = null;
  let popup: ReturnType<NonNullable<typeof context.platform.prepareLocalWebOAuthWindow>> = null;
  let localOpening = false;
  // 仅缓存成功的握手：失败（例如 Host 尚在启动）不能让“重新登录”永远沿用同一次失败。
  let ready: Promise<boolean> | null = null;
  let mounted = false;
  let subscription: { dispose(): void } | undefined;
  const oauth = context.oauthService as {
    onDidFailAuthorization?: Event<{
      provider: OAuthProviderId;
      state: string;
      reason: "expired" | "backend-unavailable" | "authorization-failed";
    }>;
    getLocalWebAuthorizationCapabilities?: () => Promise<{ failureEvents: boolean }>;
    cancelLocalWebAuthorization?: (state: string) => Promise<void>;
  };

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

  const handshake = async (): Promise<boolean> => {
    try {
      // 旧 Host 不支持该事件时 listen 会失败，须先探测并以第二次请求作为有序 RPC 栅栏。
      const capability = await oauth.getLocalWebAuthorizationCapabilities?.();
      if (!mounted || capability?.failureEvents !== true || !oauth.onDidFailAuthorization)
        return false;
      subscription = oauth.onDidFailAuthorization((event) => {
        if (
          !attempt ||
          attempt.id !== context.currentAttempt() ||
          event.provider !== NEW_API_PROVIDER_ID
        )
          return;
        // 修复原因：失败事件可先于启动 RPC 返回，必须等返回 state 后再匹配当前尝试。
        if (attempt.state === null) attempt.earlyFailures.add(event.state);
        else if (attempt.state === event.state) fail();
      });
      const barrier = await oauth.getLocalWebAuthorizationCapabilities?.();
      return mounted && barrier?.failureEvents === true;
    } catch (error) {
      if (mounted) logger.warn("[useOAuth] 本机 Web 授权失败事件订阅失败", { error });
      return false;
    }
  };
  const ensureReady = (): Promise<boolean> => {
    if (ready) return ready;
    const current: Promise<boolean> = handshake().then((ok) => {
      if (!ok) {
        // 部分成功的订阅不得残留，下一次尝试重新握手。
        subscription?.dispose();
        subscription = undefined;
        if (ready === current) ready = null;
      }
      return ok;
    });
    ready = current;
    return current;
  };

  return {
    mount() {
      mounted = true;
      void ensureReady();
      return () => {
        mounted = false;
        ready = null;
        subscription?.dispose();
        subscription = undefined;
        clear();
        context.invalidateAttempt();
      };
    },
    begin(provider, id, userGesture) {
      clear();
      localOpening = provider === NEW_API_PROVIDER_ID;
      if (!localOpening) return undefined;
      attempt = { id, state: null, earlyFailures: new Set() };
      if (userGesture) {
        try {
          popup = context.platform.prepareLocalWebOAuthWindow?.() ?? null;
        } catch {
          popup = null;
        }
      }
      return (async () => {
        const subscribed = await ensureReady();
        if (!mounted || context.currentAttempt() !== id) return false;
        if (!subscribed) {
          fail();
          return false;
        }
        return true;
      })();
    },
    acceptResponse(id, response: OAuthStartResponse) {
      if (response.provider !== NEW_API_PROVIDER_ID) {
        if (attempt?.id === id) attempt = null;
        return attempt?.id === id || context.currentAttempt() === id ? () => false : null;
      }
      if (attempt?.id !== id || context.currentAttempt() !== id) {
        // 迟到的启动结果属于已失效尝试，只按其 state 释放，不影响当前或其他标签的授权。
        void Promise.resolve(oauth.cancelLocalWebAuthorization?.(response.state)).catch((error) => {
          logger.warn("[useOAuth] 释放失效的本机 Web 授权失败", { error });
        });
        return null;
      }
      attempt.state = response.state;
      if (attempt.earlyFailures.has(response.state)) {
        fail();
        return null;
      }
      attempt.earlyFailures.clear();
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
    cancel(provider) {
      if (provider !== undefined && provider !== NEW_API_PROVIDER_ID) {
        clear();
        return null;
      }
      // 修复原因：provider 级取消会关闭其他标签替换后的 listener；这里只撤销本标签已知的 state。
      const state = attempt?.state ?? null;
      clear();
      if (state === null) return Promise.resolve();
      return Promise.resolve(oauth.cancelLocalWebAuthorization?.(state));
    },
    clear(invalidateAttempt) {
      clear();
      if (invalidateAttempt) context.invalidateAttempt();
    },
  };
}
