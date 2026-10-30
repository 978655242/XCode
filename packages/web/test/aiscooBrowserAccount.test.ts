import { afterEach, describe, expect, it, vi } from "vitest";
import type { IChannelServer, IServerChannel } from "@zcode/rpc";
import type { NewApiSessionBundle } from "@zcode/shared";
import {
  createBrowserNewApiAccount,
  registerBrowserAccountChannel,
  type BrowserNewApiAccountOptions,
} from "../src/aiscoo-browser-account/index.js";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class SharedLocks {
  private readonly queues = new Map<string, Promise<unknown>>();
  async request<T>(name: string, run: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(name) ?? Promise.resolve()).catch(() => {}).then(run);
    this.queues.set(name, next);
    return next;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const initialTime = 1_800_000_000_000;
const browserOrigin = "http://127.0.0.1:5173";
const origin = "https://new-api.example.test";
const success = (data: unknown) => Response.json({ success: true, data });
const failure = (code: string, status: number) =>
  Response.json(
    {
      success: false,
      code,
      message: "untrusted server message",
      request_id: "test-request",
    },
    { status },
  );

function bundle(now = initialTime): NewApiSessionBundle {
  return {
    schema_version: 1,
    server_time: now,
    access_token: "test-access",
    access_expires_at: now + 60_000,
    refresh_token: "test-refresh",
    refresh_expires_at: now + 600_000,
    token_type: "Bearer",
    session_id: "test-sid",
    user: { id: "1", username: "alice", display_name: "Alice", avatar_url: null },
    relay_credential: { token: "sk-test-relay", expires_at: now + 600_000 },
  };
}

function fixture() {
  let time = initialTime;
  let session = bundle();
  let tokenResponse: (() => Promise<Response>) | undefined;
  let meResponse: (() => Promise<Response>) | undefined;
  let refreshResponse: (() => Promise<Response>) | undefined;
  let logoutResponse: (() => Promise<Response>) | undefined;
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const locks = new SharedLocks();
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/xcode/v1/auth/token") return tokenResponse?.() ?? success(session);
    if (path === "/api/xcode/v1/me")
      return (
        meResponse?.() ??
        success({
          schema_version: 1,
          server_time: time,
          session_id: session.session_id,
          user: session.user,
          authorization_revision: "1",
        })
      );
    if (path === "/api/xcode/v1/auth/refresh") {
      if (refreshResponse) return refreshResponse();
      session = {
        ...session,
        server_time: time,
        access_token: "test-access-rotated",
        access_expires_at: time + 60_000,
        refresh_token: "test-refresh-rotated",
      };
      return success(session);
    }
    if (path === "/api/xcode/v1/auth/logout")
      return (
        logoutResponse?.() ??
        success({
          schema_version: 1,
          server_time: time,
          revoked: true,
        })
      );
    throw new Error(`Unexpected test path ${path}`);
  });
  const options: BrowserNewApiAccountOptions = {
    origin,
    browserOrigin,
    localStorage,
    sessionStorage,
    locks,
    fetch,
    now: () => time,
  };
  const open = (overrides: Partial<BrowserNewApiAccountOptions> = {}) =>
    createBrowserNewApiAccount({ ...options, ...overrides });
  const account = open();
  const callback = (state: string) =>
    `${browserOrigin}/oauth/callback?provider=new-api&code=${"c".repeat(43)}&state=${state}`;
  const login = async (target = account) => {
    const started = await target.oauth.startOAuth("new-api");
    return target.oauth.handleCallback(callback(started.state));
  };
  const calls = (suffix: string) =>
    fetch.mock.calls.filter(([input]) => String(input).endsWith(suffix));
  const stored = () =>
    [...localStorage.values.entries()].find(([, value]) => value.includes('"bundle"'));
  return {
    account,
    open,
    options,
    callback,
    login,
    calls,
    stored,
    fetch,
    localStorage,
    sessionStorage,
    setTime: (value: number) => {
      time = value;
    },
    setSession: (value: NewApiSessionBundle) => {
      session = value;
    },
    token: (run: () => Promise<Response>) => {
      tokenResponse = run;
    },
    me: (run: () => Promise<Response>) => {
      meResponse = run;
    },
    refresh: (run: () => Promise<Response>) => {
      refreshResponse = run;
    },
    logout: (run: () => Promise<Response>) => {
      logoutResponse = run;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("browser New API account", () => {
  it("admits only the explicit owner-bound reverse invalidation command", async () => {
    const f = fixture();
    await f.login();
    const owner = f.account.getOwner()!;
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    let channel!: IServerChannel;
    const attached = registerBrowserAccountChannel(
      {
        registerChannel: (_name: string, value: IServerChannel) => {
          channel = value;
        },
      } as IChannelServer,
      f.account,
    );
    try {
      await expect(
        channel.call("browser", "invalidateCredential", { owner: { ...owner, extra: true } }),
      ).rejects.toThrow("AISCOO_BROWSER_RPC_INVALID");
      expect(f.account.getOwner()).toEqual(owner);
      await expect(
        channel.call("browser", "invalidateCredential", { owner }),
      ).resolves.toBeUndefined();
      expect(f.account.getOwner()).toBeNull();
      expect(f.stored()).toBeUndefined();
      await expect(
        channel.call("browser", "invalidateCredential", { owner }),
      ).resolves.toBeUndefined();
      await expect(
        channel.call("browser", "oauth", { method: "invalidateCredential", args: [owner] }),
      ).rejects.toThrow("AISCOO_BROWSER_RPC_INVALID");
    } finally {
      attached.dispose();
    }
  });
  it.each([
    "http://localhost:5173",
    "https://127.0.0.1:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:80",
    "http://127.0.0.1:70000",
    "http://127.0.0.1:5173/remote",
  ])("rejects a non-exact browser origin %s", (invalid) => {
    const f = fixture();
    expect(() => f.open({ browserOrigin: invalid })).toThrow("XCODE_BROWSER_ORIGIN_INVALID");
  });

  it("uses WebCrypto S256 and tab-local pending proof across same-page navigation", async () => {
    const f = fixture();
    const start = await f.account.oauth.startOAuth("new-api");
    const url = new URL(start.authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${origin}/api/xcode/v1/auth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "xwork-cli",
      response_type: "code",
      redirect_uri: `${browserOrigin}/oauth/callback`,
      state: start.state,
      code_challenge_method: "S256",
    });
    expect(start).toMatchObject({ provider: "new-api", purpose: "primary-account" });
    expect(start.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.localStorage.values.size).toBe(0);
    expect(f.sessionStorage.values.size).toBe(1);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(
      await f
        .open({ sessionStorage: new MemoryStorage() })
        .oauth.handleCallback(f.callback(start.state)),
    ).toBeNull();
    f.account.dispose();
    const navigated = f.open();
    expect(await navigated.oauth.handleCallback(f.callback(start.state))).toMatchObject({
      kind: "session",
      provider: "new-api",
      userInfo: { id: "1", displayName: "Alice" },
    });
    expect(f.sessionStorage.values.size).toBe(0);
    const [, request] = f.calls("auth/token")[0]!;
    const proof = JSON.parse(request!.body as string);
    expect(proof).toMatchObject({
      client_id: "xwork-cli",
      grant_type: "authorization_code",
      redirect_uri: `${browserOrigin}/oauth/callback`,
      code: "c".repeat(43),
    });
    expect(proof.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(proof.code_verifier),
    );
    const encoded = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(url.searchParams.get("code_challenge")).toBe(encoded);
    expect(request).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
  });

  it("accepts identity only after /me and restores the persisted random owner generation", async () => {
    const f = fixture();
    const me = deferred<Response>();
    const entered = deferred<void>();
    f.me(() => {
      entered.resolve();
      return me.promise;
    });
    const changes: string[] = [];
    f.account.oauth.onDidChangeSession((event) => {
      changes.push(event);
    });
    const login = f.login();
    await entered.promise;
    expect(f.account.getOwner()).toBeNull();
    expect(f.stored()).toBeUndefined();
    me.resolve(
      success({
        schema_version: 1,
        server_time: initialTime,
        session_id: "test-sid",
        user: bundle().user,
        authorization_revision: "1",
      }),
    );
    await login;
    f.me(async () =>
      success({
        schema_version: 1,
        server_time: initialTime,
        session_id: "test-sid",
        user: bundle().user,
        authorization_revision: "1",
      }),
    );
    const owner = f.account.getOwner()!;
    expect(owner).toMatchObject({ origin, sid: "test-sid", userId: "1" });
    expect(Number.isSafeInteger(owner.authGeneration)).toBe(true);
    expect(owner.authGeneration).toBeGreaterThan(0);
    expect(changes).toEqual(["signed-in"]);
    expect(await f.account.getControlCredential(owner)).toEqual({
      accessToken: "test-access",
      owner,
    });
    expect(await f.account.getRelayCredential(owner)).toEqual({
      token: "sk-test-relay",
      expiresAt: initialTime + 600_000,
    });
    const restored = f.open();
    expect(restored.getOwner()).toBeNull();
    expect(await restored.oauth.restoreCachedSessionState()).toMatchObject({
      status: "authenticated",
      userInfo: { id: "1" },
    });
    expect(restored.getOwner()).toEqual(owner);
    expect(f.calls("/me")).toHaveLength(2);
    expect(f.calls("/me")[0]![1]!.method).toBe("GET");
    expect(new Headers(f.calls("/me")[0]![1]!.headers).get("Authorization")).toBe(
      "Bearer test-access",
    );
  });

  it("single-flights duplicate callbacks, consumes pending before exchange, and never retries a failed code", async () => {
    const f = fixture();
    const exchange = deferred<Response>();
    f.token(() => exchange.promise);
    const start = await f.account.oauth.startOAuth("new-api");
    const url = f.callback(start.state);
    const first = f.account.oauth.handleCallback(url);
    const duplicate = f.account.oauth.handleCallback(url);
    expect(f.sessionStorage.values.size).toBe(0);
    expect(f.calls("auth/token")).toHaveLength(1);
    exchange.resolve(failure("XCODE_AUTH_CODE_INVALID", 400));
    await expect(first).rejects.toThrow("XCODE_AUTH_CODE_INVALID");
    await expect(duplicate).rejects.toThrow("XCODE_AUTH_CODE_INVALID");
    expect(await f.account.oauth.handleCallback(url)).toBeNull();
    expect(f.calls("auth/token")).toHaveLength(1);
  });

  it("rejects unknown state, wrong provider, alternate callback, extra return target, and expired attempts without exchange", async () => {
    const f = fixture();
    const start = await f.account.oauth.startOAuth("new-api");
    const url = f.callback(start.state);
    for (const invalid of [
      url.replace(start.state, "x".repeat(43)),
      url.replace("new-api", "zai"),
      url.replace("127.0.0.1", "localhost"),
      `${url}&appReturnTo=https://evil.example`,
      `${url}#fragment`,
    ])
      expect(await f.account.oauth.handleCallback(invalid)).toBeNull();
    f.setTime(initialTime + 300_000);
    expect(await f.account.oauth.handleCallback(url)).toBeNull();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("does not let a late old login overwrite a newer accepted login", async () => {
    const f = fixture();
    const exchange = deferred<Response>();
    f.token(() => exchange.promise);
    const old = await f.account.oauth.startOAuth("new-api");
    const late = f.account.oauth.handleCallback(f.callback(old.state));
    f.token(async () => success(bundle()));
    await f.login();
    const accepted = f.account.getOwner();
    exchange.resolve(success({ ...bundle(), session_id: "old-sid" }));
    expect(await late).toBeNull();
    expect(f.account.getOwner()).toEqual(accepted);
  });

  it("isolates canonical origins and leaves upstream browser OAuth storage untouched", async () => {
    const f = fixture();
    f.localStorage.setItem("oauth:active_provider", "zai");
    f.localStorage.setItem("oauth:zai:access_token", "upstream-test-token");
    await f.login();
    const equivalent = f.open({ origin: "https://NEW-API.example.test:443/" });
    await equivalent.oauth.restoreSession();
    expect(equivalent.getOwner()).toEqual(f.account.getOwner());
    const other = f.open({ origin: "https://other.example.test" });
    expect(await other.oauth.restoreCachedSessionState()).toEqual({ status: "signed-out" });
    expect(f.localStorage.getItem("oauth:active_provider")).toBe("zai");
    expect(f.localStorage.getItem("oauth:zai:access_token")).toBe("upstream-test-token");
  });

  it("preserves recoverable storage on network failure, but clears explicitly invalid sessions", async () => {
    const f = fixture();
    await f.login();
    const saved = f.stored();
    f.me(async () => {
      throw new Error("network test failure");
    });
    const restored = f.open();
    expect(await restored.oauth.restoreCachedSessionState()).toEqual({
      status: "unavailable",
      reason: "backend-unavailable",
    });
    expect(restored.getOwner()).toBeNull();
    expect(f.stored()).toEqual(saved);
    f.me(async () => failure("XCODE_SESSION_INVALID", 401));
    expect(await restored.oauth.restoreCachedSessionState()).toEqual({ status: "signed-out" });
    expect(f.stored()).toBeUndefined();
  });

  it.each(["expired", "expiry-order", "bad-schema", "wrong-me"])(
    "rejects an invalid login bundle or identity: %s",
    async (kind) => {
      const f = fixture();
      const session = bundle();
      if (kind === "expired") session.access_expires_at = initialTime;
      if (kind === "expiry-order") session.access_expires_at = session.refresh_expires_at + 1;
      if (kind === "bad-schema") session.relay_credential.token = "not-a-relay-token";
      if (kind === "wrong-me")
        f.me(async () =>
          success({
            schema_version: 1,
            server_time: initialTime,
            session_id: "other-sid",
            user: session.user,
            authorization_revision: "1",
          }),
        );
      f.setSession(session);
      await expect(f.login()).rejects.toThrow(/XCODE_(PROTOCOL|SESSION)_INVALID/);
      expect(f.account.getOwner()).toBeNull();
      expect(f.stored()).toBeUndefined();
    },
  );

  it("single-flights shared refresh through Web Locks and preserves owner and relay", async () => {
    const f = fixture();
    await f.login();
    const second = f.open({ sessionStorage: new MemoryStorage() });
    await second.oauth.restoreSession();
    const owner = f.account.getOwner()!;
    f.setTime(initialTime + 60_000);
    const [a, b] = await Promise.all([
      f.account.getControlCredential(owner),
      second.getControlCredential(owner),
    ]);
    expect(a).toEqual({ accessToken: "test-access-rotated", owner });
    expect(b).toEqual(a);
    expect(f.calls("auth/refresh")).toHaveLength(1);
    expect(JSON.parse(f.calls("auth/refresh")[0]![1]!.body as string)).toEqual({
      client_id: "xwork-cli",
      session_id: "test-sid",
      refresh_token: "test-refresh",
    });
    expect(await second.getRelayCredential(owner)).toEqual({
      token: "sk-test-relay",
      expiresAt: initialTime + 600_000,
    });
    const reload = f.open();
    await reload.oauth.restoreSession();
    expect(reload.getOwner()).toEqual(owner);
  });

  it("refreshes an expired cached control before /me, without publishing cached identity first", async () => {
    const f = fixture();
    await f.login();
    const owner = f.account.getOwner();
    f.setTime(initialTime + 60_000);
    const reload = f.open();
    expect(reload.getOwner()).toBeNull();
    await reload.oauth.restoreCachedSession();
    expect(reload.getOwner()).toEqual(owner);
    expect(f.calls("auth/refresh")).toHaveLength(1);
    expect(new Headers(f.calls("/me").at(-1)![1]!.headers).get("Authorization")).toBe(
      "Bearer test-access-rotated",
    );
  });

  it.each(["user", "sid", "relay", "relay-expiry", "refresh-token"])(
    "rejects a refresh that changes stable ownership or fails rotation: %s",
    async (kind) => {
      const f = fixture();
      await f.login();
      const owner = f.account.getOwner()!;
      f.setTime(initialTime + 60_000);
      const rotated = {
        ...bundle(initialTime + 60_000),
        refresh_token: "rotated-test-refresh",
        relay_credential: { ...bundle().relay_credential },
      };
      if (kind === "user") rotated.user = { ...rotated.user, id: "2" };
      if (kind === "sid") rotated.session_id = "other-sid";
      if (kind === "relay") rotated.relay_credential.token = "sk-other-test-relay";
      if (kind === "relay-expiry") rotated.relay_credential.expires_at++;
      if (kind === "refresh-token") rotated.refresh_token = "test-refresh";
      f.refresh(async () => success(rotated));
      await expect(f.account.getControlCredential(owner)).rejects.toThrow(
        /XCODE_(SESSION|PROTOCOL)_INVALID/,
      );
      expect(f.account.getOwner()).toBeNull();
    },
  );

  it("signs out synchronously during a long refresh and rejects the late response without resurrection", async () => {
    const f = fixture();
    await f.login();
    const owner = f.account.getOwner()!;
    const refreshed = deferred<Response>();
    const entered = deferred<void>();
    const revoked = deferred<Response>();
    f.refresh(() => {
      entered.resolve();
      return refreshed.promise;
    });
    f.logout(() => revoked.promise);
    f.setTime(initialTime + 60_000);
    const refresh = f.account.getControlCredential(owner);
    await entered.promise;
    const changes: string[] = [];
    f.account.oauth.onDidChangeSession((event) => {
      changes.push(event);
    });
    const logout = f.account.oauth.logout();
    expect(f.account.getOwner()).toBeNull();
    expect(f.stored()).toBeUndefined();
    expect(changes).toEqual(["signed-out"]);
    expect(f.calls("auth/logout")).toHaveLength(1);
    expect(JSON.parse(f.calls("auth/logout")[0]![1]!.body as string)).toEqual({
      client_id: "xwork-cli",
      session_id: "test-sid",
      refresh_token: "test-refresh",
    });
    refreshed.resolve(
      success({ ...bundle(initialTime + 60_000), refresh_token: "late-test-refresh" }),
    );
    await expect(refresh).rejects.toThrow("XCODE_STALE_OWNER");
    revoked.resolve(failure("XCODE_BACKEND_UNAVAILABLE", 503));
    await expect(logout).rejects.toThrow("XCODE_BACKEND_UNAVAILABLE");
    expect(f.account.getOwner()).toBeNull();
    expect(f.stored()).toBeUndefined();
  });

  it("checks persisted generation after awaits and never revokes a later login SID", async () => {
    const f = fixture();
    await f.login();
    const oldOwner = f.account.getOwner()!;
    const revoked = deferred<Response>();
    f.logout(() => revoked.promise);
    const logout = f.account.oauth.logout();
    f.setSession({ ...bundle(), session_id: "new-sid" });
    await f.login();
    const newOwner = f.account.getOwner()!;
    expect(newOwner.authGeneration).not.toBe(oldOwner.authGeneration);
    revoked.resolve(success({ schema_version: 1, server_time: initialTime, revoked: true }));
    await logout;
    expect(f.account.getOwner()).toEqual(newOwner);
    await expect(f.account.getRelayCredential(oldOwner)).rejects.toThrow("XCODE_STALE_OWNER");
    expect(f.calls("auth/logout")).toHaveLength(1);
  });

  it("does not delete or revoke another page's login after the old owner projection is cleared", async () => {
    const f = fixture();
    await f.login();
    const ownerA = f.account.getOwner()!;
    const other = f.open({ sessionStorage: new MemoryStorage() });
    f.setSession({ ...bundle(), session_id: "test-sid-b" });
    await f.login(other);
    const ownerB = other.getOwner()!;
    const savedB = f.stored();
    const revocations = f.calls("auth/logout").length;
    expect(ownerB.authGeneration).not.toBe(ownerA.authGeneration);
    expect(f.account.getOwner()).toBeNull();
    await f.account.oauth.logout();
    expect(f.stored()).toEqual(savedB);
    expect(other.getOwner()).toEqual(ownerB);
    expect(f.calls("auth/logout")).toHaveLength(revocations);
  });

  it("requires an accepted owner before logout can remove restored storage", async () => {
    const f = fixture();
    await f.login();
    const fresh = f.open({ sessionStorage: new MemoryStorage() });
    const saved = f.stored();
    expect(fresh.getOwner()).toBeNull();
    await fresh.oauth.logout();
    expect(f.stored()).toEqual(saved);
    expect(f.calls("auth/logout")).toHaveLength(0);
    await fresh.oauth.restoreSession();
    expect(fresh.getOwner()).toEqual(f.account.getOwner());
    await fresh.oauth.logout();
    expect(fresh.getOwner()).toBeNull();
    expect(f.stored()).toBeUndefined();
    expect(f.calls("auth/logout")).toHaveLength(1);
  });

  it("does not cancel an unrelated delayed refresh when no authorization is pending", async () => {
    const f = fixture();
    await f.login();
    const owner = f.account.getOwner()!;
    const refreshed = deferred<Response>();
    const entered = deferred<void>();
    f.refresh(() => {
      entered.resolve();
      return refreshed.promise;
    });
    f.setTime(initialTime + 60_000);
    const refresh = f.account.getControlCredential(owner);
    await entered.promise;
    expect(f.sessionStorage.values.size).toBe(0);
    await f.account.oauth.cancelPending();
    const rotated = {
      ...bundle(),
      server_time: initialTime + 60_000,
      access_token: "test-after-cancel-access",
      access_expires_at: initialTime + 120_000,
      refresh_token: "test-after-cancel-refresh",
    };
    refreshed.resolve(success(rotated));
    await expect(refresh).resolves.toEqual({ accessToken: rotated.access_token, owner });
    expect(JSON.parse(f.stored()![1]).bundle.refresh_token).toBe(rotated.refresh_token);
    expect(f.account.getOwner()).toEqual(owner);
    expect(f.calls("auth/refresh")).toHaveLength(1);
  });

  it("invalidates the captured credential synchronously during refresh without resurrection", async () => {
    const f = fixture();
    await f.login();
    const owner = f.account.getOwner()!;
    const refreshed = deferred<Response>();
    const entered = deferred<void>();
    f.refresh(() => {
      entered.resolve();
      return refreshed.promise;
    });
    f.setTime(initialTime + 60_000);
    const refresh = f.account.getControlCredential(owner);
    await entered.promise;
    const changes: string[] = [];
    f.account.oauth.onDidChangeSession((event) => changes.push(event));
    f.account.invalidateCredential(owner);
    expect(f.account.getOwner()).toBeNull();
    expect(f.stored()).toBeUndefined();
    expect(changes).toEqual(["signed-out"]);
    f.account.invalidateCredential(owner);
    expect(changes).toEqual(["signed-out"]);
    refreshed.resolve(
      success({ ...bundle(initialTime + 60_000), refresh_token: "late-test-refresh" }),
    );
    await expect(refresh).rejects.toThrow("XCODE_STALE_OWNER");
    await expect(f.account.getRelayCredential(owner)).rejects.toThrow("XCODE_STALE_OWNER");
    expect(f.calls("auth/logout")).toHaveLength(0);
  });

  it("clears the captured persisted generation even after an unavailable restore", async () => {
    const f = fixture();
    await f.login();
    const owner = f.account.getOwner()!;
    f.me(async () => {
      throw new Error("network unavailable");
    });
    await f.account.oauth.restoreCachedSessionState();
    expect(f.account.getOwner()).toBeNull();
    expect(f.stored()).toBeDefined();
    f.account.invalidateCredential(owner);
    expect(f.stored()).toBeUndefined();
  });

  it("does not clear a newer login with the same user and SID", async () => {
    const f = fixture();
    await f.login();
    const old = f.account.getOwner()!;
    await f.login();
    const next = f.account.getOwner()!;
    const saved = f.stored();
    expect(next.authGeneration).not.toBe(old.authGeneration);
    f.account.invalidateCredential(old);
    expect(f.account.getOwner()).toEqual(next);
    expect(f.stored()).toEqual(saved);
  });

  it.each(["origin", "user", "sid", "generation", "cross-tab"])(
    "preserves a new owner on stale invalidation: %s",
    async (kind) => {
      const f = fixture();
      await f.login();
      const old = f.account.getOwner()!;
      if (kind === "cross-tab") {
        const other = f.open({ sessionStorage: new MemoryStorage() });
        await f.login(other);
        const saved = f.stored();
        const accepted = other.getOwner();
        f.account.invalidateCredential(old);
        expect(f.stored()).toEqual(saved);
        expect(other.getOwner()).toEqual(accepted);
      } else {
        const expected = { ...old };
        if (kind === "origin") expected.origin = "https://other.example.test";
        if (kind === "user") expected.userId = "2";
        if (kind === "sid") expected.sid = "other-sid";
        if (kind === "generation") expected.authGeneration++;
        const saved = f.stored();
        f.account.invalidateCredential(expected);
        expect(f.account.getOwner()).toEqual(old);
        expect(f.stored()).toEqual(saved);
      }
    },
  );

  it("blocks stale cross-tab credentials and late restore after disposal", async () => {
    const f = fixture();
    await f.login();
    const old = f.account.getOwner()!;
    const other = f.open({ sessionStorage: new MemoryStorage() });
    await f.login(other);
    expect(f.account.getOwner()).toBeNull();
    await expect(f.account.getControlCredential(old)).rejects.toThrow("XCODE_STALE_OWNER");
    const response = deferred<Response>();
    const entered = deferred<void>();
    f.me(() => {
      entered.resolve();
      return response.promise;
    });
    const restore = other.oauth.restoreSession();
    await entered.promise;
    other.dispose();
    response.resolve(
      success({
        schema_version: 1,
        server_time: initialTime,
        session_id: "test-sid",
        user: bundle().user,
        authorization_revision: "1",
      }),
    );
    expect(await restore).toBeNull();
    expect(other.getOwner()).toBeNull();
    expect(f.stored()).toBeDefined();
  });
});
