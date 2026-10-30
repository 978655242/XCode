import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { ChannelClient, ChannelServer, ProxyChannel, createQueuePair } from "@zcode/rpc";
import { createCredentialService } from "../src/credential/credentialService.js";
import { createCredentialCipherProvider } from "../src/credential/providers/credentialCipherProvider.js";
import type { IOAuthService } from "../src/oauth/oauth.js";
import { NewApiClient } from "../src/new-api/newApiClient.js";
import { NewApiSessionRepo } from "../src/new-api/newApiSessionRepo.js";
import { NewApiAccountService } from "../src/new-api/newApiAccountService.js";
import { NewApiProviderAdapter } from "../src/oauth/providers/newApiProviderAdapter.js";
import {
  createLocalWebNewApiAccountFactory,
  createLocalWebTimeoutFetch,
} from "../src/local-web-new-api/index.js";

const origin = "https://private.example";
const code = "c".repeat(43);
function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function bundle(now: number, refresh = "refresh-1", id = "1", sid = "web-sid") {
  const expires = Math.floor((now + 60_000) / 1000) * 1000;
  const payload = Buffer.from(
    JSON.stringify({
      iss: "new-api",
      aud: ["new-api-xcode"],
      token_use: "xcode_access",
      sub: id,
      sid,
      exp: expires / 1000,
      uv: 1,
      sv: 1,
      nbf: Math.floor(now / 1000) - 1,
      iat: Math.floor(now / 1000),
      scopes: ["profile:read", "wallet:read", "usage:read"],
      jti: randomUUID(),
    }),
  ).toString("base64url");
  return {
    schema_version: 1 as const,
    server_time: now,
    access_token: `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${payload}.${Buffer.alloc(32, 1).toString("base64url")}`,
    access_expires_at: expires,
    refresh_token: refresh,
    refresh_expires_at: now + 600_000,
    token_type: "Bearer" as const,
    session_id: sid,
    user: { id, username: `web-user-${id}`, display_name: `Web User ${id}`, avatar_url: null },
    relay_credential: { token: "sk-relay-test", expires_at: now + 600_000 },
  };
}
const success = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    headers: { "content-type": "application/json" },
  });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aiscoo-web-account-"));
  let key: string | null = null;
  let now = Math.floor(Date.now() / 1000) * 1000;
  let token = bundle(now);
  let exchange = async (_signal?: AbortSignal | null) => token;
  let getMe: ((signal?: AbortSignal | null) => Promise<Response>) | undefined;
  let refresh: (() => Promise<ReturnType<typeof bundle>>) | undefined;
  let logout: (() => Promise<Response>) | undefined;
  let ownerChanged: ((owner: unknown) => Promise<void> | void) | undefined;
  const calls: { path: string; body: Record<string, string> | null }[] = [];
  const keyStore = {
    read: async () => key,
    write: async (value: string) => {
      key = value;
    },
  };
  const fetchBackend: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, origin);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : null;
    calls.push({ path: url.pathname, body });
    if (url.pathname.endsWith("/auth/token")) {
      token = await exchange(init?.signal);
      return success(token);
    }
    if (url.pathname.endsWith("/auth/refresh")) {
      token = refresh ? await refresh() : bundle(now, "refresh-2");
      return success(token);
    }
    if (url.pathname.endsWith("/auth/logout"))
      return logout ? logout() : success({ schema_version: 1, server_time: now, revoked: true });
    if (url.pathname.endsWith("/me")) {
      if (getMe) return getMe(init?.signal);
      return success({
        schema_version: 1,
        server_time: now,
        session_id: token.session_id,
        user: token.user,
        authorization_revision: "0",
      });
    }
    throw new Error("Unexpected isolated backend request");
  };
  const create = () =>
    createLocalWebNewApiAccountFactory({ origin, dataDirectory: root, keyStore, now: () => now });
  const factory = await create();
  const { account } = factory.create({
    fetch: fetchBackend,
    onOwnerChanged: (owner) => ownerChanged?.(owner),
  });
  const events: string[] = [];
  const failures: { provider: string; state: string; reason: string }[] = [];
  const failed = barrier<void>();
  const signedIn = barrier<void>();
  account.oauth.onDidChangeSession((event) => {
    events.push(event);
    if (event === "signed-in") signedIn.resolve();
  });
  account.oauth.onDidFailAuthorization?.((event) => {
    failures.push(event);
    failed.resolve();
  });
  return {
    root,
    factory,
    account,
    calls,
    events,
    failures,
    failed,
    signedIn,
    create,
    fetchBackend,
    setExchange(value: typeof exchange) {
      exchange = value;
    },
    setGetMe(value: typeof getMe) {
      getMe = value;
    },
    setRefresh(value: typeof refresh) {
      refresh = value;
    },
    setLogout(value: typeof logout) {
      logout = value;
    },
    setOwnerChanged(value: typeof ownerChanged) {
      ownerChanged = value;
    },
    advance(ms: number) {
      now += ms;
    },
    loseKey() {
      key = null;
    },
    async dispose() {
      await factory.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}
function callback(authorizeUrl: string, callbackState?: string) {
  const url = new URL(authorizeUrl);
  const redirect = url.searchParams.get("redirect_uri")!;
  const state = callbackState ?? url.searchParams.get("state")!;
  return `${redirect}?provider=new-api&state=${state}&code=${code}`;
}

test("loopback login uses the Host owner, exact PKCE/client and isolated encrypted storage", async () => {
  const f = await fixture();
  let cold: Awaited<ReturnType<typeof f.create>> | undefined;
  try {
    const desktop = join(f.root, "credentials.json");
    const cli = join(f.root, "cli", "zen", "sentinel.json");
    await mkdir(join(f.root, "cli", "zen"), { recursive: true });
    await writeFile(desktop, "desktop-sentinel");
    await writeFile(cli, "cli-sentinel");
    const start = await f.account.oauth.startOAuth("new-api");
    const authorize = new URL(start.authorizeUrl);
    const redirect = authorize.searchParams.get("redirect_uri")!;
    assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    assert.equal(authorize.searchParams.get("client_id"), "xwork-cli");
    assert.equal((await fetch(callback(start.authorizeUrl, "wrong-state"))).status, 400);
    assert.equal(await f.account.oauth.handleCallback(callback(start.authorizeUrl)), null);
    assert.equal(f.calls.length, 0);
    assert.equal((await fetch(callback(start.authorizeUrl))).status, 200);
    await f.signedIn.promise;
    assert.equal(f.account.getOwner()?.userId, "1");
    const exchanged = f.calls.find((call) => call.path.endsWith("/auth/token"))!.body!;
    assert.equal(exchanged.client_id, "xwork-cli");
    assert.equal(exchanged.redirect_uri, redirect);
    assert.equal(
      createHash("sha256").update(exchanged.code_verifier!).digest("base64url"),
      authorize.searchParams.get("code_challenge"),
    );
    assert.deepEqual(f.events, ["signed-out", "signed-in"]);
    const database = await readFile(
      join(f.root, "local-web", "new-api", "credentials.json"),
      "utf8",
    );
    assert.ok(!database.includes("refresh-1") && !database.includes("sk-relay-test"));
    assert.equal(await readFile(desktop, "utf8"), "desktop-sentinel");
    assert.equal(await readFile(cli, "utf8"), "cli-sentinel");
    await f.account.oauth.refreshToken();
    assert.equal(
      f.calls.find((call) => call.path.endsWith("/auth/refresh"))!.body!.client_id,
      "xwork-cli",
    );
    cold = await f.create();
    const restored = cold.create({ fetch: f.fetchBackend, onOwnerChanged: () => {} }).account;
    assert.equal((await restored.oauth.restoreCachedSessionState()).status, "authenticated");
    await restored.oauth.logout();
    const logout = f.calls.filter((call) => call.path.endsWith("/auth/logout")).at(-1)!.body!;
    assert.equal(logout.client_id, "xwork-cli");
    assert.equal(logout.refresh_token, "refresh-2");
    assert.equal(await readFile(desktop, "utf8"), "desktop-sentinel");
    assert.equal(await readFile(cli, "utf8"), "cli-sentinel");
  } finally {
    await cold?.dispose();
    await f.dispose();
  }
});

test("offline logout reports unconfirmed remote revocation after removing the isolated local session", async () => {
  const f = await fixture();
  let cold: Awaited<ReturnType<typeof f.create>> | undefined;
  try {
    const record = { schemaVersion: 1 as const, origin, bundle: bundle(Math.floor(Date.now() / 1000) * 1000) };
    await new NewApiSessionRepo(origin, f.factory.credentialStore).commit(record);
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    const previousOwner = f.account.getOwner()!;
    f.setLogout(async () => {
      throw new Error("synthetic secret must not leave backend");
    });
    await assert.rejects(f.account.oauth.logout(), {
      code: "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED",
      message: "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED",
    });
    assert.equal(f.account.getOwner(), null);
    await assert.rejects(f.account.getRelayCredential(previousOwner), { code: "XCODE_STALE_OWNER" });
    cold = await f.create();
    const restored = cold.create({ fetch: f.fetchBackend, onOwnerChanged: () => {} }).account;
    assert.equal((await restored.oauth.restoreCachedSessionState()).status, "signed-out");
  } finally {
    await cold?.dispose();
    await f.dispose();
  }
});

test("unconfirmed revocation error survives the OAuth RPC transport without secrets", async () => {
  const f = await fixture();
  const [serverProtocol, clientProtocol] = createQueuePair();
  const server = new ChannelServer(serverProtocol, "test");
  const client = new ChannelClient(clientProtocol);
  server.registerChannel("oauth", ProxyChannel.fromService(f.account.oauth));
  const oauth = ProxyChannel.toService<IOAuthService>(client.getChannel("oauth"));
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    await new NewApiSessionRepo(origin, f.factory.credentialStore).commit({
      schemaVersion: 1,
      origin,
      bundle: bundle(now),
    });
    assert.equal((await oauth.restoreCachedSessionState()).status, "authenticated");
    f.setLogout(async () => { throw new Error("synthetic transport secret"); });
    await assert.rejects(oauth.logout(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED");
      assert.equal(error.message, "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED");
      assert.doesNotMatch(error.stack ?? "", /synthetic transport secret|refresh-1|sk-relay-test/);
      return true;
    });
  } finally {
    client.dispose();
    server.dispose();
    await f.dispose();
  }
});

test("restore cannot reactivate the previous session while logout cleanup is in progress", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  try {
    const record = { schemaVersion: 1 as const, origin, bundle: bundle(Math.floor(Date.now() / 1000) * 1000) };
    await new NewApiSessionRepo(origin, f.factory.credentialStore).commit(record);
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    f.setOwnerChanged(async (owner) => {
      if (owner === null) {
        entered.resolve();
        await release.promise;
      }
    });
    const logout = f.account.oauth.logout();
    await entered.promise;
    const restoration = await f.account.oauth.restoreCachedSessionState();
    release.resolve();
    await logout;
    assert.equal(restoration.status, "signed-out");
    assert.equal(f.account.getOwner(), null);
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "signed-out");
  } finally {
    release.resolve();
    await f.dispose();
  }
});

test("offline logout cannot hide failure to revoke a refresh successor", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    await new NewApiSessionRepo(origin, f.factory.credentialStore).commit({
      schemaVersion: 1,
      origin,
      bundle: bundle(now),
    });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    f.setRefresh(async () => {
      entered.resolve();
      await release.promise;
      return bundle(now, "refresh-successor");
    });
    f.setLogout(async () => {
      if (f.calls.at(-1)?.body?.refresh_token === "refresh-successor")
        throw new Error("synthetic offline");
      return success({ schema_version: 1, server_time: now, revoked: true });
    });
    const refreshing = f.account.oauth.refreshToken();
    const rejectedRefresh = assert.rejects(refreshing, { code: "XCODE_STALE_OWNER" });
    await entered.promise;
    const logout = f.account.oauth.logout();
    const rejectedLogout = assert.rejects(logout, { code: "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED" });
    release.resolve();
    await Promise.all([rejectedRefresh, rejectedLogout]);
    assert.equal(f.account.getOwner(), null);
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "signed-out");
  } finally {
    release.resolve();
    await f.dispose();
  }
});

test("logout revokes the issued refresh successor when rotation persistence fails", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  let rotateMock: ReturnType<typeof mock.method> | undefined;
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: bundle(now) });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    rotateMock = mock.method(NewApiSessionRepo.prototype, "rotate", async () => {
      throw new Error("synthetic transient disk failure");
    });
    f.setRefresh(async () => {
      entered.resolve();
      await release.promise;
      return bundle(now, "refresh-successor");
    });
    const refreshing = f.account.oauth.refreshToken();
    const refreshFailed = assert.rejects(refreshing);
    await entered.promise;
    const logout = f.account.oauth.logout();
    release.resolve();
    await refreshFailed;
    await logout;
    assert.deepEqual(
      f.calls.filter((call) => call.path.endsWith("/auth/logout")).map((call) => ({
        refresh: call.body?.refresh_token,
        client: call.body?.client_id,
      })),
      [{ refresh: "refresh-successor", client: "xwork-cli" }],
    );
    assert.equal(await repo.loadActive(), null);
  } finally {
    release.resolve();
    rotateMock?.mock.restore();
    await f.dispose();
  }
});

test("failed successor revocation cannot be hidden by old refresh success after rotation write failure", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  let rotateMock: ReturnType<typeof mock.method> | undefined;
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: bundle(now) });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    rotateMock = mock.method(NewApiSessionRepo.prototype, "rotate", async () => {
      throw new Error("synthetic transient disk failure");
    });
    f.setRefresh(async () => {
      entered.resolve();
      await release.promise;
      return bundle(now, "refresh-successor");
    });
    f.setLogout(async () => {
      if (f.calls.at(-1)?.body?.refresh_token === "refresh-successor")
        throw new Error("synthetic offline");
      return success({ schema_version: 1, server_time: now, revoked: true });
    });
    const refreshing = f.account.oauth.refreshToken();
    const refreshFailed = assert.rejects(refreshing);
    await entered.promise;
    const logout = f.account.oauth.logout();
    const logoutFailed = assert.rejects(logout, { code: "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED" });
    release.resolve();
    await Promise.all([refreshFailed, logoutFailed]);
    assert.equal(await repo.loadActive(), null);
  } finally {
    release.resolve();
    rotateMock?.mock.restore();
    await f.dispose();
  }
});

test("logout does not wait forever when refresh ignores its abort signal", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  const deadline = new AbortController();
  const timeout = mock.method(AbortSignal, "timeout", () => deadline.signal);
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: bundle(now) });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    f.setRefresh(async () => {
      entered.resolve();
      await release.promise;
      return bundle(now, "refresh-successor");
    });
    const refreshing = f.account.oauth.refreshToken();
    const refreshFailed = assert.rejects(refreshing);
    await entered.promise;
    const logout = f.account.oauth.logout();
    const outcome = logout.then(() => "success", () => "failure");
    deadline.abort(new Error("synthetic deadline"));
    const result = await Promise.race([
      outcome,
      new Promise<"stuck">((resolve) => setTimeout(() => resolve("stuck"), 100)),
    ]);
    release.resolve();
    await refreshFailed;
    await outcome;
    assert.equal(result, "failure");
  } finally {
    release.resolve();
    timeout.mock.restore();
    await f.dispose();
  }
});

test("logout during B owner publication does not restore A on cold restart", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  let cold: Awaited<ReturnType<typeof f.create>> | undefined;
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: bundle(now) });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    f.setExchange(async () => bundle(now, "refresh-b", "2", "web-sid-b"));
    f.setOwnerChanged(async (owner) => {
      if (typeof owner === "object" && owner !== null && "userId" in owner && owner.userId === "2") {
        entered.resolve();
        await release.promise;
      }
    });
    const start = await f.account.oauth.startOAuth("new-api");
    await fetch(callback(start.authorizeUrl));
    await entered.promise;
    const logout = f.account.oauth.logout();
    release.resolve();
    await logout;
    assert.equal(f.account.getOwner(), null);
    const activeAfterLogout = await repo.loadActive();
    f.setGetMe(async () => success({
      schema_version: 1,
      server_time: now,
      session_id: "web-sid",
      user: bundle(now).user,
      authorization_revision: "0",
    }));
    cold = await f.create();
    const restored = cold.create({ fetch: f.fetchBackend, onOwnerChanged: () => {} }).account;
    const coldStatus = (await restored.oauth.restoreCachedSessionState()).status;
    assert.deepEqual(
      { activeUserId: activeAfterLogout?.bundle.user.id ?? null, coldStatus },
      { activeUserId: null, coldStatus: "signed-out" },
    );
  } finally {
    release.resolve();
    await cold?.dispose();
    await f.dispose();
  }
});

test("logout reports failure of the already running invalidation revocation", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    await new NewApiSessionRepo(origin, f.factory.credentialStore).commit({
      schemaVersion: 1, origin, bundle: bundle(now),
    });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    const owner = f.account.getOwner()!;
    f.setLogout(async () => {
      entered.resolve();
      await release.promise;
      throw new Error("synthetic offline");
    });
    f.advance(600_001);
    const invalidation = f.account.getRelayCredential(owner);
    const invalidationFailed = assert.rejects(invalidation);
    await entered.promise;
    const logout = f.account.oauth.logout();
    const logoutFailed = assert.rejects(logout, { code: "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED" });
    release.resolve();
    await Promise.all([invalidationFailed, logoutFailed]);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

test("logout reports failed compensation of B already issued before logout", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  const compensated = barrier<void>();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: bundle(now) });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    f.setExchange(async () => bundle(now, "refresh-b", "2", "web-sid-b"));
    f.setGetMe(async () => {
      entered.resolve();
      await release.promise;
      return success({ schema_version: 1, server_time: now, session_id: "web-sid-b", user: bundle(now, "refresh-b", "2", "web-sid-b").user, authorization_revision: "0" });
    });
    f.setLogout(async () => {
      if (f.calls.at(-1)?.body?.session_id === "web-sid-b") {
        compensated.resolve();
        throw new Error("synthetic offline");
      }
      return success({ schema_version: 1, server_time: now, revoked: true });
    });
    const start = await f.account.oauth.startOAuth("new-api");
    await fetch(callback(start.authorizeUrl));
    await entered.promise;
    const logout = f.account.oauth.logout();
    const logoutFailed = assert.rejects(logout, { code: "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED" });
    release.resolve();
    await compensated.promise;
    await logoutFailed;
    assert.equal(await repo.loadActive(), null);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

test("a fresh sign-in waits for old logout and cannot be cleared by its late completion", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  const signedIn = barrier<void>();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const a = bundle(now);
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: a });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    f.setLogout(async () => {
      entered.resolve();
      await release.promise;
      throw new Error("synthetic offline");
    });
    const logout = f.account.oauth.logout();
    const rejected = assert.rejects(logout, { code: "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED" });
    await entered.promise;
    const start = f.account.oauth.startOAuth("new-api");
    let started = false;
    void start.then(() => { started = true; });
    await Promise.resolve();
    assert.equal(started, false);
    f.account.oauth.onDidChangeSession((state) => {
      if (state === "signed-in") signedIn.resolve();
    });
    f.setExchange(async () => bundle(now, "refresh-b", "2", "web-sid-b"));
    release.resolve();
    await rejected;
    const next = await start;
    assert.equal((await fetch(callback(next.authorizeUrl))).status, 200);
    await signedIn.promise;
    assert.equal(f.account.getOwner()?.userId, "2");
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    assert.equal((await repo.loadActive())?.bundle.refresh_token, "refresh-b");
    assert.deepEqual(
      f.calls.filter((call) => call.path.endsWith("/auth/logout")).map((call) => call.body?.session_id),
      ["web-sid"],
    );
  } finally {
    release.resolve();
    await f.dispose();
  }
});

test("failed local credential removal blocks restore and cannot be reported as remote uncertainty", async () => {
  const f = await fixture();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: bundle(now) });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    const database = f.factory.credentialStore.credentialsFile;
    await writeFile(database, "{");
    await assert.rejects(f.account.oauth.logout(), (error: unknown) =>
      !(error instanceof Error && "code" in error && error.code === "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED"),
    );
    assert.equal(f.account.getOwner(), null);
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "signed-out");
    await assert.rejects(f.account.oauth.startOAuth("new-api"), {
      code: "XCODE_LOCAL_WEB_LOGOUT_INCOMPLETE",
    });
    assert.equal(await readFile(database, "utf8"), "{");
  } finally {
    await f.dispose();
  }
});

test("owner cleanup failure still removes the session and attempts remote revocation", async () => {
  const f = await fixture();
  let cold: Awaited<ReturnType<typeof f.create>> | undefined;
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: bundle(now) });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    f.setOwnerChanged(async (owner) => {
      if (owner === null) throw new Error("synthetic cleanup failure");
    });
    await assert.rejects(f.account.oauth.logout(), /synthetic cleanup failure/);
    assert.equal(await repo.loadActive(), null);
    assert.equal(f.calls.filter((call) => call.path.endsWith("/auth/logout")).length, 1);
    cold = await f.create();
    const restored = cold.create({ fetch: f.fetchBackend, onOwnerChanged: () => {} }).account;
    assert.equal((await restored.oauth.restoreCachedSessionState()).status, "signed-out");
  } finally {
    await cold?.dispose();
    await f.dispose();
  }
});

test("a disk write failure leaves the prior session recoverable after a cold restart", async () => {
  const f = await fixture();
  let cold: Awaited<ReturnType<typeof f.create>> | undefined;
  const directory = join(f.root, "local-web", "new-api");
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: bundle(now) });
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "authenticated");
    await chmod(directory, 0o500);
    await assert.rejects(f.account.oauth.logout());
    await chmod(directory, 0o700);
    cold = await f.create();
    const restored = cold.create({ fetch: f.fetchBackend, onOwnerChanged: () => {} }).account;
    assert.equal((await restored.oauth.restoreCachedSessionState()).status, "authenticated");
  } finally {
    await chmod(directory, 0o700);
    await cold?.dispose();
    await f.dispose();
  }
});

test("desktop account retains its existing best-effort logout behavior", async () => {
  const f = await fixture();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const repo = new NewApiSessionRepo(origin, f.factory.credentialStore);
    await repo.commit({ schemaVersion: 1, origin, bundle: bundle(now) });
    const desktop = new NewApiAccountService({
      repo,
      adapter: new NewApiProviderAdapter(new NewApiClient(origin, { fetch: f.fetchBackend })),
    });
    assert.equal((await desktop.oauth.restoreCachedSessionState()).status, "authenticated");
    f.setLogout(async () => { throw new Error("synthetic offline"); });
    await desktop.oauth.logout();
    assert.equal(desktop.getOwner(), null);
    assert.equal(await repo.loadActive(), null);
  } finally {
    await f.dispose();
  }
});

test("cancel during exchange compensates with xwork-cli and cannot commit a late session", async () => {
  const f = await fixture();
  const entered = barrier<void>();
  const release = barrier<void>();
  try {
    f.setExchange(async () => {
      entered.resolve();
      await release.promise;
      return bundle(Math.floor(Date.now() / 1000) * 1000);
    });
    const start = await f.account.oauth.startOAuth("new-api");
    assert.equal((await fetch(callback(start.authorizeUrl))).status, 200);
    await entered.promise;
    assert.equal((await fetch(callback(start.authorizeUrl))).status, 409);
    assert.equal(f.calls.filter((call) => call.path.endsWith("/auth/token")).length, 1);
    await f.account.oauth.cancelPending();
    release.resolve();
    for (let i = 0; i < 100 && !f.calls.some((call) => call.path.endsWith("/auth/logout")); i++)
      await new Promise((r) => setTimeout(r, 10));
    const logout = f.calls.find((call) => call.path.endsWith("/auth/logout"))!.body!;
    assert.equal(logout.client_id, "xwork-cli");
    assert.equal(f.account.getOwner(), null);
    assert.equal(f.events.includes("signed-in"), false);
    assert.deepEqual(f.failures, []);
    assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "signed-out");
  } finally {
    release.resolve();
    await f.dispose();
  }
});

test("failure capability and event pass through the OAuth RPC proxy", async () => {
  const f = await fixture();
  try {
    const server = ProxyChannel.fromService(f.account.oauth);
    const client = ProxyChannel.toService<IOAuthService>({
      call: (name, args) => server.call(undefined, name, args),
      listen: (name, arg) => server.listen(undefined, name, arg),
    });
    const received = barrier<{ provider: string; state: string; reason: string }>();
    const subscription = client.onDidFailAuthorization!(received.resolve);
    assert.deepEqual(await client.getLocalWebAuthorizationCapabilities!(), { failureEvents: true });
    f.setExchange(async () => {
      throw new Error("backend offline");
    });
    const start = await client.startOAuth("new-api");
    await fetch(callback(start.authorizeUrl));
    assert.deepEqual(await received.promise, {
      provider: "new-api",
      state: start.state,
      reason: "backend-unavailable",
    });
    subscription.dispose();
  } finally {
    await f.dispose();
  }
});

test("backend failure publishes only a non-secret current authorization event", async () => {
  const f = await fixture();
  try {
    f.setExchange(async () => {
      throw new Error("token=private-secret");
    });
    const start = await f.account.oauth.startOAuth("new-api");
    assert.equal((await fetch(callback(start.authorizeUrl))).status, 200);
    await f.failed.promise;
    assert.deepEqual(f.failures, [
      { provider: "new-api", state: start.state, reason: "backend-unavailable" },
    ]);
    assert.equal(JSON.stringify(f.failures).includes("private-secret"), false);
    assert.equal(f.account.getOwner(), null);
  } finally {
    await f.dispose();
  }
});

test("local Web fetch enforces a per-request deadline while preserving caller abort", async () => {
  const deadlines: AbortController[] = [];
  const timeout = mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 15_000);
    const controller = new AbortController();
    deadlines.push(controller);
    return controller.signal;
  });
  try {
    const fetchWithTimeout = createLocalWebTimeoutFetch(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          assert.ok(signal);
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const caller = new AbortController();
    const request = fetchWithTimeout(`${origin}/api/test`, { signal: caller.signal });
    assert.equal(deadlines.length, 1);
    caller.abort(new Error("caller canceled"));
    await assert.rejects(request, /caller canceled/);
    assert.equal(deadlines[0]!.signal.aborted, false);

    const requestSignal = new AbortController();
    const requestObject = new Request(`${origin}/api/test`, { signal: requestSignal.signal });
    const fromRequest = fetchWithTimeout(requestObject);
    requestSignal.abort(new Error("request canceled"));
    await assert.rejects(fromRequest, /request canceled/);
    assert.equal(deadlines.length, 2);
  } finally {
    timeout.mock.restore();
  }
});

test("token and Me aborts report backend-unavailable without exposing secrets", async () => {
  for (const phase of ["token", "me"] as const) {
    const f = await fixture();
    const deadline = new AbortController();
    const timeout = mock.method(AbortSignal, "timeout", () => deadline.signal);
    const entered = barrier<void>();
    const failOnAbort = (signal?: AbortSignal | null): Promise<never> =>
      new Promise((_resolve, reject) => {
        assert.ok(signal, `${phase} must receive an abort signal`);
        entered.resolve();
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    try {
      if (phase === "token") f.setExchange(failOnAbort);
      else f.setGetMe(failOnAbort);
      const start = await f.account.oauth.startOAuth("new-api");
      await fetch(callback(start.authorizeUrl));
      await entered.promise;
      deadline.abort(new Error("synthetic-secret-from-transport"));
      await f.failed.promise;
      assert.deepEqual(f.failures, [
        { provider: "new-api", state: start.state, reason: "backend-unavailable" },
      ]);
      assert.equal(JSON.stringify(f.failures).includes("synthetic-secret-from-transport"), false);
      assert.equal(f.account.getOwner(), null);
      assert.equal((await f.account.oauth.restoreCachedSessionState()).status, "signed-out");
      if (phase === "me") {
        const logout = f.calls.find((call) => call.path.endsWith("/auth/logout"));
        assert.equal(logout?.body?.client_id, "xwork-cli");
        assert.equal(logout?.body?.refresh_token, "refresh-1");
      }
    } finally {
      timeout.mock.restore();
      await f.dispose();
    }
  }
});

test("an aborted response body is unavailable on local Web but keeps desktop classification", async () => {
  const f = await fixture();
  try {
    f.setGetMe(async () => {
      const response = success({});
      Object.defineProperty(response, "json", {
        value: async () => {
          throw new DOMException("private response details", "AbortError");
        },
      });
      return response;
    });
    const start = await f.account.oauth.startOAuth("new-api");
    await fetch(callback(start.authorizeUrl));
    await f.failed.promise;
    assert.deepEqual(f.failures, [
      { provider: "new-api", state: start.state, reason: "backend-unavailable" },
    ]);
    assert.equal(
      f.calls.find((call) => call.path.endsWith("/auth/logout"))?.body?.client_id,
      "xwork-cli",
    );
    const desktop = new NewApiClient(origin, {
      fetch: async () => {
        const response = success({});
        Object.defineProperty(response, "json", {
          value: async () => {
            throw new DOMException("private response details", "AbortError");
          },
        });
        return response;
      },
    });
    await assert.rejects(desktop.getMe("synthetic-token"), { code: "XCODE_PROTOCOL_INVALID" });
  } finally {
    await f.dispose();
  }
});

test("a late token from a fetch that ignores abort is still revoked after cancellation", async () => {
  const f = await fixture();
  const deadline = new AbortController();
  const timeout = mock.method(AbortSignal, "timeout", () => deadline.signal);
  const entered = barrier<void>();
  const release = barrier<void>();
  try {
    f.setExchange(async (signal) => {
      assert.ok(signal);
      entered.resolve();
      await release.promise;
      assert.equal(signal.aborted, true);
      return bundle(Math.floor(Date.now() / 1000) * 1000);
    });
    const start = await f.account.oauth.startOAuth("new-api");
    await fetch(callback(start.authorizeUrl));
    await entered.promise;
    deadline.abort(new Error("deadline"));
    await f.account.oauth.cancelPending();
    release.resolve();
    for (let i = 0; i < 100 && !f.calls.some((call) => call.path.endsWith("/auth/logout")); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const logout = f.calls.find((call) => call.path.endsWith("/auth/logout"));
    assert.equal(logout?.body?.client_id, "xwork-cli");
    assert.equal(logout?.body?.refresh_token, "refresh-1");
    assert.equal(f.account.getOwner(), null);
    assert.deepEqual(f.failures, []);
  } finally {
    release.resolve();
    timeout.mock.restore();
    await f.dispose();
  }
});

test("desktop NewApiClient does not receive a local Web deadline", async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  let capturedSignal: AbortSignal | null | undefined;
  const timeout = mock.method(AbortSignal, "timeout", () => {
    throw new Error("unexpected Web deadline in desktop client");
  });
  try {
    const client = new NewApiClient(origin, {
      now: () => now,
      fetch: async (_input, init) => {
        capturedSignal = init?.signal;
        return success(bundle(now));
      },
    });
    await client.exchangeAuthorizationCode({ code, codeVerifier: "synthetic-verifier" });
    assert.equal(capturedSignal, undefined);
    assert.equal(timeout.mock.callCount(), 0);
  } finally {
    timeout.mock.restore();
  }
});

test("public cache recovery and missing Web key never modify desktop credentials", async () => {
  const f = await fixture();
  try {
    const desktop = join(f.root, "credentials.json");
    const desktopSentinel = JSON.stringify({ "oauth:bigmodel:access_token": "desktop-synthetic" });
    await writeFile(desktop, desktopSentinel);
    const web = createCredentialService(f.factory.credentialStore);
    const cacheKey = "project-key-location:v1:synthetic";
    await web.save("custom-provider:synthetic:api-key", "custom-synthetic-secret");
    const before = JSON.parse(await readFile(f.factory.credentialStore.credentialsFile, "utf8"));
    await writeFile(
      f.factory.credentialStore.credentialsFile,
      JSON.stringify({ ...before, [cacheKey]: "enc:v1:broken" }),
    );
    assert.equal(await web.recoverUnreadable(cacheKey, () => {}), null);
    assert.equal(await web.load("custom-provider:synthetic:api-key"), "custom-synthetic-secret");
    const afterRecovery = await readFile(f.factory.credentialStore.credentialsFile, "utf8");
    const encrypted = JSON.parse(afterRecovery)["custom-provider:synthetic:api-key"];
    assert.match(encrypted, /^enc:v1:/);
    assert.doesNotMatch(afterRecovery, /custom-synthetic-secret/);
    const otherCipher = createCredentialCipherProvider({
      env: { ZCODE_CREDENTIAL_SECRET: "other" },
    });
    assert.throws(() => otherCipher.decrypt(encrypted));
    f.loseKey();
    await assert.rejects(f.create(), { code: "XCODE_SECURE_STORAGE_UNAVAILABLE" });
    assert.equal(await readFile(f.factory.credentialStore.credentialsFile, "utf8"), afterRecovery);
    assert.equal(await readFile(desktop, "utf8"), desktopSentinel);
  } finally {
    await f.dispose();
  }
});

test("expired listener and a missing key for existing data fail closed", async () => {
  const f = await fixture();
  try {
    const start = await f.account.oauth.startOAuth("new-api");
    f.advance(300_001);
    await fetch(callback(start.authorizeUrl));
    await f.failed.promise;
    assert.deepEqual(f.failures, [{ provider: "new-api", state: start.state, reason: "expired" }]);
    assert.equal(f.calls.length, 0);
    assert.equal(f.account.getOwner(), null);
    await writeFile(join(f.root, "local-web", "new-api", "credentials.json"), "{}");
    f.loseKey();
    await assert.rejects(f.create(), /SECURE_STORAGE_UNAVAILABLE/);
  } finally {
    await f.dispose();
  }
});
