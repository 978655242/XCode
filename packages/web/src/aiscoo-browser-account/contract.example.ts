import type { BrowserNewApiAccount } from "./contract.js";

/** Attach only after server-confirmed restore; getOwner is a synchronous projection. */
export async function restoreBrowserAccount(account: BrowserNewApiAccount) {
  const session = await account.oauth.restoreCachedSessionState();
  return { owner: account.getOwner(), session };
}

/** Existing WebCallbackPage adapter; the account never accepts arbitrary return targets. */
export async function completeBrowserAccount(account: BrowserNewApiAccount, callbackUrl: string) {
  const result = await account.oauth.handleCallback(callbackUrl);
  return result?.kind === "session" ? { userInfo: result.userInfo, appReturnTo: "/" } : null;
}
