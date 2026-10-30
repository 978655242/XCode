import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { Socket, createServer as createTcpServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const root = process.env.AISCOO_INTEGRATION_ROOT;
assert.ok(root && process.env.HOME === join(root, "home"));
for (const name of [
  "ZCODE_DATA_BASE_DIR",
  "ZCODE_STORAGE_DIR",
  "ZCODE_SESSION_DB_PATH",
  "ZCODE_LOG_DIR",
]) {
  assert.ok(process.env[name]?.startsWith(`${root}/`), `${name} must be inside the temporary root`);
}

// Fail closed before importing the Host: even unexpected background sockets cannot reach a real service.
const allowedPorts = new Set();
const originalConnect = Socket.prototype.connect;
Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === "object" ? first : { port: first, host: args[1] };
  if (options?.port !== undefined) {
    const port = Number(options.port);
    const host = options.host ?? options.hostname ?? "localhost";
    if (
      !["127.0.0.1", "localhost", "::1"].includes(host) ||
      port === 3001 ||
      !allowedPorts.has(port)
    ) {
      throw new Error("Integration network guard rejected a connection");
    }
  } else if (typeof options?.path !== "string" || !options.path.startsWith(`${root}/`)) {
    throw new Error("Integration network guard rejected a socket path");
  }
  return originalConnect.apply(this, args);
};
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    !allowedPorts.has(Number(url.port)) ||
    Number(url.port) === 3001
  ) {
    return Promise.reject(new Error("Integration network guard rejected a fetch"));
  }
  return realFetch(input, init);
};

const {
  createCredentialService,
  createLocalWebNewApiAccountFactory,
  createServerHostServices,
  disposeServiceResourcesAndWait,
  getProviderProvisioningSource,
} = await import("@zcode/services/node");
const { createCredentialCipherProvider } =
  await import("../../../services/src/credential/providers/credentialCipherProvider.ts");
const { connectViaWebSocket } = await import("@zcode/client");
const { createHttpServer: createApplicationServer } = await import("../../src/http.ts");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string" && address.address === "127.0.0.1");
  assert.notEqual(address.port, 3001);
  allowedPorts.add(address.port);
  return address.port;
}
async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
}
async function reservePort() {
  const server = createTcpServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}
function bundle(refreshToken = "synthetic-refresh-1") {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const expires = now + 60_000;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "new-api",
      aud: ["new-api-xcode"],
      token_use: "xcode_access",
      sub: "1",
      sid: "synthetic-session",
      exp: expires / 1000,
      uv: 1,
      sv: 1,
      nbf: now / 1000 - 1,
      iat: now / 1000,
      scopes: ["profile:read", "wallet:read", "usage:read"],
      jti: randomUUID(),
    }),
  ).toString("base64url");
  return {
    schema_version: 1,
    server_time: now,
    access_token: `${header}.${payload}.${Buffer.alloc(32, 1).toString("base64url")}`,
    access_expires_at: expires,
    refresh_token: refreshToken,
    refresh_expires_at: now + 600_000,
    token_type: "Bearer",
    session_id: "synthetic-session",
    user: { id: "1", username: "synthetic-user", display_name: "Synthetic User", avatar_url: null },
    relay_credential: { token: "sk-synthetic-relay", expires_at: now + 600_000 },
  };
}
function reply(response, data, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

let expectedAuthorization;
let currentBundle = bundle();
const backendCalls = [];
const backendErrors = [];
const backend = createHttpServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    backendCalls.push({ path, body });
    if (path === "/api/xcode/v1/auth/token") {
      assert.equal(request.method, "POST");
      assert.equal(body.client_id, "xwork-cli");
      assert.equal(body.redirect_uri, expectedAuthorization.redirect);
      assert.equal(body.code, "c".repeat(43));
      assert.equal(
        createHash("sha256").update(body.code_verifier).digest("base64url"),
        expectedAuthorization.challenge,
      );
      reply(response, { success: true, data: currentBundle });
    } else if (path === "/api/xcode/v1/me") {
      assert.equal(request.headers.authorization, `Bearer ${currentBundle.access_token}`);
      reply(response, {
        success: true,
        data: {
          schema_version: 1,
          server_time: Date.now(),
          session_id: currentBundle.session_id,
          user: currentBundle.user,
          authorization_revision: "0",
        },
      });
    } else if (path === "/api/xcode/v1/auth/refresh") {
      assert.equal(body.client_id, "xwork-cli");
      assert.equal(body.refresh_token, currentBundle.refresh_token);
      currentBundle = bundle("synthetic-refresh-2");
      reply(response, { success: true, data: currentBundle });
    } else if (path === "/api/xcode/v1/auth/logout") {
      assert.equal(body.client_id, "xwork-cli");
      assert.equal(body.refresh_token, currentBundle.refresh_token);
      reply(response, {
        success: true,
        data: { schema_version: 1, server_time: Date.now(), revoked: true },
      });
    } else {
      // Model/entitlement projections are deliberately unavailable; no model request is made.
      reply(
        response,
        {
          success: false,
          code: "XCODE_BACKEND_UNAVAILABLE",
          message: "Synthetic backend",
          request_id: "synthetic",
        },
        503,
      );
    }
  } catch (error) {
    backendErrors.push(error);
    reply(
      response,
      {
        success: false,
        code: "XCODE_BACKEND_UNAVAILABLE",
        message: "Synthetic backend assertion",
        request_id: "synthetic",
      },
      503,
    );
  }
});

let key = null;
const keyStore = {
  async read() {
    return key;
  },
  async write(value) {
    key = value;
  },
};
let factory;
let host;
let app;
let socket;
let subscription;
const uiPort = await reservePort();
const uiOrigin = `http://127.0.0.1:${uiPort}`;
const uiHost = new URL(uiOrigin).host;
const backendPort = await listen(backend);
const backendOrigin = `http://127.0.0.1:${backendPort}`;
const webDirectory = join(process.env.HOME, ".zcode", "v2");
const desktopSentinel = join(webDirectory, "credentials.json");
const cliSentinel = join(process.env.HOME, ".zcode", "cli", "zen", "sentinel.json");
await mkdir(join(process.env.HOME, ".zcode", "cli", "zen"), { recursive: true });
await mkdir(webDirectory, { recursive: true });
const desktopCredentials = createCredentialService();
await desktopCredentials.save("oauth:active_provider", "bigmodel");
await desktopCredentials.save("oauth:bigmodel:access_token", "desktop-synthetic-oauth-token");
await desktopCredentials.save("oauth:bigmodel:refresh_token", "desktop-synthetic-refresh-token");
const originalDesktopFile = await readFile(desktopSentinel, "utf8");
await writeFile(cliSentinel, "cli-synthetic-sentinel");

async function startHost() {
  factory = await createLocalWebNewApiAccountFactory({
    origin: backendOrigin,
    dataDirectory: webDirectory,
    keyStore,
  });
  host = await createServerHostServices({
    sourceServerId: "synthetic-local-web-owner",
    zcodeBuiltinProviderConfigFilePath: resolve("config/provider/zcode-builtin.json"),
    newApiAccountFactory: factory,
  });
  app = createApplicationServer(host.services, 0, {
    host: "127.0.0.1",
    localWeb: { allowedOrigins: [uiOrigin] },
    workspaceIdentityMapper: host.workspaceIdentityMapper,
  });
  if (!app.listening) await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string" && address.address === "127.0.0.1");
  assert.notEqual(address.port, 3001);
  allowedPorts.add(address.port);
  return address.port;
}
async function stopHost() {
  subscription?.dispose();
  subscription = undefined;
  if (socket && socket.readyState < WebSocket.CLOSING) {
    const closed = once(socket, "close");
    socket.close();
    await closed;
  }
  socket = undefined;
  await closeServer(app);
  app = undefined;
  await factory?.dispose();
  factory = undefined;
  if (host) await disposeServiceResourcesAndWait(host.services);
  host = undefined;
}
async function requestApp(port, path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolveResult, reject) => {
    const request = httpRequest(
      { hostname: "127.0.0.1", port, path, method, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () =>
          resolveResult(Object.assign(response, { body: Buffer.concat(chunks).toString("utf8") })),
        );
        response.once("error", reject);
      },
    );
    request.once("error", reject);
    request.end();
  });
}
async function bootstrap(port) {
  const response = await requestApp(port, "/api/local-web/session", {
    method: "POST",
    headers: {
      host: uiHost,
      origin: uiOrigin,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["set-cookie"], undefined);
  const { token } = JSON.parse(response.body);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  return token;
}
async function openRpc(port, token) {
  const headers = { host: uiHost, origin: uiOrigin, "sec-fetch-site": "same-origin" };
  class BrowserWebSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers });
    }
  }
  globalThis.WebSocket = BrowserWebSocket;
  const services = await connectViaWebSocket(`ws://127.0.0.1:${port}/ws`, {
    protocols: ["aiscoo-local-web-v1", `aiscoo-local-web-token.${token}`],
    onOpenSocket(value) {
      socket = value;
    },
  });
  return services;
}
async function refusedWebSocket(port, headers, path = "/ws") {
  return new Promise((resolveResult, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers, handshakeTimeout: 5_000 });
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      response.once("end", () => resolveResult(response.statusCode));
      response.once("error", reject);
    });
    ws.once("open", () => {
      ws.close();
      reject(new Error("Unexpected WebSocket upgrade"));
    });
    ws.once("error", reject);
  });
}
function expectEvent(oauth, wanted) {
  let resolveEvent;
  const observed = new Promise((done) => {
    resolveEvent = done;
  });
  subscription = oauth.onDidChangeSession((event) => {
    if (event === wanted) resolveEvent();
  });
  return observed;
}
async function within(promise, label) {
  return Promise.race([
    promise,
    delay(15_000).then(() => {
      throw new Error(`Timed out waiting for ${label}`);
    }),
  ]);
}

try {
  let port = await startHost();
  assert.equal(
    (await requestApp(port, "/api/server-info", { headers: { host: uiHost } })).statusCode,
    401,
  );
  assert.equal(
    (
      await requestApp(port, "/api/local-web/session", {
        method: "POST",
        headers: {
          host: uiHost,
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
      })
    ).statusCode,
    403,
  );
  const token = await bootstrap(port);
  assert.equal(
    await refusedWebSocket(port, {
      host: uiHost,
      origin: "https://attacker.example",
      "sec-websocket-protocol": `aiscoo-local-web-v1, aiscoo-local-web-token.${token}`,
    }),
    403,
  );
  assert.equal(await refusedWebSocket(port, { host: uiHost, origin: uiOrigin }), 401);

  let services = await openRpc(port, token);
  let { oauthService: oauth, credentialService: credentials } = services;
  for (const name of [
    "oauth:active_provider",
    "oauth:bigmodel:access_token",
    "oauth:bigmodel:refresh_token",
  ]) {
    assert.equal(await credentials.load(name), null, `signed-out Web read desktop key ${name}`);
    await credentials.delete(name);
  }
  await credentials.save("oauth:bigmodel:access_token", "web-synthetic-oauth-token");
  assert.equal(await credentials.load("oauth:bigmodel:access_token"), "web-synthetic-oauth-token");
  await credentials.delete("oauth:bigmodel:access_token");
  assert.equal(await credentials.load("oauth:bigmodel:access_token"), null);
  await credentials.save("custom-provider:synthetic:api-key", "web-synthetic-custom-secret");
  await credentials.save("oauth:bigmodel:access_token", "web-synthetic-oauth-token");
  assert.equal(await readFile(desktopSentinel, "utf8"), originalDesktopFile);
  assert.deepEqual(
    (await getProviderProvisioningSource(host.services).read("synthetic")).credentials,
    [
      {
        scope: "oauth-session",
        key: "oauth:bigmodel:access_token",
        value: "web-synthetic-oauth-token",
      },
    ],
  );
  await credentials.delete("oauth:bigmodel:access_token");
  for (const name of ["new-api:synthetic", "official-cloud:synthetic"]) {
    for (const operation of [
      () => credentials.load(name),
      () => credentials.save(name, "synthetic"),
      () => credentials.delete(name),
    ])
      await assert.rejects(operation());
  }
  assert.deepEqual(
    (await within(oauth.getProviders(), "provider list")).map((provider) => provider.id),
    ["new-api"],
  );
  assert.deepEqual(await oauth.getLocalWebAuthorizationCapabilities(), { failureEvents: true });
  assert.equal(await oauth.getActiveProvider(), null);
  assert.equal((await oauth.restoreCachedSessionState()).status, "signed-out");
  const signedIn = expectEvent(oauth, "signed-in");
  // RPC ordering guarantees the event subscription has reached the real server before login starts.
  await oauth.getActiveProvider();
  const start = await oauth.startOAuth("new-api");
  const authorize = new URL(start.authorizeUrl);
  assert.equal(authorize.origin, backendOrigin);
  assert.equal(authorize.pathname, "/api/xcode/v1/auth/authorize");
  assert.equal(authorize.searchParams.get("client_id"), "xwork-cli");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("state"), start.state);
  const redirect = authorize.searchParams.get("redirect_uri");
  const callback = new URL(redirect);
  assert.equal(callback.hostname, "127.0.0.1");
  assert.equal(callback.pathname, "/oauth/callback");
  assert.notEqual(Number(callback.port), 3001);
  allowedPorts.add(Number(callback.port));
  expectedAuthorization = { redirect, challenge: authorize.searchParams.get("code_challenge") };
  callback.search = new URLSearchParams({
    provider: "new-api",
    state: "wrong-state",
    code: "c".repeat(43),
  });
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(backendCalls.filter((call) => call.path.endsWith("/auth/token")).length, 0);
  callback.search = new URLSearchParams({
    provider: "new-api",
    state: start.state,
    code: "c".repeat(43),
  });
  assert.equal(await oauth.handleCallback(callback.href), null);
  const callbackResponse = await fetch(callback);
  assert.equal(callbackResponse.status, 200);
  assert.match(callbackResponse.headers.get("cache-control"), /no-store/);
  assert.match(callbackResponse.headers.get("referrer-policy"), /no-referrer/);
  assert.doesNotMatch(await callbackResponse.text(), /cccccccc/);
  await within(signedIn, "signed-in RPC event");
  assert.equal(await oauth.getActiveProvider(), "new-api");
  assert.equal(await credentials.load("oauth:bigmodel:refresh_token"), null);
  await credentials.save("oauth:bigmodel:refresh_token", "web-synthetic-refresh-token");
  assert.equal(
    await credentials.load("oauth:bigmodel:refresh_token"),
    "web-synthetic-refresh-token",
  );
  await credentials.delete("oauth:bigmodel:refresh_token");
  assert.equal(await credentials.load("oauth:bigmodel:refresh_token"), null);
  assert.equal(await readFile(desktopSentinel, "utf8"), originalDesktopFile);
  const restored = await oauth.restoreCachedSessionState();
  assert.equal(restored.status, "authenticated");
  assert.equal(restored.userInfo.username, "synthetic-user");
  assert.ok(backendCalls.some((call) => call.path.endsWith("/me")));
  await oauth.refreshToken("new-api");
  assert.ok(backendCalls.some((call) => call.path.endsWith("/auth/refresh")));
  const encrypted = await readFile(
    join(webDirectory, "local-web", "new-api", "credentials.json"),
    "utf8",
  );
  assert.doesNotMatch(
    encrypted,
    /synthetic-refresh|sk-synthetic-relay|web-synthetic-custom-secret/,
  );
  const storedCredentials = JSON.parse(encrypted);
  assert.match(storedCredentials["custom-provider:synthetic:api-key"], /^enc:v1:/);
  const desktopCipher = createCredentialCipherProvider();
  assert.throws(() =>
    desktopCipher.decrypt(storedCredentials["custom-provider:synthetic:api-key"]),
  );
  assert.equal(await readFile(desktopSentinel, "utf8"), originalDesktopFile);
  assert.equal(await readFile(cliSentinel, "utf8"), "cli-synthetic-sentinel");

  await stopHost();
  port = await startHost();
  assert.equal(
    (
      await requestApp(port, "/api/server-info", {
        headers: { host: uiHost, "x-aiscoo-local-web-token": token },
      })
    ).statusCode,
    401,
  );
  services = await openRpc(port, await bootstrap(port));
  ({ oauthService: oauth, credentialService: credentials } = services);
  assert.equal(
    await credentials.load("custom-provider:synthetic:api-key"),
    "web-synthetic-custom-secret",
  );
  assert.equal(await credentials.load("oauth:bigmodel:access_token"), null);
  assert.deepEqual(
    (await oauth.getProviders()).map((provider) => provider.id),
    ["new-api"],
  );
  assert.equal(await oauth.getActiveProvider(), null);
  const coldRestore = await oauth.restoreCachedSessionState();
  assert.equal(coldRestore.status, "authenticated");
  assert.equal(coldRestore.userInfo.username, "synthetic-user");
  assert.equal(await oauth.getActiveProvider(), "new-api");
  await oauth.logout("new-api");
  assert.equal(await oauth.getActiveProvider(), null);
  assert.equal((await oauth.restoreCachedSessionState()).status, "signed-out");
  assert.ok(backendCalls.some((call) => call.path.endsWith("/auth/logout")));
  await credentials.delete("custom-provider:synthetic:api-key");
  assert.equal(await credentials.load("custom-provider:synthetic:api-key"), null);
  assert.equal(await readFile(desktopSentinel, "utf8"), originalDesktopFile);
  assert.equal(await readFile(cliSentinel, "utf8"), "cli-synthetic-sentinel");
  assert.deepEqual(backendErrors, []);

  process.stdout.write("AISCOO_LOCAL_WEB_RPC_VERIFIED\n");
} finally {
  await stopHost();
  await closeServer(backend);
}
// Some Host components have process-lifetime timers; terminate only this isolated fixture process.
process.exit(0);
