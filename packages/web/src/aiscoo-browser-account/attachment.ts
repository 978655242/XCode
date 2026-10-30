import { Emitter, type IChannelServer, type IServerChannel } from "@zcode/rpc";
import type { NewApiOwner } from "@zcode/shared";
import type { IOAuthService } from "@zcode/services";
import type { BrowserNewApiAccount } from "./contract.js";

// 显式列出可反向调用的公开操作，不能将含凭据的账号对象直接交给反射 RPC。
const oauthMethods = [
  "getProviders",
  "getActiveProvider",
  "restoreSession",
  "startOAuth",
  "startOAuthWithPolling",
  "pollPendingOAuth",
  "handleCallback",
  "refreshToken",
  "logout",
  "logoutAll",
  "cancelPending",
] as const satisfies readonly (keyof IOAuthService)[];

export function registerBrowserAccountChannel(
  server: IChannelServer,
  account: BrowserNewApiAccount,
) {
  const changes = new Emitter<{ owner: NewApiOwner | null }>();
  const subscription = account.oauth.onDidChangeSession(() =>
    changes.fire({ owner: account.getOwner() }),
  );
  // 跨标签身份改变时重新挂载页面，旧确认框及闭包不能追随新账号退出。
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("aiscoo:browser-new-api:"))
      window.location.reload();
  };
  window.addEventListener("storage", onStorage);
  const channel = {
    listen(_context: string, event: string) {
      if (event !== "session") throw new Error("AISCOO_BROWSER_RPC_INVALID");
      return changes.event;
    },
    async call(_context: string, command: string, arg: unknown) {
      if (command === "restore") {
        const session = await account.oauth.restoreCachedSessionState();
        return { owner: account.getOwner(), session };
      }
      if (command === "control" || command === "relay") {
        const owner = (arg as { owner?: NewApiOwner } | undefined)?.owner;
        if (!owner) throw new Error("AISCOO_BROWSER_RPC_INVALID");
        return command === "control"
          ? account.getControlCredential(owner)
          : account.getRelayCredential(owner);
      }
      if (command !== "oauth" || !arg || typeof arg !== "object")
        throw new Error("AISCOO_BROWSER_RPC_INVALID");
      const { method, args } = arg as { method: string; args: unknown[] };
      if (!oauthMethods.includes(method as (typeof oauthMethods)[number]) || !Array.isArray(args)) {
        throw new Error("AISCOO_BROWSER_RPC_INVALID");
      }
      const operation = account.oauth[method as (typeof oauthMethods)[number]] as (
        ...params: unknown[]
      ) => Promise<unknown>;
      return operation.apply(account.oauth, args);
    },
  };
  server.registerChannel("aiscoo/browser-account", channel as IServerChannel);
  return {
    dispose() {
      window.removeEventListener("storage", onStorage);
      subscription.dispose();
      changes.dispose();
    },
  };
}
