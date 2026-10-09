import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  NewApiSessionBundleSchema,
  normalizeNewApiOrigin,
} from "@zcode/shared";
import { NewApiClient, NewApiClientError } from "../src/new-api/newApiClient.js";
import { NewApiProviderAdapter } from "../src/oauth/providers/newApiProviderAdapter.js";

const now = 1_800_000_000_000;
const origin = "https://private.example";
const code = "c".repeat(43);
const verifier = "v".repeat(43);
function jwt(overrides: Record<string, unknown> = {}) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "new-api", aud: ["new-api-xcode"], token_use: "xcode_access",
    sub: "9007199254740993", sid: "private-sid", exp: (now + 900_000) / 1000,
    nbf: now / 1000 - 5, iat: now / 1000, uv: 1, sv: 1,
    scopes: ["profile:read", "wallet:read", "usage:read"], ...overrides,
  })}.${Buffer.alloc(32, 7).toString("base64url")}`;
}
function bundle() {
  return {
    schema_version: 1, server_time: now, access_token: jwt(), access_expires_at: now + 900_000,
    refresh_token: "refresh-test-secret", refresh_expires_at: now + 86_400_000,
    token_type: "Bearer", session_id: "private-sid",
    user: { id: "9007199254740993", username: "native", display_name: "Native", avatar_url: null },
    relay_credential: { token: "sk-test-relay", expires_at: now + 86_400_000 },
  };
}
function clientFor(data: unknown, status = 200) {
  return new NewApiClient(origin, {
    now: () => now,
    fetch: async () => new Response(JSON.stringify(status === 200 ? { success: true, data } : data), {
      status, headers: { "Content-Type": "application/json" },
    }),
  });
}
const protocolError = (error: unknown) => error instanceof NewApiClientError &&
  error.code === "XCODE_PROTOCOL_INVALID" && !error.message.includes("secret");

test("fresh exchange rejects plausible wrong-version, opaque, wrong-purpose and wrong-owner sessions", async () => {
  for (const patch of [
    { schema_version: 2 }, { access_token: "opaque-test-secret" },
    { access_token: jwt({ sub: "42" }) }, { access_token: jwt({ sid: "another-sid" }) },
    { access_token: jwt({ token_use: "access" }) }, { access_token: jwt({ iss: "official" }) },
    { access_token: jwt({ aud: ["new-api-dashboard"] }) },
    { access_token: jwt({ exp: (now - 1000) / 1000 }), access_expires_at: now - 1000 },
    { access_expires_at: now + 901_000 },
  ]) {
    await assert.rejects(clientFor({ ...bundle(), ...patch }).exchangeAuthorizationCode({ code, codeVerifier: verifier }), protocolError);
  }
  const accepted = await clientFor(bundle()).exchangeAuthorizationCode({ code, codeVerifier: verifier });
  assert.equal(accepted.user.id, "9007199254740993");
  assert.equal(accepted.user.avatar_url, null);
  const cached = { ...bundle(), access_token: jwt({ exp: 1 }), access_expires_at: 1000 };
  assert.equal(NewApiSessionBundleSchema.parse(cached).refresh_token, "refresh-test-secret");
});

test("control data preserves arbitrary precision decimals, milliseconds and unlimited null facts", async () => {
  const entitlements = await clientFor({
    schema_version: 1, server_time: now, status: "active", authorization_revision: "9007199254740995",
    subscription: { id: "9007199254740997", plan_id: "1", plan_title: "Manual", source: "admin", usage_scope: "xcode", start_time: now, end_time: null },
    quota: { scope: "xcode-subscription", unit: "quota", unlimited: true, total: null, used: "9007199254740999", remaining: null, used_percentage: null,
      reset_period: "never", reset_custom_seconds: "0", last_reset_time: null, next_reset_time: null, reset_time_zone: "server-local", reset_utc_offset_seconds: 28800 },
    funding_policy: { subscription_only: true, wallet_fallback: false, other_subscription_fallback: false }, self_service_reset: false, purchase_mode: "manual_admin",
  }).getEntitlements("control");
  assert.equal(entitlements.quota?.used, "9007199254740999");
  assert.equal(entitlements.quota?.remaining, null);
  assert.equal(entitlements.subscription?.start_time, now);
  const plans = await clientFor({ schema_version: 1, server_time: now, purchase_mode: "manual_admin", self_service_purchase: false,
    items: [{ id: "1", title: "Manual", subtitle: "", price_amount: "0.1234567890123456789", currency: "USD", duration_unit: "month", duration_value: "1", duration_custom_seconds: "0", total_quota: "9007199254740999", reset_period: "never", reset_custom_seconds: "0", enabled: true }],
  }).getPlans("control");
  assert.equal(plans.items[0]?.price_amount, "0.1234567890123456789");
  await assert.rejects(clientFor({ ...entitlements, server_time: Number.MAX_SAFE_INTEGER + 1 }).getEntitlements("control"), protocolError);
});

test("top-level 400 and 503 remain typed failures without leaking server message or retrying", async () => {
  for (const [status, errorCode] of [[400, "XCODE_AUTH_CODE_INVALID"], [503, "XCODE_BACKEND_UNAVAILABLE"], [503, "XCODE_USAGE_UNAVAILABLE"]] as const) {
    await assert.rejects(clientFor({ success: false, code: errorCode, message: "refresh-test-secret", request_id: "request-1" }, status).getMe("control"),
      (error: unknown) => error instanceof NewApiClientError && error.status === status && error.code === errorCode && error.requestId === "request-1" && !error.message.includes("secret"));
  }
  await assert.rejects(clientFor({ success: false, code: "XCODE_SESSION_INVALID", message: "secret" }).getMe("control"), protocolError);
  const offline = new NewApiClient(origin, { fetch: async () => { throw new Error("control-secret"); } });
  await assert.rejects(offline.getMe("control"), (error: unknown) => error instanceof NewApiClientError && error.code === "XCODE_BACKEND_UNAVAILABLE" && error.status === 0);
});

test("requests use canonical isolated origin, exact auth bodies and no redirect or cookies", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = new NewApiClient(`${origin}/`, { now: () => now, fetch: async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ success: true, data: bundle() }));
  } });
  await client.exchangeAuthorizationCode({ code, codeVerifier: verifier });
  await client.refreshSession({ sessionId: "private-sid", refreshToken: "refresh-test-secret" });
  assert.equal(requests[0]?.url, `${origin}/api/xcode/v1/auth/token`);
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), { grant_type: "authorization_code", client_id: "xcode-desktop", redirect_uri: "zcode://oauth/callback", code, code_verifier: verifier });
  assert.deepEqual(JSON.parse(String(requests[1]?.init.body)), { client_id: "xcode-desktop", session_id: "private-sid", refresh_token: "refresh-test-secret" });
  for (const { init } of requests) {
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(new Headers(init.headers).has("Cookie"), false);
    assert.equal(new Headers(init.headers).has("Authorization"), false);
  }
  const redirected = new NewApiClient(origin, { fetch: async () => new Response(null, { status: 302, headers: { Location: "https://official.example" } }) });
  await assert.rejects(redirected.getMe("control"), protocolError);
});

test("Web handoff rejects cross-origin navigation, encoded paths, overrides, secrets and excessive expiry", async () => {
  const handoff = "h".repeat(43);
  const valid = { schema_version: 1, server_time: now, url: `${origin}/xcode/plans?handoff=${handoff}`, expires_at: now + 60_000 };
  assert.equal((await clientFor(valid).createWebHandoff("control")).url, valid.url);
  for (const url of [
    `https://evil.example/xcode/plans?handoff=${handoff}`, `https://private.example.evil/xcode/plans?handoff=${handoff}`,
    `https://user@private.example/xcode/plans?handoff=${handoff}`, `${origin}/xcode/%70lans?handoff=${handoff}`,
    `${valid.url}&handoff=second`, `${valid.url}&redirect=https://evil.example`, `${valid.url}#secret`,
    `${origin}/xcode/plans?handoff=sk-control-secret`, `${origin}/xcode/plans?access_token=control-secret`,
  ]) await assert.rejects(clientFor({ ...valid, url }).createWebHandoff("control"), protocolError);
  for (const expires_at of [now, now + 60_001]) await assert.rejects(clientFor({ ...valid, expires_at }).createWebHandoff("control"), protocolError);
});

test("adapter creates real S256 PKCE and rejects callback authority/provider/purpose ambiguity", () => {
  const adapter = new NewApiProviderAdapter(clientFor(bundle()));
  const auth = adapter.createAuthorization();
  const next = adapter.createAuthorization();
  const url = new URL(auth.authorizeUrl);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, "/api/xcode/v1/auth/authorize");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(auth.codeVerifier).digest("base64url"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), auth.state);
  assert.equal(url.searchParams.get("redirect_uri"), "zcode://oauth/callback");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["client_id", "code_challenge", "code_challenge_method", "redirect_uri", "response_type", "state"]);
  assert.notEqual(auth.state, next.state);
  assert.notEqual(auth.codeVerifier, next.codeVerifier);
  const callback = `zcode://oauth/callback?provider=new-api&state=${auth.state}&code=${code}`;
  assert.deepEqual(adapter.parseCallback(callback), { state: auth.state, code });
  for (const bad of [callback.replace("oauth/", "other/"), callback.replace("/callback", "/%63allback"), callback.replace("new-api", "zai"),
    `${callback}&state=second`, `${callback}&purpose=official-cloud`, `${callback}&authCode=alias`, `${callback}#fragment`,
    callback.replace("zcode://", "zcode://user@"), callback.replace(`code=${code}`, "code="),
  ]) assert.throws(() => adapter.parseCallback(bad));
});

test("origin normalization rejects non-loopback HTTP and URL parser loopback aliases", () => {
  assert.equal(normalizeNewApiOrigin("https://PRIVATE.example:443/"), origin);
  for (const valid of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001"]) assert.equal(normalizeNewApiOrigin(valid), valid);
  for (const bad of ["http://private.example", "http://127.1", "http://2130706433", "http://0x7f000001", "http://localhost.evil", "https://user@private.example", `${origin}/api`, `${origin}?`, `${origin}#`]) assert.throws(() => normalizeNewApiOrigin(bad));
});

test("catalog keeps structurally valid model metadata with bad CEL for per-model issue projection", async () => {
  const catalog = await clientFor({ schema_version: 1, server_time: now, catalog_revision: "sha256:content-digest", authorization_revision: "1",
    models: [{ model_id: "native-model", display_name: "Native", api_type: "openai-responses", enabled: true, disabled_reason: null,
      model_config: { enabled: true, properties: { requiresMfjsToolSchema: false, contextWindow: 1000,
        inputFormat: { supportsText: true, supportsImage: false, supportsVideo: false, supportsAudio: false, supportsPdf: false }, outputFormat: { supportsText: true },
        supportsToolCall: false, supportsJsonSchemaOutput: false, supportsNativeWebSearch: false, supportsMidConversationSystem: true },
        optionSpecs: { reasoningLevel: { values: ["off"], map: "invalid CEL (" }, maxOutputTokens: { max: 100, map: "{}" } } } },
      { model_id: "unconfigured", display_name: "Unconfigured", api_type: null, enabled: false, disabled_reason: "model_metadata_missing", model_config: null }],
  }).getModels("control");
  assert.equal(catalog.catalog_revision, "sha256:content-digest");
  assert.equal(catalog.models[0]?.model_config?.optionSpecs.reasoningLevel.map, "invalid CEL (");
  assert.equal(catalog.models[1]?.api_type, null);
});
