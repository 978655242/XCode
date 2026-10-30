import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ServiceCollection } from "@zcode/services";
import { ZCODE_RPC_HOST_CAPABILITY_HEADER } from "@zcode/shared";
import { createHttpServer } from "../src/http.js";

const uiOrigin = "http://127.0.0.1:5173";
const productionOrigin = "http://127.0.0.1:3030";
const uiHost = "127.0.0.1:5173";
const browserHeaders = {
  host: uiHost,
  origin: uiOrigin,
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
};

describe("Aiscoo local Web HTTP and WebSocket boundary", () => {
  const servers: Server[] = [];
  const tempDirs: string[] = [];

  async function startServer(
    options: Record<string, unknown> = {},
    services = new ServiceCollection(),
  ) {
    const server = createHttpServer(services, 0, {
      host: "127.0.0.1",
      localWeb: { allowedOrigins: [uiOrigin, productionOrigin] },
      ...options,
    });
    servers.push(server);
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No TCP address");
    return address.port;
  }

  async function http(
    port: number,
    path: string,
    options: { method?: string; headers?: Record<string, string>; noHost?: boolean } = {},
  ): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: options.method ?? "GET",
          setHost: !options.noHost,
          headers: options.headers,
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  async function session(port: number, headers: Record<string, string> = browserHeaders) {
    return http(port, "/api/local-web/session", { method: "POST", headers });
  }

  async function tokenFor(port: number): Promise<string> {
    const response = await session(port);
    expect(response.status).toBe(200);
    return (JSON.parse(response.body) as { token: string }).token;
  }

  const tokenHeaders = (token: string) => ({ "x-aiscoo-local-web-token": token });
  const wsHeadersFor = (token: string) => ({
    "sec-websocket-protocol": `aiscoo-local-web-v1, aiscoo-local-web-token.${token}`,
  });

  async function websocket(
    port: number,
    path: string,
    headers: Record<string, string>,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const { "sec-websocket-protocol": protocolHeader, ...rest } = headers;
      const protocols = protocolHeader?.split(",").map((value) => value.trim());
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols, { headers: rest });
      ws.on("unexpected-response", (_req, res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        res.on("end", () => resolve(status));
        res.on("error", reject);
      });
      ws.on("error", reject);
      ws.on("open", () => {
        ws.on("close", () => resolve(101));
        ws.close();
      });
    });
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("issues a short-lived, high-entropy memory token for a trusted POST", async () => {
    const port = await startServer();
    const response = await session(port);
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["cache-control"]).toContain("no-store");
    expect((JSON.parse(response.body) as { token: string }).token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each([
    ["missing Origin", { host: uiHost }],
    ["null Origin", { host: uiHost, origin: "null" }],
    ["external Origin", { host: uiHost, origin: "https://evil.example" }],
    ["wrong port Origin", { host: uiHost, origin: "http://127.0.0.1:5174" }],
    ["Origin that is allowed but does not match Host", { host: uiHost, origin: productionOrigin }],
    ["external Host", { host: "evil.example:5173", origin: uiOrigin }],
    ["DNS rebinding Host", { host: "evil.localhost:5173", origin: uiOrigin }],
    ["wrong Host port", { host: "127.0.0.1:5174", origin: uiOrigin }],
    ["cross-site fetch", { ...browserHeaders, "sec-fetch-site": "cross-site" }],
    ["same-site but different origin fetch", { ...browserHeaders, "sec-fetch-site": "same-site" }],
    ["no-cors fetch", { ...browserHeaders, "sec-fetch-mode": "no-cors" }],
    ["document destination", { ...browserHeaders, "sec-fetch-dest": "document" }],
  ])("rejects session bootstrap with %s", async (_description, headers) => {
    const port = await startServer();
    const response = await session(port, headers);
    expect(response.status).toBe(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects session bootstrap without Host and does not trust forwarded host headers", async () => {
    const port = await startServer();
    const missing = await http(port, "/api/local-web/session", {
      method: "POST",
      noHost: true,
      headers: { origin: uiOrigin, "x-forwarded-host": uiHost },
    });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.headers["set-cookie"]).toBeUndefined();
    const forwarded = await session(port, {
      host: "evil.example:5173",
      origin: uiOrigin,
      "x-forwarded-host": uiHost,
    });
    expect(forwarded.status).toBe(403);
  });

  it("accepts an explicit same-origin production page and allows browsers without fetch metadata", async () => {
    const port = await startServer();
    const response = await session(port, { host: "127.0.0.1:3030", origin: productionOrigin });
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect((JSON.parse(response.body) as { token: string }).token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("allows public static GET only with a trusted Host and safe fetch metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiscoo-local-web-static-"));
    tempDirs.push(root);
    await writeFile(join(root, "index.html"), "<html>local</html>");
    const port = await startServer({ staticRoot: root });
    expect(
      (await http(port, "/", { headers: { host: uiHost, "sec-fetch-site": "none" } })).status,
    ).toBe(200);
    expect(
      (await http(port, "/", { headers: { host: "attacker.example", origin: uiOrigin } })).status,
    ).toBe(403);
    expect(
      (await http(port, "/", { headers: { host: uiHost, origin: "https://evil.example" } })).status,
    ).toBe(403);
    expect(
      (await http(port, "/", { headers: { host: uiHost, "sec-fetch-site": "cross-site" } })).status,
    ).toBe(403);
  });

  it("requires the local cookie for APIs, and never accepts a query token or bearer token as a substitute", async () => {
    const port = await startServer();
    const headers = { host: uiHost };
    expect((await http(port, "/api/server-info", { headers })).status).toBe(401);
    expect((await http(port, "/api/server-info?token=anything", { headers })).status).toBe(401);
    expect((await http(port, "/%61pi/server-info", { headers })).status).toBe(401);
    expect((await http(port, "/api%2fserver-info", { headers })).status).toBe(403);
    expect((await http(port, "/api%5cserver-info", { headers })).status).toBe(403);
    expect(
      (
        await http(port, "/api/server-info", {
          headers: { ...headers, authorization: "Bearer anything" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await http(port, "/api/server-info", {
          headers: { ...headers, cookie: "aiscoo_local_web=forged" },
        })
      ).status,
    ).toBe(401);
    const token = await tokenFor(port);
    expect(
      (await http(port, "/api/server-info", { headers: { ...headers, ...tokenHeaders(token) } }))
        .status,
    ).toBe(200);
    expect(
      (
        await http(port, "/api/server-info", {
          headers: { ...headers, cookie: `aiscoo_local_web=${token}` },
        })
      ).status,
    ).toBe(401);
  });

  it("checks Origin and fetch metadata even when the cookie is valid", async () => {
    const port = await startServer();
    const token = await tokenFor(port);
    const headers = { host: uiHost, ...tokenHeaders(token) };
    expect(
      (
        await http(port, "/api/server-info", {
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await http(port, "/api/server-info", {
          headers: { ...headers, "sec-fetch-site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    expect((await http(port, "/api/rpc-host-capability", { method: "POST", headers })).status).toBe(
      403,
    );
    expect(
      (
        await http(port, "/api/rpc-host-capability", {
          method: "POST",
          headers: { ...browserHeaders, ...tokenHeaders(token) },
        })
      ).status,
    ).toBe(200);
  });

  it("rejects cross-site, missing-Origin and unauthenticated WebSockets before upgrading, and permits reconnect", async () => {
    const port = await startServer();
    const token = await tokenFor(port);
    const wsHeaders = {
      host: uiHost,
      origin: uiOrigin,
      "sec-fetch-site": "same-origin",
      ...wsHeadersFor(token),
    };
    expect(await websocket(port, "/ws", { ...wsHeaders, origin: "https://evil.example" })).toBe(
      403,
    );
    expect(await websocket(port, "/ws", { host: uiHost, ...wsHeadersFor(token) })).toBe(403);
    expect(await websocket(port, "/ws", { ...wsHeaders, host: "evil.localhost:5173" })).toBe(403);
    expect(await websocket(port, "/ws", { ...wsHeaders, "sec-fetch-site": "cross-site" })).toBe(
      403,
    );
    expect(await websocket(port, "/ws?token=anything", { host: uiHost, origin: uiOrigin })).toBe(
      401,
    );
    expect(await websocket(port, "/%77s", { host: uiHost, origin: uiOrigin })).toBe(401);
    expect(await websocket(port, "/ws", wsHeaders)).toBe(101);
    expect(await websocket(port, "/ws", wsHeaders)).toBe(101);
  });

  it("expires old tokens, renews them through bootstrap, and invalidates them after server restart", async () => {
    const port = await startServer();
    const token = await tokenFor(port);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 24 * 60 * 60 * 1000);
    expect(
      (await http(port, "/api/server-info", { headers: { host: uiHost, ...tokenHeaders(token) } }))
        .status,
    ).toBe(401);
    const renewed = await tokenFor(port);
    expect(renewed).not.toBe(token);
    expect(
      (
        await http(port, "/api/server-info", {
          headers: { host: uiHost, ...tokenHeaders(renewed) },
        })
      ).status,
    ).toBe(200);
    vi.restoreAllMocks();
    const secondPort = await startServer();
    expect(
      (
        await http(secondPort, "/api/server-info", {
          headers: { host: uiHost, ...tokenHeaders(renewed) },
        })
      ).status,
    ).toBe(401);
  });

  it.each([
    ["missing listen host", { host: undefined }],
    ["IPv4 wildcard", { host: "0.0.0.0" }],
    ["IPv6 wildcard", { host: "::" }],
    ["hostname instead of explicit loopback bind", { host: "localhost" }],
    ["empty origins", { localWeb: { allowedOrigins: [] } }],
    ["external origin", { localWeb: { allowedOrigins: ["http://evil.example:5173"] } }],
    ["origin without port", { localWeb: { allowedOrigins: ["http://localhost"] } }],
    ["origin with path", { localWeb: { allowedOrigins: ["http://localhost:5173/path"] } }],
    ["legacy token enabled", { authToken: "old-token" }],
  ])("fails closed when configured with %s", (_description, options) => {
    expect(() => {
      const server = createHttpServer(new ServiceCollection(), 0, {
        host: "127.0.0.1",
        localWeb: { allowedOrigins: [uiOrigin] },
        ...options,
      });
      servers.push(server);
    }).toThrow();
  });

  it("uses an explicit memory token and does not issue a cross-port cookie", async () => {
    const port = await startServer();
    const response = await session(port);
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["cache-control"]).toContain("no-store");
    const { token } = JSON.parse(response.body) as { token: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      (
        await http(port, "/api/server-info", {
          headers: { host: uiHost, "x-aiscoo-local-web-token": token },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await http(port, "/api/server-info", {
          headers: { host: uiHost, cookie: `aiscoo_local_web=${token}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await http(port, "/api/server-info", {
          headers: {
            host: uiHost,
            origin: "http://other.example",
            "x-aiscoo-local-web-token": token,
          },
        })
      ).status,
    ).toBe(403);
  });

  it("selects only a non-secret protocol and closes a live WebSocket at expiry", async () => {
    const port = await startServer();
    const response = await session(port);
    const { token } = JSON.parse(response.body) as { token: string };
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 60 * 60 * 1000 - 150);
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws`,
      ["aiscoo-local-web-v1", `aiscoo-local-web-token.${token}`],
      { headers: { host: uiHost, origin: uiOrigin, "sec-fetch-site": "same-origin" } },
    );
    await once(ws, "open");
    expect(ws.protocol).toBe("aiscoo-local-web-v1");
    const [code] = await once(ws, "close");
    expect(code).toBe(4001);
    expect(
      (
        await http(port, "/api/server-info", {
          headers: { host: uiHost, "x-aiscoo-local-web-token": token },
        })
      ).status,
    ).toBe(401);
    const fresh = await session(port);
    expect((JSON.parse(fresh.body) as { token: string }).token).not.toBe(token);
  });

  it.each([
    ["/ws", "before attach"],
    ["/ws", "after attach"],
    ["/ws/host", "before attach"],
    ["/ws/host", "after attach"],
  ])("does not initialize RPC on %s when the session expires %s", async (path, expiryPoint) => {
    const frontend = createServer();
    frontend.listen(0, "127.0.0.1");
    servers.push(frontend);
    await once(frontend, "listening");
    const frontendAddress = frontend.address();
    if (!frontendAddress || typeof frontendAddress === "string") throw new Error("No TCP address");
    const origin = `http://127.0.0.1:${frontendAddress.port}`;
    const headers = {
      host: new URL(origin).host,
      origin,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    };
    const services = new ServiceCollection();
    const exposed = vi.spyOn(services, "exposeOnChannelServer");
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const port = await startServer({ localWeb: { allowedOrigins: [origin] } }, services);
    const sessionResponse = await session(port, headers);
    expect(sessionResponse.status).toBe(200);
    const token = (JSON.parse(sessionResponse.body) as { token: string }).token;
    let capability: string | undefined;
    if (path === "/ws/host") {
      const response = await http(port, "/api/rpc-host-capability", {
        method: "POST",
        headers: { ...headers, ...tokenHeaders(token) },
      });
      expect(response.status).toBe(200);
      capability = (JSON.parse(response.body) as { capability: string }).capability;
    }

    const handleUpgrade = WebSocketServer.prototype.handleUpgrade;
    vi.spyOn(WebSocketServer.prototype, "handleUpgrade").mockImplementation(
      function (incoming, socket, head, callback) {
        return handleUpgrade.call(this, incoming, socket, head, (upgraded, request) => {
          // 真实 101 已生成；分别在连接附着前或其完成后、onOpen 前推进会话时钟。
          if (expiryPoint === "before attach") clock.mockReturnValue(now + 60 * 60 * 1000);
          callback(upgraded, request);
          if (expiryPoint === "after attach") clock.mockReturnValue(now + 60 * 60 * 1000);
        });
      },
    );

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}${path}`,
      ["aiscoo-local-web-v1", `aiscoo-local-web-token.${token}`],
      {
        headers: {
          ...headers,
          "sec-fetch-mode": "websocket",
          ...(capability ? { [ZCODE_RPC_HOST_CAPABILITY_HEADER]: capability } : {}),
        },
      },
    );
    const closed = once(ws, "close");
    let upgraded = false;
    ws.on("upgrade", (response) => {
      upgraded = response.statusCode === 101;
      expect(response.headers["sec-websocket-protocol"]).toBe("aiscoo-local-web-v1");
    });
    const expiredCheck = new Promise<number>((resolve, reject) => {
      ws.once("open", () => {
        void http(port, "/api/server-info", {
          headers: { host: headers.host, ...tokenHeaders(token) },
        }).then((response) => resolve(response.status), reject);
      });
      ws.once("unexpected-response", (_request, response) => {
        response.resume();
        reject(new Error(`Expected upgrade, received HTTP ${response.statusCode}`));
      });
      ws.once("error", reject);
    });
    try {
      expect(await expiredCheck).toBe(401);
      const [code] = await closed;
      expect(upgraded).toBe(true);
      expect(code).toBe(4001);
      expect(exposed).not.toHaveBeenCalled();
    } finally {
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
      await closed;
    }
  });

  it.each(["/ws", "/ws/host"])(
    "initializes RPC on %s while its attached local session is valid",
    async (path) => {
      const frontend = createServer();
      frontend.listen(0, "127.0.0.1");
      servers.push(frontend);
      await once(frontend, "listening");
      const address = frontend.address();
      if (!address || typeof address === "string") throw new Error("No TCP address");
      const origin = `http://127.0.0.1:${address.port}`;
      const headers = { host: new URL(origin).host, origin, "sec-fetch-site": "same-origin" };
      const services = new ServiceCollection();
      const exposed = vi.spyOn(services, "exposeOnChannelServer");
      const port = await startServer({ localWeb: { allowedOrigins: [origin] } }, services);
      const sessionResponse = await session(port, headers);
      expect(sessionResponse.status).toBe(200);
      const token = (JSON.parse(sessionResponse.body) as { token: string }).token;
      let capability: string | undefined;
      if (path === "/ws/host") {
        const response = await http(port, "/api/rpc-host-capability", {
          method: "POST",
          headers: { ...headers, ...tokenHeaders(token) },
        });
        expect(response.status).toBe(200);
        capability = (JSON.parse(response.body) as { capability: string }).capability;
      }
      expect(
        await websocket(port, path, {
          ...headers,
          ...wsHeadersFor(token),
          ...(capability ? { [ZCODE_RPC_HOST_CAPABILITY_HEADER]: capability } : {}),
        }),
      ).toBe(101);
      expect(exposed).toHaveBeenCalledOnce();
    },
  );

  it.each(["/ws", "/ws/host"])(
    "initializes RPC on %s for an ordinary server without the local profile",
    async (path) => {
      const services = new ServiceCollection();
      const exposed = vi.spyOn(services, "exposeOnChannelServer");
      const port = await startServer({ localWeb: undefined }, services);
      let capability: string | undefined;
      if (path === "/ws/host") {
        const response = await http(port, "/api/rpc-host-capability", { method: "POST" });
        expect(response.status).toBe(200);
        capability = (JSON.parse(response.body) as { capability: string }).capability;
      }
      expect(
        await websocket(
          port,
          path,
          capability ? { [ZCODE_RPC_HOST_CAPABILITY_HEADER]: capability } : {},
        ),
      ).toBe(101);
      expect(exposed).toHaveBeenCalledOnce();
    },
  );

  it("leaves the upstream server behavior unchanged when the profile is off", async () => {
    const port = await startServer({ localWeb: undefined, authToken: "upstream-token" });
    expect(
      (await http(port, "/api/server-info", { headers: { host: "any-host.example" } })).status,
    ).toBe(401);
    const accepted = await http(port, "/api/server-info?token=upstream-token", {
      headers: { host: "any-host.example" },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.headers["set-cookie"]?.[0]).toContain("zcode_lite_token=");
  });
});
