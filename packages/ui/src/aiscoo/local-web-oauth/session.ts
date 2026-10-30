import { NEW_API_PROVIDER_ID, type OAuthSessionState } from "@zcode/shared";
import { logger } from "@/logger.js";
import type { OAuthSessionContext, OAuthSessionLifecycle } from "@/oauth-lifecycle/contract.js";

export function createLocalWebSession(context: OAuthSessionContext): OAuthSessionLifecycle {
  let revision = 0;
  let active = false;
  let mountRevision = 0;
  let successNotified = false;
  let ready: Promise<boolean> = Promise.resolve(false);
  const isCurrent = (candidate: number) => active && candidate === revision;

  const reconcile = async (state: OAuthSessionState | "initial", candidate: number) => {
    try {
      // 退出事件早于凭据清理时禁止恢复旧会话，只接受 owner 已确认的退出。
      const provider = await context.oauthService.getActiveProvider();
      if (!isCurrent(candidate)) return;
      if (state === "signed-out") {
        if (provider !== null) return;
        context.setUser(null);
        context.setIsRestoringOAuthSession(false);
        await context.refreshProviderState();
        return;
      }
      if (provider !== NEW_API_PROVIDER_ID) return;
      const result = await context.oauthService.restoreCachedSessionState();
      if (!isCurrent(candidate)) return;
      if (state === "signed-in" && result.status === "unavailable") {
        context.setIsRestoringOAuthSession(false);
        context.setOAuthError(context.loginFailureMessage());
        return;
      }
      if (result.status !== "authenticated") return;
      const confirmed = await context.oauthService.getActiveProvider();
      if (!isCurrent(candidate) || confirmed !== NEW_API_PROVIDER_ID) return;
      context.setUser(result.userInfo);
      context.setOAuthError(null);
      context.setIsRestoringOAuthSession(false);
      try {
        await context.refreshProviderState();
      } catch (error) {
        logger.warn("[Root] 本机 Web 登录后刷新 provider 失败", { error });
      }
      if (!isCurrent(candidate)) return;
      const currentProvider = await context.oauthService.getActiveProvider();
      if (!isCurrent(candidate) || currentProvider !== NEW_API_PROVIDER_ID) return;
      if (!successNotified) {
        successNotified = true;
        context.markOAuthSuccess(NEW_API_PROVIDER_ID);
      }
    } catch (error) {
      // 网络错误不是退出事实；只向仍有效的登录尝试报告可重试错误。
      if (isCurrent(candidate)) {
        logger.warn("[Root] 本机 Web OAuth 会话同步失败", { error });
        if (state === "signed-in") {
          context.setIsRestoringOAuthSession(false);
          context.setOAuthError(context.loginFailureMessage());
        }
      }
    }
  };

  return {
    preserveIdentityOnReadError: true,
    mount() {
      active = true;
      mountRevision = revision;
      let disposed = false;
      let providerResolved = false;
      let localNewApi = false;
      let pending: { state: OAuthSessionState; revision: number } | null = null;
      let subscription: { dispose(): void } | undefined;
      try {
        // 先订阅再查询，覆盖挂载和 provider 查询期间已经发生的账号事件。
        subscription = context.oauthService.onDidChangeSession((state) => {
          const current = ++revision;
          if (state === "signed-out") successNotified = false;
          pending = { state, revision: current };
          if (providerResolved && localNewApi) void reconcile(state, current);
        });
        ready = context.oauthService.getProviders().then((providers) => {
          if (disposed) return false;
          providerResolved = true;
          localNewApi = providers.some((provider) => provider.id === NEW_API_PROVIDER_ID);
          if (!localNewApi) {
            subscription?.dispose();
            subscription = undefined;
            return false;
          }
          void reconcile(pending?.state ?? "initial", pending?.revision ?? revision);
          return true;
        }).catch((error) => {
          if (!disposed) logger.warn("[Root] 本机 Web OAuth provider 查询失败", { error });
          subscription?.dispose();
          subscription = undefined;
          return false;
        });
      } catch (error) {
        logger.warn("[Root] 本机 Web OAuth 事件订阅失败", { error });
        ready = Promise.resolve(false);
      }
      return () => {
        disposed = true;
        active = false;
        revision++;
        subscription?.dispose();
      };
    },
    captureRevision: () => revision,
    isCurrent,
    async admitStartup(candidate) {
      const available = await ready;
      if (!available && isCurrent(candidate)) {
        context.setIsRestoringOAuthSession(false);
        context.setOAuthError(context.loginFailureMessage());
      } else if (active && candidate === mountRevision && !isCurrent(candidate)) {
        // 旧快照被本周期的新事件淘汰时，事件可能因 provider 不匹配提前退出，仍须结束启动提示。
        // 严格模式会重用生命周期实例，卸载前的快照不能结束新挂载周期的恢复。
        context.setIsRestoringOAuthSession(false);
      }
      return available && isCurrent(candidate);
    },
  };
}
