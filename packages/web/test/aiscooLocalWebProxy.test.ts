import { once } from "node:events";
import { createServer as createHttpServer, request, type Server } from "node:http";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import { createHttpServer as createLocalServer } from "../../server/src/index.js";
import { ServiceCollection } from "../../services/src/index.js";

const webRoot = resolve(import.meta.dirname, "..");

type Observation = {
  path: string | undefined;
  host: string | undefined;
  origin: string | undefined;
};

function serverPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind a TCP port");
  return address.port;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail);
      done();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((done, fail) => server.close((error) => (error ? fail(error) : done())));
}

function http(port: number, path: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<{ status: number; cookie: string | undefined; body: string }>((done, fail) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () =>
        done({ status: res.statusCode ?? 0, cookie: res.headers["set-cookie"]?.[0], body }),
      );
      res.on("error", fail);
    });
    req.on("error", fail);
    req.end();
  });
}

function websocket(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((done, fail) => {
    const { "sec-websocket-protocol": protocolHeader, ...rest } = headers;
    const protocols = protocolHeader?.split(",").map((value) => value.trim());
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols, { headers: rest });
    ws.on("unexpected-response", (_req, res) => {
      const status = res.statusCode ?? 0;
      res.resume();
      res.on("end", () => done(status));
      res.on("error", fail);
    });
    ws.on("error", fail);
    ws.on("open", () => {
      ws.on("close", () => done(101));
      ws.close();
    });
  });
}

describe("Aiscoo local Web Vite proxy boundary", () => {
  let vite: ViteDevServer | undefined;
  let frontend: Server | undefined;
  let local: Server | undefined;
  let upstream: Server | undefined;
  let upstreamSockets: WebSocketServer | undefined;

  afterEach(async () => {
    await vite?.close();
    if (frontend?.listening) await close(frontend);
    if (local?.listening) await close(local);
    if (upstream?.listening) await close(upstream);
    upstreamSockets?.close();
    vite = undefined;
    frontend = undefined;
    local = undefined;
    upstream = undefined;
    upstreamSockets = undefined;
    vi.unstubAllEnvs();
  });

  async function start(localProfile: boolean) {
    const upstreamRequests: Observation[] = [];
    upstream = createHttpServer((req, res) => {
      upstreamRequests.push({ path: req.url, host: req.headers.host, origin: req.headers.origin });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("simulated upstream");
    });
    upstreamSockets = new WebSocketServer({ noServer: true });
    upstream.on("upgrade", (req, socket, head) => {
      upstreamRequests.push({ path: req.url, host: req.headers.host, origin: req.headers.origin });
      upstreamSockets!.handleUpgrade(req, socket, head, (ws) => ws.close());
    });
    await listen(upstream);

    frontend = createHttpServer();
    await listen(frontend);
    const frontendPort = serverPort(frontend);
    const origin = `http://127.0.0.1:${frontendPort}`;
    local = createLocalServer(new ServiceCollection(), 0, {
      host: "127.0.0.1",
      localWeb: { allowedOrigins: [origin] },
    });
    if (!local.listening) await once(local, "listening");

    vi.stubEnv("VITE_AISCOO_LOCAL_WEB", localProfile ? "1" : "0");
    vi.stubEnv("AISCOO_LOCAL_WEB_SERVER_PORT", String(serverPort(local)));
    vi.stubEnv("ZCODE_BASE_URL", `http://127.0.0.1:${serverPort(upstream)}`);
    vi.stubEnv("WEB_REMOTE_FRONTEND_VERSION", "");
    vite = await createServer({
      root: webRoot,
      configFile: resolve(webRoot, "vite.config.ts"),
      logLevel: "silent",
      server: { middlewareMode: { server: frontend }, hmr: false, watch: { ignored: ["**/*"] } },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    frontend.on("request", vite.middlewares);
    return {
      frontendPort,
      origin,
      host: `127.0.0.1:${frontendPort}`,
      upstreamHost: `127.0.0.1:${serverPort(upstream)}`,
      upstreamRequests,
    };
  }

  it.each([
    ["POST", "/api/v1/oauth/token"],
    ["POST", "/api/v1/oauth/token/extra?probe=1"],
    ["GET", "/api/v1/remote"],
    ["GET", "/api/v1/remote/devices?probe=1"],
    ["GET", "/api/server-info"],
  ])("local profile sends %s %s through the real session boundary", async (method, path) => {
    const { frontendPort, origin, upstreamRequests } = await start(true);
    const response = await http(frontendPort, path, { origin }, method);
    expect(response.status).toBe(401);
    expect(upstreamRequests).toEqual([]);
  });

  it.each([
    ["POST", "/api/v1/oauth/token"],
    ["GET", "/api/v1/remote/devices"],
  ])("local profile keeps authenticated %s %s inside the local Server", async (method, path) => {
    const { frontendPort, origin, upstreamRequests } = await start(true);
    const session = await http(frontendPort, "/api/local-web/session", { origin }, "POST");
    expect(session.status).toBe(200);
    expect(session.cookie).toBeUndefined();
    const token = (JSON.parse(session.body) as { token: string }).token;
    expect(
      (await http(frontendPort, path, { origin, "x-aiscoo-local-web-token": token }, method))
        .status,
    ).toBe(404);
    expect(upstreamRequests).toEqual([]);
  });

  it("retains browser Host and Origin for local session bootstrap and authenticated HTTP", async () => {
    const { frontendPort, origin, host, upstreamRequests } = await start(true);
    const session = await http(frontendPort, "/api/local-web/session", { origin }, "POST");
    expect(session.status).toBe(200);
    expect(session.cookie).toBeUndefined();
    const token = (JSON.parse(session.body) as { token: string }).token;
    const auth = { "x-aiscoo-local-web-token": token };
    const info = await http(frontendPort, "/api/server-info", { host, origin, ...auth });
    expect(info.status).toBe(200);
    const wrongOrigin = await http(frontendPort, "/api/server-info", {
      host,
      origin: "http://attacker.example",
      ...auth,
    });
    expect(wrongOrigin.status).toBe(403);
    const wrongHost = await http(frontendPort, "/api/server-info", {
      host: "attacker.example",
      origin,
      ...auth,
    });
    expect(wrongHost.status).toBe(403);
    expect(upstreamRequests).toEqual([]);
  });

  it.each(["/ws", "/api/v1/remote/devices"])(
    "local profile protects WebSocket upgrade %s",
    async (path) => {
      const { frontendPort, origin, upstreamRequests } = await start(true);
      expect(await websocket(frontendPort, path, { origin })).toBe(401);
      expect(upstreamRequests).toEqual([]);
    },
  );

  it("allows a same-origin authenticated local WebSocket but rejects other origins", async () => {
    const { frontendPort, origin, host, upstreamRequests } = await start(true);
    const session = await http(frontendPort, "/api/local-web/session", { origin }, "POST");
    expect(session.status).toBe(200);
    const token = (JSON.parse(session.body) as { token: string }).token;
    const auth = {
      "sec-websocket-protocol": `aiscoo-local-web-v1, aiscoo-local-web-token.${token}`,
    };
    expect(await websocket(frontendPort, "/ws", { host, origin, ...auth })).toBe(101);
    expect(
      await websocket(frontendPort, "/ws", { host, origin: "http://attacker.example", ...auth }),
    ).toBe(403);
    expect(upstreamRequests).toEqual([]);
  });

  it("ordinary profile keeps the dedicated HTTP and WebSocket upstream proxies", async () => {
    const { frontendPort, origin, upstreamHost, upstreamRequests } = await start(false);
    const token = await http(frontendPort, "/api/v1/oauth/token", { origin }, "POST");
    expect(token).toMatchObject({ status: 200, body: "simulated upstream" });
    const remote = await http(frontendPort, "/api/v1/remote/devices", { origin });
    expect(remote).toMatchObject({ status: 200, body: "simulated upstream" });
    expect(await websocket(frontendPort, "/api/v1/remote/stream", { origin })).toBe(101);
    expect(upstreamRequests).toEqual([
      { path: "/api/v1/oauth/token", host: upstreamHost, origin },
      { path: "/api/v1/remote/devices", host: upstreamHost, origin },
      { path: "/api/v1/remote/stream", host: upstreamHost, origin },
    ]);
  });
});
