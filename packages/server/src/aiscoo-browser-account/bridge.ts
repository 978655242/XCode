import { Emitter, type IChannel, type IChannelClient, type IDisposable } from "@zcode/rpc";
import type { IOAuthService } from "@zcode/services";
import { normalizeNewApiOrigin, type NewApiOwner, type OAuthSessionState } from "@zcode/shared";
import {
  BROWSER_ACCOUNT_CHANNEL,
  BROWSER_ACCOUNT_OAUTH_METHODS,
  type BrowserAccountAuthority,
  type BrowserAccountBridge,
  type BrowserAccountBridgeOptions,
  type BrowserAccountControlResult,
  type BrowserAccountOAuthMethod,
  type BrowserAccountOAuthResult,
  type BrowserAccountRelayResult,
  type BrowserAccountRestoreResult,
  type BrowserAccountSessionEvent,
} from "./contract.js";
import {
  bridgeError,
  publicOAuth,
  publicSession,
  readOwner,
  requireWire,
  sameOwner,
  sanitizedError,
} from "./wire.js";

type Attachment = { channel: IChannel; ready: Promise<void>; subscription?: IDisposable };

export function createBrowserAccountBridge(
  configuredOrigin: string,
  options: BrowserAccountBridgeOptions = {},
): BrowserAccountBridge {
  const origin = normalizeNewApiOrigin(configuredOrigin);
  const changes = new Emitter<OAuthSessionState>();
  let attached: Attachment | null = null;
  let owner: NewApiOwner | null = null;
  let revision = 0;
  let disposed = false;
  let ownerAcceptance: Promise<void> = Promise.resolve();

  function current(expected: Attachment | null, capturedRevision = revision): void {
    if (attached !== expected || revision !== capturedRevision)
      throw bridgeError("XCODE_STALE_OWNER");
  }
  function connection(): Attachment {
    if (!attached) throw bridgeError("XCODE_BROWSER_ACCOUNT_UNAVAILABLE");
    return attached;
  }
  async function request<T>(source: Attachment, command: string, arg?: unknown): Promise<T> {
    try {
      return await source.channel.call<T>(command, arg);
    } catch (error) {
      throw sanitizedError(error);
    }
  }
  async function transition(
    source: Attachment | null,
    next: NewApiOwner | null,
    force = false,
  ): Promise<void> {
    current(source);
    if (!force && sameOwner(owner, next)) return;
    // 先替换投影和修订，使旧读取立即失效；清理 hook 的异步结果不能复活旧连接。
    owner = next;
    const capturedRevision = ++revision;
    try {
      await options.onOwnerChanged?.(next);
      current(source, capturedRevision);
      changes.fire(next ? "signed-in" : "signed-out");
    } catch (error) {
      if (attached === source && revision === capturedRevision) {
        owner = null;
        revision++;
      }
      throw sanitizedError(error);
    }
  }
  function detach(source: Attachment): void {
    if (attached !== source) return;
    attached = null;
    // transition 在首个 await 前同步清空 owner，不能等待 hook 或 socket 清理。
    const invalidated = transition(null, null, true);
    source.subscription?.dispose();
    void invalidated.catch(() => undefined);
  }
  async function restore(source: Attachment): Promise<BrowserAccountRestoreResult["session"]> {
    current(source);
    const capturedRevision = revision;
    const capturedOwner = owner;
    const result = await request<BrowserAccountRestoreResult>(source, "restore");
    current(source);
    const next = readOwner(result?.owner, origin);
    const session = publicSession(result?.session);
    requireWire(
      session.status === "authenticated"
        ? next !== null && session.userInfo?.id === next.userId
        : next === null,
    );
    // 浏览器在 restore 返回前可先发布同一 owner；等待该次 hook，不能把回声误判为旧恢复。
    if (
      revision !== capturedRevision &&
      !(
        revision === capturedRevision + 1 &&
        capturedOwner === null &&
        next !== null &&
        sameOwner(owner, next)
      )
    )
      throw bridgeError("XCODE_STALE_OWNER");
    if (!sameOwner(owner, next)) ownerAcceptance = transition(source, next);
    const acceptedRevision = revision;
    await ownerAcceptance;
    current(source, acceptedRevision);
    return session;
  }
  async function cachedSession() {
    const source = connection();
    await source.ready;
    current(source);
    return restore(source);
  }
  async function cachedUser() {
    const session = await cachedSession();
    if (session.status === "unavailable")
      throw bridgeError(
        session.reason === "backend-unavailable"
          ? "XCODE_BACKEND_UNAVAILABLE"
          : "XCODE_CREDENTIAL_RECOVERY_REQUIRED",
      );
    return session.status === "authenticated" ? session.userInfo : null;
  }
  async function oauth<M extends BrowserAccountOAuthMethod>(
    method: M,
    ...args: Parameters<IOAuthService[M]>
  ): Promise<BrowserAccountOAuthResult<M>> {
    requireWire(BROWSER_ACCOUNT_OAUTH_METHODS.includes(method));
    const source = connection();
    await source.ready;
    current(source);
    const capturedRevision = revision;
    const result = await request(source, "oauth", { method, args });
    current(source);
    // 登录/退出等命令可发布新 owner；只读返回必须仍属于捕获的修订。
    if (["getProviders", "getActiveProvider", "restoreSession"].includes(method))
      current(source, capturedRevision);
    return publicOAuth(method, result);
  }
  const authority: BrowserAccountAuthority = {
    oauth: Object.freeze({
      onDidChangeSession: changes.event,
      getProviders: () => oauth("getProviders"),
      getActiveProvider: () => oauth("getActiveProvider"),
      restoreCachedSession: cachedUser,
      restoreCachedSessionState: cachedSession,
      restoreSession: () => oauth("restoreSession"),
      startOAuth: (provider) => oauth("startOAuth", provider),
      startOAuthWithPolling: (provider) => oauth("startOAuthWithPolling", provider),
      pollPendingOAuth: () => oauth("pollPendingOAuth"),
      handleCallback: (url) => oauth("handleCallback", url),
      refreshToken: (...args) => oauth("refreshToken", ...args),
      logout: (...args) => oauth("logout", ...args),
      logoutAll: () => oauth("logoutAll"),
      cancelPending: (...args) => oauth("cancelPending", ...args),
    } satisfies IOAuthService),
    getOwner: () => owner,
    isCurrent: (expected) => !!attached && !!owner && sameOwner(owner, expected),
    async withControlSession(action) {
      const source = connection();
      const expected = owner;
      const capturedRevision = revision;
      if (!expected) throw bridgeError("XCODE_SESSION_INVALID");
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await request<BrowserAccountControlResult>(source, "control", {
            owner: expected,
          });
          current(source, capturedRevision);
          if (!sameOwner(readOwner(result?.owner, origin), expected))
            throw bridgeError("XCODE_STALE_OWNER");
          requireWire(typeof result.accessToken === "string" && result.accessToken.length > 0);
          try {
            const output = await action(result.accessToken, expected);
            current(source, capturedRevision);
            return output;
          } catch (error) {
            current(source, capturedRevision);
            // 远端已确认 control 过期时，仅委托浏览器刷新一次；每次 await 后仍校验原 owner。
            if (attempt !== 0 || sanitizedError(error).code !== "XCODE_ACCESS_EXPIRED") throw error;
            await request(source, "oauth", { method: "refreshToken", args: ["new-api"] });
            current(source, capturedRevision);
          }
        }
        throw bridgeError("XCODE_ACCESS_EXPIRED");
      } catch (error) {
        current(source, capturedRevision);
        const failure = sanitizedError(error);
        if (["XCODE_SESSION_INVALID", "XCODE_CREDENTIAL_SCOPE_DENIED"].includes(failure.code)) {
          // Native 已确认撤销；先同步清空 Host 投影，再通知浏览器按捕获代次清凭据，不能等待清理 hook。
          ownerAcceptance = transition(source, null);
          const invalidatedRevision = revision;
          const notified = request<void>(source, "invalidateCredential", { owner: expected });
          await Promise.all([ownerAcceptance, notified]);
          current(source, invalidatedRevision);
        }
        throw failure;
      }
    },
    async getRelayCredential(expected) {
      const source = connection();
      const capturedRevision = revision;
      if (!owner || !sameOwner(owner, expected)) throw bridgeError("XCODE_STALE_OWNER");
      try {
        const result = await request<BrowserAccountRelayResult>(source, "relay", { owner });
        current(source, capturedRevision);
        requireWire(
          typeof result?.token === "string" &&
            result.token.length > 0 &&
            Number.isSafeInteger(result.expiresAt),
        );
        if (result.expiresAt <= Date.now()) throw bridgeError("XCODE_SESSION_INVALID");
        return { token: result.token, expiresAt: result.expiresAt };
      } catch (error) {
        current(source, capturedRevision);
        throw sanitizedError(error);
      }
    },
  };
  return {
    authority,
    attach(client: IChannelClient) {
      if (disposed) throw bridgeError("XCODE_BROWSER_ACCOUNT_DISPOSED");
      if (attached) throw bridgeError("XCODE_BROWSER_ACCOUNT_ATTACHED");
      const source: Attachment = {
        channel: client.getChannel(BROWSER_ACCOUNT_CHANNEL),
        ready: Promise.resolve(),
      };
      attached = source;
      ownerAcceptance = Promise.resolve();
      revision++;
      try {
        source.subscription = source.channel.listen<BrowserAccountSessionEvent>("session")(
          (event) => {
            if (attached !== source) return;
            try {
              const next = readOwner(event?.owner, origin);
              if (sameOwner(owner, next)) return;
              ownerAcceptance = transition(source, next);
              void ownerAcceptance.catch(() => {
                if (attached === source && !owner) detach(source);
              });
            } catch {
              detach(source);
            }
          },
        );
        source.ready = restore(source).then(() => undefined);
        void source.ready.catch(() => {
          if (attached === source) detach(source);
        });
      } catch (error) {
        detach(source);
        throw sanitizedError(error);
      }
      return { ready: source.ready, dispose: () => detach(source) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (attached) detach(attached);
      changes.dispose();
    },
  };
}
