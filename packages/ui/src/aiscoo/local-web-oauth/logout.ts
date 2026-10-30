import type { OAuthLogoutContext } from "./contract.js";

/** 本机 Web 只投影账号 owner 的退出结果，不保存或重试凭据。 */
export function createLocalWebLogout(context: OAuthLogoutContext): () => Promise<void> {
  return async () => {
    const confirmed = await context.requestConfirmation({
      title: context.intl.formatMessage({ id: "logout.localWeb.confirm.title" }),
      description: context.intl.formatMessage({ id: "logout.localWeb.confirm.description" }),
      confirmLabel: context.intl.formatMessage({ id: "logout.localWeb.confirm.ok" }),
      cancelLabel: context.intl.formatMessage({ id: "logout.confirm.cancel" }),
    });
    if (!confirmed) return;

    let unconfirmed = false;
    try {
      await context.oauthService.logout();
    } catch (error) {
      unconfirmed =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED";
      if (!unconfirmed) {
        await context.requestAlert({
          title: context.intl.formatMessage({ id: "logout.localWeb.failed.title" }),
          description: context.intl.formatMessage({ id: "logout.localWeb.failed.description" }),
        });
        return;
      }
    }

    // 修复原因：旧退出 RPC 的结果可能迟于新登录；身份只由 session 事件的代次栅栏更新。
    if (unconfirmed) {
      await context.requestAlert({
        title: context.intl.formatMessage({ id: "logout.localWeb.unconfirmed.title" }),
        description: context.intl.formatMessage({ id: "logout.localWeb.unconfirmed.description" }),
      });
    }
  };
}
