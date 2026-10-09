import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { NewApiSessionBundle } from "@zcode/shared";
import { createCredentialCipherProvider } from "../src/credential/providers/credentialCipherProvider.js";
import { NewApiAccountService } from "../src/new-api/newApiAccountService.js";
import { NewApiClient } from "../src/new-api/newApiClient.js";
import { NewApiSessionRepo, type NewApiStoredSession } from "../src/new-api/newApiSessionRepo.js";
import { NewApiProviderAdapter } from "../src/oauth/providers/newApiProviderAdapter.js";

const origin = "https://native.example";
const initialTime = 1_800_000_000_000;
function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function bundle(id = "1", sid = "sid-1", refresh = "refresh-1", expires = initialTime + 60_000): NewApiSessionBundle {
  const payload = Buffer.from(JSON.stringify({
    iss: "new-api", aud: ["new-api-xcode"], token_use: "xcode_access",
    sub: id, sid, exp: expires / 1000, uv: 1, sv: 1, nbf: initialTime / 1000 - 5,
    iat: initialTime / 1000, scopes: ["profile:read", "wallet:read", "usage:read"],
  })).toString("base64url");
  return {
    schema_version: 1, server_time: initialTime, access_token: `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${payload}.${Buffer.alloc(32, 1).toString("base64url")}`,
    access_expires_at: expires, refresh_token: refresh, refresh_expires_at: initialTime + 600_000,
    token_type: "Bearer", session_id: sid,
    user: { id, username: `user-${id}`, display_name: `User ${id}`, avatar_url: null },
    relay_credential: { token: `sk-relay-${sid}`, expires_at: initialTime + 600_000 },
  };
}
const success = (data: unknown) => new Response(JSON.stringify({ success: true, data }), {
  headers: { "content-type": "application/json" },
});
const failure = (code: string, status: number) => new Response(JSON.stringify({
  success: false, code, message: "Safe server failure", request_id: "test-request",
}), { status, headers: { "content-type": "application/json" } });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "xcode-native-lifecycle-"));
  const credentialsFile = join(dir, "credentials.json");
  const cipherProvider = createCredentialCipherProvider({
    env: { ZCODE_CREDENTIAL_SECRET: randomBytes(32).toString("hex") },
  });
  const legacy = cipherProvider.encrypt("unowned-official-secret");
  await writeFile(credentialsFile, JSON.stringify({ "official-cloud:unowned": legacy, zcodeJwtToken: legacy }));
  let now = initialTime;
  let tokenSession = bundle();
  let exchange: (code: string) => Promise<NewApiSessionBundle> = async () => tokenSession;
  let refresh: () => Promise<NewApiSessionBundle> = async () => bundle("1", "sid-1", "refresh-2", now + 60_000);
  let meError: Response | null = null;
  let refreshCalls = 0;
  const revoked: string[] = [];
  const client = new NewApiClient(origin, { now: () => now, fetch: async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.pathname.endsWith("/auth/token")) {
      tokenSession = await exchange(body.code);
      return success(tokenSession);
    }
    if (url.pathname.endsWith("/auth/refresh")) {
      refreshCalls++;
      tokenSession = await refresh();
      return success(tokenSession);
    }
    if (url.pathname.endsWith("/auth/logout")) {
      revoked.push(body.session_id);
      return success({ schema_version: 1, server_time: now, revoked: true });
    }
    if (url.pathname.endsWith("/me")) {
      if (meError) return meError.clone();
      const authorization = new Headers(init?.headers).get("authorization")!;
      const claims = JSON.parse(Buffer.from(authorization.split(".")[1]!, "base64url").toString());
      return success({ schema_version: 1, server_time: now, session_id: claims.sid,
        user: { id: claims.sub, username: `user-${claims.sub}`, display_name: `User ${claims.sub}`, avatar_url: null },
        authorization_revision: "0" });
    }
    throw new Error("Unexpected lifecycle endpoint");
  } });
  const repo = new NewApiSessionRepo(origin, { credentialsFile, cipherProvider });
  const owners: unknown[] = [];
  const service = new NewApiAccountService({ adapter: new NewApiProviderAdapter(client), repo,
    now: () => now, onOwnerChanged: (owner) => { owners.push(owner); } });
  const callback = (state: string) => `zcode://oauth/callback?provider=new-api&state=${state}&code=${state}`;
  return { service, repo, owners, revoked, callback, credentialsFile, legacy,
    newService: () => new NewApiAccountService({ adapter: new NewApiProviderAdapter(client), repo, now: () => now }),
    setExchange: (action: typeof exchange) => { exchange = action; },
    setRefresh: (action: typeof refresh) => { refresh = action; },
    setMeError: (response: Response | null) => { meError = response; },
    advance: () => { now = initialTime + 61_000; },
    refreshCalls: () => refreshCalls,
    login: async () => {
      const start = await service.oauth.startOAuth("new-api");
      return service.oauth.handleCallback(callback(start.state));
    },
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

test("late A exchange cannot publish or persist over B, and revokes the actual late SID", async () => {
  const f = await fixture();
  try {
    const arrived = barrier<void>();
    const late = barrier<NewApiSessionBundle>();
    const a = await f.service.oauth.startOAuth("new-api");
    f.setExchange(async (code) => {
      if (code === a.state) { arrived.resolve(); return late.promise; }
      return bundle("2", "sid-2", "refresh-b");
    });
    const pendingA = f.service.oauth.handleCallback(f.callback(a.state));
    await arrived.promise;
    const b = await f.service.oauth.startOAuth("new-api");
    await f.service.oauth.handleCallback(f.callback(b.state));
    late.resolve(bundle());
    assert.equal(await pendingA, null);
    assert.equal(f.service.getOwner()?.userId, "2");
    assert.equal((await f.repo.loadActive())?.bundle.session_id, "sid-2");
    assert.deepEqual(f.revoked, ["sid-1"]);
  } finally { await f.dispose(); }
});

test("cancel after exchange and during atomic commit compensates persistence", async () => {
  const f = await fixture();
  try {
    const entered = barrier<void>();
    const release = barrier<void>();
    const commit = f.repo.commit.bind(f.repo);
    f.repo.commit = async (session: NewApiStoredSession) => {
      await commit(session); entered.resolve(); await release.promise;
    };
    const start = await f.service.oauth.startOAuth("new-api");
    const callback = f.service.oauth.handleCallback(f.callback(start.state));
    await entered.promise;
    const cancel = f.service.oauth.cancelPending();
    release.resolve();
    assert.equal(await callback, null);
    await cancel;
    assert.equal(f.service.getOwner(), null);
    assert.equal(await f.repo.loadActive(), null);
    assert.deepEqual(f.revoked, ["sid-1"]);
  } finally { await f.dispose(); }
});

test("cancel before exchange completes revokes without writing credentials", async () => {
  const f = await fixture();
  try {
    const entered = barrier<void>();
    const release = barrier<NewApiSessionBundle>();
    f.setExchange(async () => { entered.resolve(); return release.promise; });
    const start = await f.service.oauth.startOAuth("new-api");
    const pending = f.service.oauth.handleCallback(f.callback(start.state));
    await entered.promise;
    await f.service.oauth.cancelPending();
    release.resolve(bundle());
    assert.equal(await pending, null);
    assert.equal(await f.repo.loadActive(), null);
    assert.deepEqual(f.revoked, ["sid-1"]);
  } finally { await f.dispose(); }
});

test("concurrent refresh is single-flight, rotates encrypted secret and retains owner generation", async () => {
  const f = await fixture();
  try {
    await f.login();
    const owner = f.service.getOwner()!;
    const entered = barrier<void>();
    const release = barrier<NewApiSessionBundle>();
    f.setRefresh(async () => { entered.resolve(); return release.promise; });
    f.advance();
    const a = f.service.withControlSession(async (_, current) => current);
    await entered.promise;
    const b = f.service.withControlSession(async (_, current) => current);
    release.resolve(bundle("1", "sid-1", "refresh-rotated", initialTime + 120_000));
    assert.deepEqual(await a, owner);
    assert.deepEqual(await b, owner);
    assert.equal(f.refreshCalls(), 1);
    assert.equal((await f.repo.loadActive())?.bundle.refresh_token, "refresh-rotated");
    assert.equal((await readFile(f.credentialsFile, "utf8")).includes("refresh-rotated"), false);
  } finally { await f.dispose(); }
});

for (const mutation of ["user", "sid", "key"] as const) {
  test(`refresh rejects changed ${mutation} and closes current execution`, async () => {
    const f = await fixture();
    try {
      await f.login();
      const changed = bundle(mutation === "user" ? "2" : "1", mutation === "sid" ? "sid-2" : "sid-1", "refresh-2");
      if (mutation === "key") changed.relay_credential.token = "sk-unexpected";
      f.setRefresh(async () => changed);
      await assert.rejects(f.service.oauth.refreshToken());
      assert.equal(f.service.getOwner(), null);
      assert.equal(await f.repo.loadActive(), null);
      assert.equal(f.owners.at(-1), null);
    } finally { await f.dispose(); }
  });
}

test("503 restore preserves recoverable record, explicit session revocation removes only private owner", async () => {
  const f = await fixture();
  try {
    await f.login();
    const before = await f.repo.loadActive();
    f.setMeError(failure("XCODE_BACKEND_UNAVAILABLE", 503));
    const unavailable = await f.service.oauth.restoreCachedSessionState();
    assert.equal(unavailable.status, "unavailable");
    assert.deepEqual(await f.repo.loadActive(), before);
    f.setMeError(failure("XCODE_SESSION_INVALID", 401));
    assert.equal((await f.service.oauth.restoreCachedSessionState()).status, "signed-out");
    assert.equal(f.service.getOwner(), null);
    assert.equal(await f.repo.loadActive(), null);
    const store = JSON.parse(await readFile(f.credentialsFile, "utf8"));
    assert.equal(store["official-cloud:unowned"], f.legacy);
    assert.equal(store.zcodeJwtToken, f.legacy);
  } finally { await f.dispose(); }
});

test("control expiry retries once, permission denial preserves owner, logout never clears official credentials", async () => {
  const f = await fixture();
  try {
    await f.login();
    let calls = 0;
    const error = Object.assign(new Error("safe"), { code: "XCODE_ACCESS_EXPIRED", status: 401 });
    await assert.rejects(f.service.withControlSession(async () => { calls++; throw error; }));
    assert.equal(calls, 2);
    assert.equal(f.refreshCalls(), 1);
    const owner = f.service.getOwner();
    await assert.rejects(f.service.withControlSession(async () => {
      throw Object.assign(new Error("safe"), { code: "XCODE_PLAN_UNASSIGNED", status: 403 });
    }));
    assert.deepEqual(f.service.getOwner(), owner);
    await f.service.oauth.logoutAll();
    const store = JSON.parse(await readFile(f.credentialsFile, "utf8"));
    assert.equal(store["official-cloud:unowned"], f.legacy);
    assert.equal(store.zcodeJwtToken, f.legacy);
  } finally { await f.dispose(); }
});

test("Renderer OAuth projection exposes no Host session or private implementation functions", async () => {
  const f = await fixture();
  try {
    await f.login();
    const approved = ["getProviders", "getActiveProvider", "restoreCachedSession", "restoreCachedSessionState", "restoreSession", "startOAuth", "startOAuthWithPolling", "pollPendingOAuth", "handleCallback", "refreshToken", "logout", "logoutAll", "cancelPending"];
    assert.deepEqual(Object.keys(f.service.oauth).sort(), approved.sort());
    assert.deepEqual(Object.keys(f.service), ["oauth"]);
    assert.equal(JSON.stringify(await f.service.oauth.restoreSession()).includes("sk-"), false);
    assert.equal(JSON.stringify(f.service).includes("refresh-1"), false);
    await assert.rejects(f.service.oauth.pollPendingOAuth(), { code: "XCODE_PRIVATE_POLLING_UNSUPPORTED" });
    await assert.rejects(f.service.oauth.startOAuthWithPolling("new-api"), { code: "XCODE_PRIVATE_POLLING_UNSUPPORTED" });
  } finally { await f.dispose(); }
});
