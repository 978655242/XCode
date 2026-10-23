import { request as requestHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";

// XCODE: 静态网关把模型请求改写到本地账号 mock；仍交给当前 worker 的原回放代理，保留阶段与抓包。
export const CODING_PLAN_GATEWAY_MESSAGES_PATH = "/api/v1/ultra/anthropic/v1/messages";
const CONFIGURE_PATH = "/__e2e/coding-plan/gateway-proxy";
const FORWARDED_HEADER = "x-zcode-e2e-gateway-hop";

function loopbackOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    Number(url.port) <= 0 ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("E2E gateway proxy requires an explicit loopback HTTP origin");
  }
  return url;
}

function respondError(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

export function createCodingPlanGatewayMockRoute() {
  let proxy: URL | undefined;
  let replay = false;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if (request.method !== "POST") return false;
    const path = request.url ?? "/";
    if (path === CONFIGURE_PATH) {
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > 4096) throw new Error("Oversized gateway proxy binding");
          chunks.push(buffer);
        }
        const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          !payload ||
          typeof payload !== "object" ||
          !("proxyUrl" in payload) ||
          typeof payload.proxyUrl !== "string" ||
          ("replay" in payload && typeof payload.replay !== "boolean")
        ) {
          throw new Error("Invalid gateway proxy binding");
        }
        const next = loopbackOrigin(payload.proxyUrl);
        if (Number(next.port) === request.socket.localPort) throw new Error("Self proxy binding");
        proxy = next;
        replay = "replay" in payload && payload.replay === true;
        response.writeHead(204).end();
      } catch {
        respondError(response, 400, "Invalid E2E gateway proxy binding");
      }
      return true;
    }
    if (
      path !== CODING_PLAN_GATEWAY_MESSAGES_PATH &&
      !path.startsWith(`${CODING_PLAN_GATEWAY_MESSAGES_PATH}?`)
    )
      return false;
    if (!proxy) {
      respondError(response, 503, "E2E gateway proxy was not prepared");
      return true;
    }
    // 缺失代理 fixture 时禁止转回自身形成循环；必须让原始请求明确失败。
    if (request.headers[FORWARDED_HEADER]) {
      respondError(response, 502, "E2E proxy has no native gateway fixture");
      return true;
    }
    // XCODE: 队列 case 使用同一 worker 的原回放流，保留 chunks 延时与 maxMatches 的唯一所有者。
    const target = replay
      ? new URL("/anthropic/v1/messages", proxy)
      : new URL(path, `http://127.0.0.1:${request.socket.localPort}`);
    const forwarded = requestHttp(
      {
        hostname: proxy.hostname,
        port: proxy.port,
        method: request.method,
        path: replay ? target.pathname : target.href,
        agent: false,
        headers: { ...request.headers, host: target.host, [FORWARDED_HEADER]: "1" },
      },
      (upstream) => {
        response.writeHead(upstream.statusCode ?? 502, upstream.headers);
        void pipeline(upstream, response).catch(() => response.destroy());
      },
    );
    forwarded.once("error", () => {
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else respondError(response, 502, "E2E gateway proxy forwarding failed");
    });
    response.once("close", () => forwarded.destroy());
    void pipeline(request, forwarded).catch(() => forwarded.destroy());
    return true;
  };
}

export async function configureCodingPlanGatewayProxy(
  baseUrl: string,
  proxyUrl: string,
  replay = false,
): Promise<void> {
  const base = loopbackOrigin(baseUrl);
  const proxy = loopbackOrigin(proxyUrl);
  const response = await fetch(new URL(CONFIGURE_PATH, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proxyUrl: proxy.origin, replay }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`E2E gateway proxy binding failed: ${response.status}`);
}
