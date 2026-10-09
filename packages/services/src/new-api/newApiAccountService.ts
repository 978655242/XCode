import { NEW_API_PROVIDER_ID, type NewApiOwner, type NewApiSessionBundle,
  type OAuthCachedSessionRestoreResult, type OAuthCallbackResult, type OAuthProviderId,
  type OAuthStartResponse, type UserInfo } from "@zcode/shared";
import type { IOAuthService } from "../oauth/oauth.js";
import type { NewApiProviderAdapter } from "../oauth/providers/newApiProviderAdapter.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { NewApiSessionRepo, NewApiStoredSession } from "./newApiSessionRepo.js";
import { confirmedProfile, errorCode, isRevocation, sessionError, validateSession } from "./newApiSessionValidation.js";

const log = createServiceLogger("newApiAccount");
type Pending = Readonly<{ state: string; codeVerifier: string; provider: typeof NEW_API_PROVIDER_ID;
  purpose: "primary-account"; generation: number; expiresAt: number }>;

export class NewApiAccountService {
  readonly oauth: IOAuthService;
  #adapter: NewApiProviderAdapter;
  #repo: NewApiSessionRepo;
  #now: () => number;
  #onOwnerChanged: (owner: NewApiOwner | null) => Promise<void> | void;
  #generation = 0;
  #pending: Pending | null = null;
  #callbackFlight: { pending: Pending; promise: Promise<OAuthCallbackResult | null> } | null = null;
  #session: NewApiStoredSession | null = null;
  #owner: NewApiOwner | null = null;
  #mutations: Promise<unknown> = Promise.resolve();
  #refreshFlight: { session: NewApiStoredSession; generation: number; promise: Promise<void> } | null = null;
  #restoreFlight: { generation: number; promise: Promise<OAuthCachedSessionRestoreResult> } | null = null;

  constructor(dependencies: { adapter: NewApiProviderAdapter; repo: NewApiSessionRepo;
    now?: () => number; onOwnerChanged?: (owner: NewApiOwner | null) => Promise<void> | void }) {
    this.#adapter = dependencies.adapter;
    this.#repo = dependencies.repo;
    this.#now = dependencies.now ?? Date.now;
    this.#onOwnerChanged = dependencies.onOwnerChanged ?? (() => {});
    // XCODE: RPC 只注册显式公开投影，Host 的 SID、refresh 与 relay 凭据永不进入反射对象。
    this.oauth = Object.freeze({
      getProviders: async () => [{ ...this.#adapter.meta }],
      getActiveProvider: async () => this.#owner ? NEW_API_PROVIDER_ID : null,
      restoreCachedSession: async () => this.#restoreProfile(),
      restoreCachedSessionState: async () => this.#restore(),
      restoreSession: async () => this.#restoreProfile(),
      startOAuth: async (provider: OAuthProviderId) => this.#start(provider),
      startOAuthWithPolling: async () => { throw sessionError("XCODE_PRIVATE_POLLING_UNSUPPORTED"); },
      pollPendingOAuth: async () => { throw sessionError("XCODE_PRIVATE_POLLING_UNSUPPORTED"); },
      handleCallback: async (url: string) => this.#handleCallback(url),
      refreshToken: async (provider?: OAuthProviderId) => {
        this.#checkProvider(provider); await this.#refresh();
      },
      logout: async (provider?: OAuthProviderId) => { this.#checkProvider(provider); await this.#logout(); },
      logoutAll: async () => this.#logout(),
      cancelPending: async (provider?: OAuthProviderId) => {
        this.#checkProvider(provider);
        if (!this.#pending) return;
        this.#generation++; this.#pending = null; this.#owner = null;
        await this.#mutate(async () => { await this.#onOwnerChanged(null); });
      },
    });
  }

  getOwner(): NewApiOwner | null { return this.#owner; }

  isCurrent(owner: NewApiOwner): boolean {
    return this.#owner !== null && owner.origin === this.#owner.origin && owner.userId === this.#owner.userId &&
      owner.sid === this.#owner.sid && owner.authGeneration === this.#owner.authGeneration;
  }

  async withControlSession<T>(action: (accessToken: string, owner: NewApiOwner) => Promise<T>): Promise<T> {
    const owner = this.#owner;
    if (!owner || !this.#session) throw sessionError("XCODE_SESSION_INVALID");
    let refreshed = false;
    try {
      if (this.#session.bundle.access_expires_at <= this.#now()) {
        await this.#refresh(); refreshed = true;
      }
      if (!this.isCurrent(owner) || !this.#session) throw sessionError("XCODE_STALE_OWNER");
      let result: T;
      const accessToken = this.#session.bundle.access_token;
      try { result = await action(accessToken, owner); }
      catch (error) {
        if (!this.isCurrent(owner)) throw sessionError("XCODE_STALE_OWNER");
        if (refreshed || errorCode(error) !== "XCODE_ACCESS_EXPIRED") throw error;
        if (this.#session?.bundle.access_token === accessToken) await this.#refresh();
        if (!this.isCurrent(owner) || !this.#session) throw sessionError("XCODE_STALE_OWNER");
        result = await action(this.#session.bundle.access_token, owner);
      }
      if (!this.isCurrent(owner)) throw sessionError("XCODE_STALE_OWNER");
      return result;
    } catch (error) {
      if (isRevocation(error) && this.isCurrent(owner)) await this.#invalidate(this.#session!, this.#generation);
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

  #checkProvider(provider?: OAuthProviderId): void {
    if (provider !== undefined && provider !== NEW_API_PROVIDER_ID) throw sessionError("XCODE_PROVIDER_INVALID");
  }

  #mutate<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#mutations.catch(() => undefined).then(run);
    this.#mutations = next;
    return next;
  }

  async #start(provider: OAuthProviderId): Promise<OAuthStartResponse> {
    this.#checkProvider(provider);
    this.#repo.assertStorageAvailable();
    const authorization = this.#adapter.createAuthorization();
    const generation = ++this.#generation;
    this.#owner = null;
    this.#pending = Object.freeze({ state: authorization.state, codeVerifier: authorization.codeVerifier,
      provider: NEW_API_PROVIDER_ID, purpose: "primary-account", generation, expiresAt: this.#now() + 300_000 });
    await this.#mutate(async () => { await this.#onOwnerChanged(null); });
    if (generation !== this.#generation) throw sessionError("XCODE_STALE_OWNER");
    return { provider: NEW_API_PROVIDER_ID, purpose: "primary-account",
      state: authorization.state, authorizeUrl: authorization.authorizeUrl };
  }

  async #handleCallback(url: string): Promise<OAuthCallbackResult | null> {
    const parsed = this.#adapter.parseCallback(url);
    const pending = this.#pending;
    if (!pending || parsed.state !== pending.state || pending.generation !== this.#generation ||
      pending.expiresAt <= this.#now()) return null;
    if (this.#callbackFlight?.pending === pending) return this.#callbackFlight.promise;
    const promise = this.#complete(pending, parsed.code);
    const flight = { pending, promise };
    this.#callbackFlight = flight;
    try { return await promise; }
    finally { if (this.#callbackFlight === flight) this.#callbackFlight = null; }
  }

  async #complete(pending: Pending, code: string): Promise<OAuthCallbackResult | null> {
    let bundle: NewApiSessionBundle | null = null;
    let published = false;
    try {
      bundle = await this.#adapter.exchangeCode(code, pending.codeVerifier);
      if (this.#pending !== pending || pending.generation !== this.#generation || pending.expiresAt <= this.#now()) return null;
      validateSession(bundle, this.#now(), true);
      const userInfo = confirmedProfile(await this.#adapter.client.getMe(bundle.access_token), bundle);
      const record: NewApiStoredSession = { schemaVersion: 1, origin: this.#adapter.client.origin, bundle };
      return await this.#mutate(async () => {
        if (this.#pending !== pending || pending.generation !== this.#generation || pending.expiresAt <= this.#now()) return null;
        const previous = await this.#repo.loadActive();
        if (this.#pending !== pending || pending.generation !== this.#generation) return null;
        await this.#repo.commit(record);
        // XCODE: 取消可发生在文件锁持有期间；提交后必须补偿，不能复活旧登录。
        if (this.#pending !== pending || pending.generation !== this.#generation || pending.expiresAt <= this.#now()) {
          await this.#repo.revert(record, previous); return null;
        }
        this.#session = record;
        this.#owner = Object.freeze({ origin: record.origin, userId: bundle!.user.id,
          sid: bundle!.session_id, authGeneration: pending.generation });
        try { await this.#onOwnerChanged(this.#owner); }
        catch (error) {
          this.#owner = null; this.#session = previous;
          await this.#repo.revert(record, previous); throw error;
        }
        if (this.#pending !== pending || pending.generation !== this.#generation) {
          if (this.#session === record) this.#session = previous;
          await this.#repo.revert(record, previous); return null;
        }
        this.#pending = null; published = true;
        return { kind: "session", provider: NEW_API_PROVIDER_ID, userInfo };
      });
    } catch (error) {
      if (this.#pending !== pending || pending.generation !== this.#generation) return null;
      this.#pending = null;
      throw error;
    } finally { if (bundle && !published) await this.#revoke(bundle); }
  }

  async #restoreProfile(): Promise<UserInfo | null> {
    const result = await this.#restore();
    if (result.status === "unavailable") throw sessionError(result.reason === "credential-recovery-required"
      ? "XCODE_CREDENTIAL_RECOVERY_REQUIRED" : "XCODE_BACKEND_UNAVAILABLE");
    return result.status === "authenticated" ? result.userInfo : null;
  }

  async #restore(): Promise<OAuthCachedSessionRestoreResult> {
    const generation = this.#generation;
    if (this.#pending) return { status: "signed-out" };
    if (this.#restoreFlight?.generation === generation) return this.#restoreFlight.promise;
    const promise = this.#restoreCurrent(generation);
    const flight = { generation, promise };
    this.#restoreFlight = flight;
    try { return await promise; }
    finally { if (this.#restoreFlight === flight) this.#restoreFlight = null; }
  }

  async #restoreCurrent(generation: number): Promise<OAuthCachedSessionRestoreResult> {
    let record: NewApiStoredSession | null = null;
    try {
      this.#repo.assertStorageAvailable();
      record = await this.#repo.loadActive();
      if (generation !== this.#generation || this.#pending) return { status: "signed-out" };
      if (!record) return { status: "signed-out" };
      if (record.origin !== this.#adapter.client.origin) throw sessionError("XCODE_PROTOCOL_INVALID");
      validateSession(record.bundle, this.#now(), false);
      await this.#mutate(async () => {
        if (generation !== this.#generation) throw sessionError("XCODE_STALE_OWNER");
        this.#session = record;
      });
      if (record.bundle.refresh_expires_at <= this.#now()) throw sessionError("XCODE_SESSION_INVALID");
      let userInfo: UserInfo;
      if (record.bundle.access_expires_at <= this.#now()) await this.#refresh();
      try { userInfo = confirmedProfile(await this.#adapter.client.getMe(this.#session!.bundle.access_token), this.#session!.bundle); }
      catch (error) {
        if (errorCode(error) !== "XCODE_ACCESS_EXPIRED" || this.#session !== record) throw error;
        await this.#refresh();
        userInfo = confirmedProfile(await this.#adapter.client.getMe(this.#session!.bundle.access_token), this.#session!.bundle);
      }
      await this.#mutate(async () => {
        if (generation !== this.#generation || !this.#session) throw sessionError("XCODE_STALE_OWNER");
        if (!this.#owner) {
          this.#owner = Object.freeze({ origin: record!.origin, userId: record!.bundle.user.id,
            sid: record!.bundle.session_id, authGeneration: generation });
          await this.#onOwnerChanged(this.#owner);
        }
      });
      if (generation !== this.#generation) return { status: "signed-out" };
      return { status: "authenticated", userInfo };
    } catch (error) {
      if (generation !== this.#generation) return { status: "signed-out" };
      if (record && isRevocation(error)) {
        await this.#invalidate(this.#session ?? record, generation); return { status: "signed-out" };
      }
      return { status: "unavailable", reason: ["XCODE_PROTOCOL_INVALID", "XCODE_CREDENTIAL_RECOVERY_REQUIRED",
        "ZCODE_CREDENTIAL_DECRYPT_FAILED"].includes(errorCode(error))
        ? "credential-recovery-required" : "backend-unavailable" };
    }
  }

  async #refresh(): Promise<void> {
    const expected = this.#session;
    const generation = this.#generation;
    if (!expected) throw sessionError("XCODE_SESSION_INVALID");
    if (this.#refreshFlight?.generation === generation &&
      this.#refreshFlight.session.bundle.session_id === expected.bundle.session_id) return this.#refreshFlight.promise;
    const promise = this.#rotate(expected, generation);
    const flight = { session: expected, generation, promise };
    this.#refreshFlight = flight;
    try { await promise; }
    finally { if (this.#refreshFlight === flight) this.#refreshFlight = null; }
  }

  async #rotate(expected: NewApiStoredSession, generation: number): Promise<void> {
    try {
      if (expected.bundle.refresh_expires_at <= this.#now()) throw sessionError("XCODE_SESSION_INVALID");
      const bundle = await this.#adapter.refresh(expected.bundle);
      if (generation !== this.#generation || this.#session !== expected) throw sessionError("XCODE_STALE_OWNER");
      validateSession(bundle, this.#now(), true);
      if (bundle.user.id !== expected.bundle.user.id || bundle.session_id !== expected.bundle.session_id ||
        bundle.relay_credential.token !== expected.bundle.relay_credential.token ||
        bundle.refresh_token === expected.bundle.refresh_token) throw sessionError("XCODE_SESSION_INVALID");
      const next: NewApiStoredSession = { schemaVersion: 1, origin: expected.origin, bundle };
      await this.#mutate(async () => {
        if (generation !== this.#generation || this.#session !== expected) throw sessionError("XCODE_STALE_OWNER");
        if (!await this.#repo.rotate(expected, next)) throw sessionError("XCODE_SESSION_INVALID");
        if (generation !== this.#generation) {
          await this.#repo.remove(next); throw sessionError("XCODE_STALE_OWNER");
        }
        this.#session = next;
      });
      // XCODE: 先保存轮换后的 refresh，避免 Me 暂时 503 丢失仍可恢复的后继凭据。
      confirmedProfile(await this.#adapter.client.getMe(bundle.access_token), bundle);
      if (generation !== this.#generation) throw sessionError("XCODE_STALE_OWNER");
    } catch (error) {
      if (generation === this.#generation && (isRevocation(error) || errorCode(error) === "XCODE_PROTOCOL_INVALID")) {
        await this.#invalidate(this.#session ?? expected, generation);
      }
      throw error;
    }
  }

  async #invalidate(expected: NewApiStoredSession, generation: number): Promise<void> {
    if (generation !== this.#generation) return;
    this.#generation++; this.#owner = null; this.#pending = null; this.#session = null;
    await this.#mutate(async () => {
      await this.#onOwnerChanged(null);
      await this.#repo.remove(expected);
    });
    await this.#revoke(expected.bundle);
  }

  async #logout(): Promise<void> {
    const expected = this.#session;
    this.#generation++; this.#owner = null; this.#pending = null; this.#session = null;
    await this.#mutate(async () => {
      await this.#onOwnerChanged(null);
      if (expected) await this.#repo.remove(expected);
    });
    if (expected) await this.#revoke(expected.bundle);
  }

  async #revoke(bundle: NewApiSessionBundle): Promise<void> {
    try { await this.#adapter.logout(bundle); log.info(undefined, "Private session remotely revoked"); }
    catch (error) { log.warn(undefined, "Private session remote revocation failed", errorCode(error)); }
  }
}
