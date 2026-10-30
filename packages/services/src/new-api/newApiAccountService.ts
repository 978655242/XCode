import {
  NEW_API_PROVIDER_ID,
  type NewApiOwner,
  type NewApiSessionBundle,
  type OAuthCachedSessionRestoreResult,
  type OAuthCallbackResult,
  type OAuthProviderId,
  type OAuthStartResponse,
  type OAuthSessionState,
} from "@zcode/shared";
import { randomUUID } from "node:crypto";
import { Emitter } from "@zcode/rpc";
import type { IOAuthService } from "../oauth/oauth.js";
import type { NewApiProviderAdapter } from "../oauth/providers/newApiProviderAdapter.js";
import type { NewApiSessionRepo, NewApiStoredSession } from "./newApiSessionRepo.js";
import {
  refreshStoredSession,
  restoreSessionProfile,
  revokeSession,
  type NewApiSessionRefreshFlight,
} from "./newApiSessionOperations.js";
import {
  cachedSessionProfile,
  confirmedProfile,
  errorCode,
  isCurrentOwner,
  isPendingAuthorizationCurrent,
  isRevocation,
  sessionError,
  sessionOwner,
  unavailableSession,
  validateProvider,
  pendingAuthorization,
  validateRotatedSession,
  validateSession,
  type NewApiAuthorizationFlight,
  type PendingNewApiAuthorization,
} from "./newApiSessionValidation.js";

// XCODE: 每轮 listener 独立持有回调和 redirect，不能由新登录覆盖旧轮兑换参数。
export interface NewApiHostAuthorization {
  start(): Promise<{
    state: string;
    codeVerifier: string;
    authorizeUrl: string;
    wait(): Promise<{ state: string; code: string }>;
    exchange(code: string, verifier: string): Promise<NewApiSessionBundle>;
    close(): Promise<void>;
  }>;
}

type NewApiHostAuthorizationAttempt = Awaited<ReturnType<NewApiHostAuthorization["start"]>>;

export class NewApiAccountService {
  readonly oauth: IOAuthService;
  #sessionChanges = new Emitter<OAuthSessionState>();
  #authorizationFailures = new Emitter<{
    provider: OAuthProviderId;
    state: string;
    reason: "expired" | "backend-unavailable" | "authorization-failed";
  }>();
  #adapter: NewApiProviderAdapter;
  #repo: NewApiSessionRepo;
  #now: () => number;
  #readNow = () => this.#now();
  #onOwnerChanged: (owner: NewApiOwner | null) => Promise<void> | void;
  #generation = 0;
  #pending: PendingNewApiAuthorization | null = null;
  #callbackFlight: NewApiAuthorizationFlight | null = null;
  #session: NewApiStoredSession | null = null;
  #owner: NewApiOwner | null = null;
  #mutations: Promise<unknown> = Promise.resolve();
  #refreshFlight: NewApiSessionRefreshFlight | null = null;
  #restoreFlight: { generation: number; promise: Promise<OAuthCachedSessionRestoreResult> } | null =
    null;
  #authorization?: NewApiHostAuthorization;
  #authorizationAttempt: NewApiHostAuthorizationAttempt | null = null;
  #authorizationStarting = false;
  #localWebLogoutBlocked = false;
  #localWebLogoutIncomplete = false;
  #localWebLogoutFlight: Promise<void> | null = null;
  #localWebLogoutFlightToken: string | null = null;
  // XCODE: 代次令牌带本次 Host 的随机前缀，Host 重启后计数回到相同数值也不能匹配旧确认。
  #hostNonce = randomUUID();
  // XCODE: 记录所有仍在途的远端撤销，本机退出据此收拢此前已接纳的补偿结果。
  #pendingRevocations = new Set<Promise<boolean>>();
  #logoutRecord: { failed: boolean; revoked: Set<string> } | null = null;
  #background = new Set<Promise<unknown>>();
  #logoutDeadline: () => AbortSignal;

  constructor(dependencies: {
    adapter: NewApiProviderAdapter;
    repo: NewApiSessionRepo;
    now?: () => number;
    onOwnerChanged?: (owner: NewApiOwner | null) => Promise<void> | void;
    // XCODE: 仅替换授权传输；代次、凭据提交与补偿仍归同一个账号 owner。
    authorization?: NewApiHostAuthorization;
    // XCODE: 本机退出等待在途远端操作的上限；到期只能判定为撤销未确认，不能判定成功。
    localWebLogoutDeadline?: () => AbortSignal;
  }) {
    this.#logoutDeadline =
      dependencies.localWebLogoutDeadline ?? (() => AbortSignal.timeout(15_000));
    this.#adapter = dependencies.adapter;
    this.#repo = dependencies.repo;
    this.#authorization = dependencies.authorization;
    this.#now = dependencies.now ?? Date.now;
    this.#onOwnerChanged = (owner) => {
      // XCODE: 主身份失效立即通知现有 OAuth 消费者，不等待官方连接/Provider 清理或撤销网络。
      if (!owner) this.#sessionChanges.fire("signed-out");
      return dependencies.onOwnerChanged?.(owner);
    };
    // XCODE: RPC 只注册显式公开投影，Host 的 SID、refresh 与 relay 凭据永不进入反射对象。
    this.oauth = Object.freeze({
      onDidChangeSession: this.#sessionChanges.event,
      // XCODE: 仅本机回环登录暴露失败事件，桌面 RPC 面保持原样。
      ...(this.#authorization
        ? {
            onDidFailAuthorization: this.#authorizationFailures.event,
            getLocalWebAuthorizationCapabilities: async () => ({ failureEvents: true as const }),
            // 修复原因：确认框和退出请求之间可能发生 A→B→A；只有当前 Host 代次可进入退出屏障。
            getLocalWebLogoutToken: async () => this.#logoutToken(),
            logoutLocalWeb: async (token: string) => {
              // 同一确认重复提交时加入已在进行的退出，其余旧令牌一律拒绝且不触碰当前身份。
              const joinsFlight =
                this.#localWebLogoutFlight !== null && token === this.#localWebLogoutFlightToken;
              if (token !== this.#logoutToken() && !joinsFlight)
                throw sessionError("XCODE_STALE_OWNER");
              await this.#logout();
            },
            cancelLocalWebAuthorization: async (state: string) => {
              if (!this.#pending || this.#pending.state !== state) return;
              await this.oauth.cancelPending(NEW_API_PROVIDER_ID);
            },
          }
        : {}),
      getProviders: async () => [{ ...this.#adapter.meta }],
      getActiveProvider: async () => (this.#owner ? NEW_API_PROVIDER_ID : null),
      restoreCachedSession: async () => cachedSessionProfile(await this.#restore()),
      restoreCachedSessionState: async () => this.#restore(),
      restoreSession: async () => cachedSessionProfile(await this.#restore()),
      startOAuth: async (provider: OAuthProviderId) => this.#start(provider),
      startOAuthWithPolling: async () => {
        throw sessionError("XCODE_PRIVATE_POLLING_UNSUPPORTED");
      },
      pollPendingOAuth: async () => {
        throw sessionError("XCODE_PRIVATE_POLLING_UNSUPPORTED");
      },
      // XCODE: 回环 code 只能由 Host listener 送入 owner，拒绝经公共 RPC 转发。
      handleCallback: async (url: string) =>
        this.#authorization ? null : this.#handleCallback(url),
      refreshToken: async (provider?: OAuthProviderId) => {
        validateProvider(provider);
        await this.#refresh();
      },
      logout: async (provider?: OAuthProviderId) => {
        validateProvider(provider);
        await this.#logout();
      },
      logoutAll: async () => this.#logout(),
      cancelPending: async (provider?: OAuthProviderId) => {
        validateProvider(provider);
        if (!this.#pending && !this.#authorizationAttempt && !this.#authorizationStarting) return;
        this.#authorizationStarting = false;
        this.#generation++;
        this.#pending = null;
        this.#owner = null;
        const attempt = this.#authorizationAttempt;
        this.#authorizationAttempt = null;
        await this.#onOwnerChanged(null);
        await attempt?.close();
      },
    });
  }

  #logoutToken(): string {
    return `${this.#hostNonce}.${this.#generation}`;
  }

  /** 等待本 Host 内仍在途的账号操作结束；用于关闭 Host 前避免迟到补偿写入已删除的数据根。 */
  async idle(): Promise<void> {
    const seen = new Set<Promise<unknown>>();
    for (;;) {
      const candidates: Array<Promise<unknown> | null | undefined> = [
        this.#mutations,
        this.#refreshFlight?.promise,
        this.#callbackFlight?.promise,
        this.#localWebLogoutFlight,
        ...this.#background,
        ...this.#pendingRevocations,
      ];
      const batch = candidates.filter(
        (promise): promise is Promise<unknown> => !!promise && !seen.has(promise),
      );
      if (!batch.length) return;
      for (const promise of batch) seen.add(promise);
      await Promise.allSettled(batch);
    }
  }

  /** 被新标签替换的等待中尝试需要可观察的结束事件；取消和销毁不发布失败。 */
  #endPendingAuthorization(pending: PendingNewApiAuthorization | null): void {
    if (!pending) return;
    this.#authorizationFailures.fire({
      provider: NEW_API_PROVIDER_ID,
      state: pending.state,
      reason: "authorization-failed",
    });
  }

  #track(promise: Promise<unknown>): void {
    this.#background.add(promise);
    void promise.finally(() => this.#background.delete(promise)).catch(() => undefined);
  }

  #revoke(bundle: NewApiSessionBundle): Promise<boolean> {
    const run: Promise<boolean> = revokeSession(this.#adapter, bundle)
      .then((confirmed) => {
        const record = this.#logoutRecord;
        if (record) {
          if (confirmed) record.revoked.add(bundle.session_id);
          else record.failed = true;
        }
        return confirmed;
      })
      .finally(() => {
        this.#pendingRevocations.delete(run);
      });
    this.#pendingRevocations.add(run);
    return run;
  }

  getOwner(): NewApiOwner | null {
    return this.#owner;
  }

  isCurrent(owner: NewApiOwner): boolean {
    return isCurrentOwner(this.#owner, owner);
  }

  async withControlSession<T>(
    action: (accessToken: string, owner: NewApiOwner) => Promise<T>,
  ): Promise<T> {
    const owner = this.#owner;
    if (!owner || !this.#session) throw sessionError("XCODE_SESSION_INVALID");
    let refreshed = false;
    try {
      if (this.#session.bundle.access_expires_at <= this.#now()) {
        await this.#refresh();
        refreshed = true;
      }
      if (!this.isCurrent(owner) || !this.#session) throw sessionError("XCODE_STALE_OWNER");
      let result: T;
      const accessToken = this.#session.bundle.access_token;
      try {
        result = await action(accessToken, owner);
      } catch (error) {
        if (!this.isCurrent(owner)) throw sessionError("XCODE_STALE_OWNER");
        if (refreshed || errorCode(error) !== "XCODE_ACCESS_EXPIRED") throw error;
        if (this.#session?.bundle.access_token === accessToken) await this.#refresh();
        if (!this.isCurrent(owner) || !this.#session) throw sessionError("XCODE_STALE_OWNER");
        result = await action(this.#session.bundle.access_token, owner);
      }
      if (!this.isCurrent(owner)) throw sessionError("XCODE_STALE_OWNER");
      return result;
    } catch (error) {
      if (isRevocation(error) && this.isCurrent(owner))
        await this.#invalidate(this.#session!, this.#generation);
      throw error;
    }
  }

  async getRelayCredential(owner: NewApiOwner): Promise<{ token: string; expiresAt: number }> {
    if (!this.isCurrent(owner) || !this.#session) throw sessionError("XCODE_STALE_OWNER");
    const credential = this.#session.bundle.relay_credential;
    if (credential.expires_at <= this.#now()) {
      await this.#invalidate(this.#session, this.#generation);
      throw sessionError("XCODE_SESSION_INVALID");
    }
    return { token: credential.token, expiresAt: credential.expires_at };
  }

  #mutate<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#mutations.catch(() => undefined).then(run);
    this.#mutations = next;
    return next;
  }

  async #start(provider: OAuthProviderId): Promise<OAuthStartResponse> {
    validateProvider(provider);
    this.#repo.assertStorageAvailable();
    // XCODE: 新登录等本机退出完成，避免旧退出清理与新会话提交交错。
    if (this.#authorization && this.#localWebLogoutFlight)
      await this.#localWebLogoutFlight.catch(() => undefined);
    if (this.#authorization && this.#localWebLogoutIncomplete)
      throw sessionError("XCODE_LOCAL_WEB_LOGOUT_INCOMPLETE");
    if (this.#authorization) return this.#startHostAuthorization();
    const authorization = this.#adapter.createAuthorization();
    const generation = ++this.#generation;
    this.#owner = null;
    this.#pending = pendingAuthorization(authorization, generation, this.#now());
    await this.#onOwnerChanged(null);
    if (generation !== this.#generation) throw sessionError("XCODE_STALE_OWNER");
    return {
      provider: NEW_API_PROVIDER_ID,
      purpose: "primary-account",
      state: authorization.state,
      authorizeUrl: authorization.authorizeUrl,
    };
  }

  async #startHostAuthorization(): Promise<OAuthStartResponse> {
    const generation = ++this.#generation;
    const previous = this.#authorizationAttempt;
    // XCODE: 被新标签替换的等待中登录需要可观察的结束事件，否则旧标签会一直等待。
    const replaced = previous && this.#pending ? this.#pending : null;
    this.#authorizationAttempt = null;
    this.#authorizationStarting = true;
    this.#pending = null;
    this.#owner = null;
    this.#endPendingAuthorization(replaced);
    await this.#onOwnerChanged(null);
    await previous?.close();
    if (generation !== this.#generation) throw sessionError("XCODE_STALE_OWNER");
    let attempt: NewApiHostAuthorizationAttempt;
    try {
      attempt = await this.#authorization!.start();
    } catch (error) {
      if (generation === this.#generation) this.#authorizationStarting = false;
      throw error;
    }
    if (generation !== this.#generation) {
      await attempt.close();
      throw sessionError("XCODE_STALE_OWNER");
    }
    this.#authorizationStarting = false;
    this.#authorizationAttempt = attempt;
    const pending = pendingAuthorization(attempt, generation, this.#now());
    this.#pending = pending;
    this.#track(this.#receiveHostAuthorization(attempt, pending));
    return {
      provider: NEW_API_PROVIDER_ID,
      purpose: "primary-account",
      state: attempt.state,
      authorizeUrl: attempt.authorizeUrl,
    };
  }

  async #receiveHostAuthorization(
    attempt: NewApiHostAuthorizationAttempt,
    pending: PendingNewApiAuthorization,
  ): Promise<void> {
    try {
      const callback = await attempt.wait();
      if (
        callback.state !== pending.state ||
        pending.generation !== this.#generation ||
        this.#pending !== pending
      )
        return;
      if (pending.expiresAt <= this.#now()) throw sessionError("XCODE_AUTH_EXPIRED");
      const promise = this.#complete(pending, callback.code, (code, verifier) =>
        attempt.exchange(code, verifier),
      );
      const flight = { pending, promise };
      this.#callbackFlight = flight;
      try {
        const result = await promise;
        if (!result && pending.generation === this.#generation && pending.expiresAt <= this.#now())
          throw sessionError("XCODE_AUTH_EXPIRED");
      } finally {
        if (this.#callbackFlight === flight) this.#callbackFlight = null;
      }
    } catch (error) {
      // XCODE: 只发布当前代次的静态错误类别，回调 URL 与后端原始错误不进入事件或日志。
      if (pending.generation === this.#generation && this.#authorizationAttempt === attempt) {
        if (this.#pending === pending) this.#pending = null;
        const code = errorCode(error);
        this.#authorizationFailures.fire({
          provider: NEW_API_PROVIDER_ID,
          state: pending.state,
          reason:
            code === "XCODE_AUTH_EXPIRED"
              ? "expired"
              : code === "XCODE_BACKEND_UNAVAILABLE"
                ? "backend-unavailable"
                : "authorization-failed",
        });
      }
    } finally {
      if (this.#authorizationAttempt === attempt) this.#authorizationAttempt = null;
      await attempt.close().catch(() => undefined);
    }
  }

  async #handleCallback(url: string): Promise<OAuthCallbackResult | null> {
    const parsed = this.#adapter.parseCallback(url);
    const pending = this.#pending;
    if (
      !pending ||
      parsed.state !== pending.state ||
      pending.generation !== this.#generation ||
      pending.expiresAt <= this.#now()
    )
      return null;
    if (this.#callbackFlight?.pending === pending) return this.#callbackFlight.promise;
    const promise = this.#complete(pending, parsed.code);
    const flight = { pending, promise };
    this.#callbackFlight = flight;
    try {
      return await promise;
    } finally {
      if (this.#callbackFlight === flight) this.#callbackFlight = null;
    }
  }

  async #complete(
    pending: PendingNewApiAuthorization,
    code: string,
    exchange: (code: string, verifier: string) => Promise<NewApiSessionBundle> = (
      value,
      verifier,
    ) => this.#adapter.exchangeCode(value, verifier),
  ): Promise<OAuthCallbackResult | null> {
    let bundle: NewApiSessionBundle | null = null;
    let published = false;
    let displaced = this.#session;
    try {
      bundle = await exchange(code, pending.codeVerifier);
      if (!isPendingAuthorizationCurrent(this.#pending, pending, this.#generation, this.#readNow))
        return null;
      validateSession(bundle, this.#now(), true);
      const userInfo = confirmedProfile(
        await this.#adapter.client.getMe(bundle.access_token),
        bundle,
      );
      const record: NewApiStoredSession = {
        schemaVersion: 1,
        origin: this.#adapter.client.origin,
        bundle,
      };
      const result = await this.#mutate<OAuthCallbackResult | null>(async () => {
        if (!isPendingAuthorizationCurrent(this.#pending, pending, this.#generation, this.#readNow))
          return null;
        const previous = await this.#repo.loadActive();
        if (this.#pending !== pending || pending.generation !== this.#generation) return null;
        await this.#repo.commit(record);
        // XCODE: 取消可发生在文件锁持有期间；提交后必须补偿，不能复活旧登录。
        if (
          !isPendingAuthorizationCurrent(this.#pending, pending, this.#generation, this.#readNow)
        ) {
          await this.#abandonCommitted(record, previous);
          return null;
        }
        displaced = this.#session;
        this.#session = record;
        this.#owner = sessionOwner(record, pending.generation);
        try {
          await this.#onOwnerChanged(this.#owner);
        } catch (error) {
          this.#owner = null;
          if (this.#session === record) this.#session = displaced;
          await this.#repo.revert(record, previous);
          throw error;
        }
        if (
          !isPendingAuthorizationCurrent(this.#pending, pending, this.#generation, this.#readNow)
        ) {
          if (this.#session === record) this.#session = displaced;
          if (this.#owner?.authGeneration === pending.generation) {
            this.#owner = null;
            await this.#onOwnerChanged(null);
          }
          await this.#abandonCommitted(record, previous);
          return null;
        }
        this.#pending = null;
        if (this.#authorization) this.#localWebLogoutBlocked = false;
        published = true;
        this.#sessionChanges.fire("signed-in");
        return { kind: "session", provider: NEW_API_PROVIDER_ID, userInfo };
      });
      if (published && displaced && displaced.bundle.session_id !== bundle.session_id) {
        const removed = await this.#mutate(async () => this.#repo.remove(displaced!));
        await this.#revoke((removed ?? displaced).bundle);
      }
      return pending.generation === this.#generation ? result : null;
    } catch (error) {
      if (pending.generation !== this.#generation || (!published && this.#pending !== pending))
        return null;
      if (!published) this.#pending = null;
      throw error;
    } finally {
      if (bundle && !published) await this.#revoke(bundle);
    }
  }

  /** 已提交但发布前被放弃的新会话：本机退出时不得把 active 恢复到被替换的旧账号。 */
  async #abandonCommitted(
    record: NewApiStoredSession,
    previous: NewApiStoredSession | null,
  ): Promise<void> {
    if (!(this.#authorization && this.#localWebLogoutBlocked)) {
      await this.#repo.revert(record, previous);
      return;
    }
    // 修复原因：退出期间回滚到 previous 会让冷启动复活旧账号；退出同时终结被替换的旧会话。
    await this.#repo.revert(record, null);
    if (previous && previous.bundle.session_id !== record.bundle.session_id) {
      const removed = await this.#repo.remove(previous);
      await this.#revoke((removed ?? previous).bundle);
    }
  }

  async #restore(): Promise<OAuthCachedSessionRestoreResult> {
    const generation = this.#generation;
    // XCODE: 退出已失效 owner 但 active pointer 可能尚未删除，不能恢复旧会话。
    if (this.#localWebLogoutBlocked || this.#pending || this.#authorizationStarting)
      return { status: "signed-out" };
    if (this.#restoreFlight?.generation === generation) return this.#restoreFlight.promise;
    const promise = this.#restoreCurrent(generation);
    const flight = { generation, promise };
    this.#restoreFlight = flight;
    try {
      return await promise;
    } finally {
      if (this.#restoreFlight === flight) this.#restoreFlight = null;
    }
  }

  async #restoreCurrent(generation: number): Promise<OAuthCachedSessionRestoreResult> {
    let record: NewApiStoredSession | null = null;
    try {
      this.#repo.assertStorageAvailable();
      record = this.#session ?? (await this.#repo.loadActive());
      if (generation !== this.#generation || this.#pending) return { status: "signed-out" };
      if (!record) return { status: "signed-out" };
      if (record.origin !== this.#adapter.client.origin)
        throw sessionError("XCODE_PROTOCOL_INVALID");
      validateSession(record.bundle, this.#now(), false);
      await this.#mutate(async () => {
        if (generation !== this.#generation) throw sessionError("XCODE_STALE_OWNER");
        this.#session = record;
      });
      const userInfo = await restoreSessionProfile(
        this.#adapter,
        record,
        () => this.#session,
        this.#readNow,
        () => this.#refresh(),
      );
      const restoredOwner = await this.#mutate(async () => {
        if (generation !== this.#generation || !this.#session)
          throw sessionError("XCODE_STALE_OWNER");
        if (!this.#owner) {
          this.#owner = sessionOwner(record!, generation);
          try {
            await this.#onOwnerChanged(this.#owner);
          } catch (error) {
            this.#owner = null;
            throw error;
          }
          return true;
        }
        return false;
      });
      if (generation !== this.#generation) return { status: "signed-out" };
      if (restoredOwner) this.#sessionChanges.fire("signed-in");
      if (generation !== this.#generation) return { status: "signed-out" };
      return { status: "authenticated", userInfo };
    } catch (error) {
      if (generation !== this.#generation) return { status: "signed-out" };
      if (record && isRevocation(error)) {
        await this.#invalidate(this.#session ?? record, generation);
        return { status: "signed-out" };
      }
      return unavailableSession(error);
    }
  }

  async #refresh(): Promise<void> {
    const expected = this.#session;
    const generation = this.#generation;
    if (!expected) throw sessionError("XCODE_SESSION_INVALID");
    if (
      this.#refreshFlight?.generation === generation &&
      this.#refreshFlight.session.bundle.session_id === expected.bundle.session_id
    )
      return this.#refreshFlight.promise;
    const promise = this.#rotate(expected, generation);
    const flight = { session: expected, generation, promise };
    this.#refreshFlight = flight;
    try {
      await promise;
    } finally {
      if (this.#refreshFlight === flight) this.#refreshFlight = null;
    }
  }

  async #rotate(expected: NewApiStoredSession, generation: number): Promise<void> {
    let acquired: NewApiSessionBundle | null = null;
    try {
      if (expected.bundle.refresh_expires_at <= this.#now())
        throw sessionError("XCODE_SESSION_INVALID");
      const next = await this.#mutate(async () => {
        if (generation !== this.#generation || this.#session !== expected)
          throw sessionError("XCODE_STALE_OWNER");
        let rotated: NewApiStoredSession | null;
        try {
          rotated = await refreshStoredSession(
            this.#repo,
            this.#adapter,
            expected,
            this.#readNow,
            () => {
              if (generation !== this.#generation) throw sessionError("XCODE_STALE_OWNER");
            },
            (bundle) => {
              acquired = bundle;
            },
          );
        } catch (error) {
          // 修复原因：后继已签发但校验或落盘失败时，只有原 owner 能用准确 SID/refresh 补偿。
          if (this.#authorization && acquired) await this.#revoke(acquired);
          throw error;
        }
        if (!rotated) {
          if (acquired) await this.#revoke(acquired);
          // 本机退出已移除记录时，这是旧代次结果，而不是后端判定会话无效。
          throw sessionError(
            this.#authorization && generation !== this.#generation
              ? "XCODE_STALE_OWNER"
              : "XCODE_SESSION_INVALID",
          );
        }
        validateRotatedSession(rotated, expected, this.#now());
        if (generation !== this.#generation) {
          // XCODE: 本机退出必须由 logout 撤销轮换后的凭据并报告结果，不能吞掉后继撤销失败。
          if (this.#authorization && this.#localWebLogoutBlocked) {
            throw sessionError("XCODE_STALE_OWNER");
          }
          if (this.#session === null) {
            const removed = await this.#repo.remove(rotated);
            await this.#revoke((removed ?? rotated).bundle);
          } else if (this.#session === expected) this.#session = rotated;
          throw sessionError("XCODE_STALE_OWNER");
        }
        this.#session = rotated;
        return rotated;
      });
      // XCODE: 先保存轮换后的 refresh，避免 Me 暂时 503 丢失仍可恢复的后继凭据。
      confirmedProfile(await this.#adapter.client.getMe(next.bundle.access_token), next.bundle);
      if (generation !== this.#generation) throw sessionError("XCODE_STALE_OWNER");
    } catch (error) {
      if (generation === this.#generation && isRevocation(error)) {
        await this.#invalidate(this.#session ?? expected, generation);
      }
      throw error;
    }
  }

  async #invalidate(expected: NewApiStoredSession, generation: number): Promise<void> {
    if (generation !== this.#generation) return;
    this.#generation++;
    this.#owner = null;
    this.#pending = null;
    this.#authorizationStarting = false;
    const attempt = this.#authorizationAttempt;
    this.#authorizationAttempt = null;
    this.#session = null;
    await this.#onOwnerChanged(null);
    await attempt?.close();
    const removed = await this.#mutate(async () => this.#repo.remove(expected));
    await this.#revoke((removed ?? expected).bundle);
  }

  #logout(): Promise<void> {
    if (!this.#authorization) return this.#logoutDesktop();
    if (this.#localWebLogoutFlight) return this.#localWebLogoutFlight;
    this.#localWebLogoutFlightToken = this.#logoutToken();
    this.#localWebLogoutBlocked = true;
    this.#localWebLogoutIncomplete = true;
    const flight = this.#logoutLocalWeb();
    this.#localWebLogoutFlight = flight;
    void flight
      .finally(() => {
        if (this.#localWebLogoutFlight === flight) {
          this.#localWebLogoutFlight = null;
          this.#localWebLogoutFlightToken = null;
        }
      })
      .catch(() => undefined);
    return flight;
  }

  async #logoutLocalWeb(): Promise<void> {
    const expected = this.#session;
    this.#generation++;
    this.#owner = null;
    this.#pending = null;
    this.#authorizationStarting = false;
    const attempt = this.#authorizationAttempt;
    this.#authorizationAttempt = null;
    this.#session = null;
    const record = { failed: false, revoked: new Set<string>() };
    this.#logoutRecord = record;
    try {
      // 修复原因：本地移除不能排在可能永不返回的 refresh 之后；records 的文件锁已保证原子性，
      // 迟到的 refresh 找不到记录时由原 owner 补偿其已签发后继。
      const removed = Promise.resolve().then(async () => {
        const target = expected ?? (await this.#repo.loadActive());
        return target ? this.#repo.remove(target) : null;
      });
      const cleanup = Promise.resolve().then(() => this.#onOwnerChanged(null));
      const closed = Promise.resolve().then(() => attempt?.close());
      const [local, derived, listener] = await Promise.allSettled([removed, cleanup, closed]);
      if (local.status === "rejected") throw local.reason;
      // 收拢此前已接纳的 refresh、授权兑换与失效撤销；到期仍未结束只能报告未确认。
      const timedOut = await this.#drainLocalWebOperations();
      // 即使派生清理失败，也须撤销已移除的精确会话；同 SID 已确认撤销时不再用旧凭据重复请求。
      let removedConfirmed = true;
      if (local.value && !record.revoked.has(local.value.bundle.session_id))
        removedConfirmed = await this.#revoke(local.value.bundle);
      if (derived.status === "rejected") throw derived.reason;
      if (listener.status === "rejected") throw listener.reason;
      this.#localWebLogoutIncomplete = false;
      if (timedOut || record.failed || !removedConfirmed)
        throw sessionError("XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED");
    } finally {
      if (this.#logoutRecord === record) this.#logoutRecord = null;
    }
  }

  /** 返回 true 表示等待到期，仍有无法证明结果的在途操作。 */
  async #drainLocalWebOperations(): Promise<boolean> {
    const signal = this.#logoutDeadline();
    const expired = new Promise<true>((resolve) => {
      if (signal.aborted) resolve(true);
      else signal.addEventListener("abort", () => resolve(true), { once: true });
    });
    const seen = new Set<Promise<unknown>>();
    const settled = async (): Promise<false> => {
      for (;;) {
        const candidates: Array<Promise<unknown> | undefined> = [
          this.#refreshFlight?.promise,
          this.#callbackFlight?.promise,
          ...this.#pendingRevocations,
        ];
        const batch = candidates.filter(
          (promise): promise is Promise<unknown> => !!promise && !seen.has(promise),
        );
        if (!batch.length) return false;
        for (const promise of batch) seen.add(promise);
        await Promise.allSettled(batch);
      }
    };
    return Promise.race([settled(), expired]);
  }

  async #logoutDesktop(): Promise<void> {
    const expected = this.#session;
    this.#generation++;
    this.#owner = null;
    this.#pending = null;
    this.#authorizationStarting = false;
    const attempt = this.#authorizationAttempt;
    this.#authorizationAttempt = null;
    this.#session = null;
    await this.#onOwnerChanged(null);
    await attempt?.close();
    const removed = await this.#mutate(async () => (expected ? this.#repo.remove(expected) : null));
    if (expected) await this.#revoke((removed ?? expected).bundle);
  }
}
