import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { MiddlewareHandler } from "hono";
import type { LocalWebOptions } from "./contract.js";

export type { LocalWebOptions } from "./contract.js";
export { startAiscooLocalWebHttpEntry } from "./startup.js";

const SESSION_SECONDS = 60 * 60;
const MAX_SESSIONS = 256;
const SESSION_PATH = "/api/local-web/session";
const SESSION_HEADER = "x-aiscoo-local-web-token";
export const LOCAL_WEB_PROTOCOL = "aiscoo-local-web-v1";
const TOKEN_PROTOCOL_PREFIX = "aiscoo-local-web-token.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface Session {
  host: string;
  expiresAt: number;
}

function allowedPageHosts(options: LocalWebOptions): Set<string> {
  if (!Array.isArray(options.allowedOrigins) || options.allowedOrigins.length === 0) {
    throw new Error("localWeb requires at least one explicit loopback page origin");
  }

  const hosts = new Set<string>();
  for (const value of options.allowedOrigins) {
    let origin: URL;
    try {
      origin = new URL(value);
    } catch {
      throw new Error("localWeb page origin must be an exact HTTP loopback origin with a port");
    }
    if (
      origin.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
      !origin.port ||
      origin.origin !== value
    ) {
      throw new Error("localWeb page origin must be an exact HTTP loopback origin with a port");
    }
    hosts.add(origin.host);
  }
  return hosts;
}

function hasSingleHeaders(incoming: IncomingMessage): boolean {
  const singletonHeaders = new Set([
    "host",
    "origin",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
    SESSION_HEADER,
    "sec-websocket-protocol",
  ]);
  const seen = new Set<string>();
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    const name = incoming.rawHeaders[index]?.toLowerCase();
    if (!name || !singletonHeaders.has(name)) continue;
    if (seen.has(name)) return false;
    seen.add(name);
  }
  return seen.has("host");
}

function validFetchMetadata(headers: Headers, kind: "static" | "api" | "websocket"): boolean {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && !(kind === "static" && site === "none")) return false;

  const mode = headers.get("sec-fetch-mode");
  const destination = headers.get("sec-fetch-dest");
  if (kind === "static") return true;
  if (destination && destination !== "empty") return false;
  if (!mode) return true;
  return kind === "websocket" ? mode === "websocket" : mode === "cors" || mode === "same-origin";
}

function sessionToken(headers: Headers, isWebSocket: boolean): string | undefined {
  if (!isWebSocket) {
    const token = headers.get(SESSION_HEADER);
    return token && TOKEN_PATTERN.test(token) ? token : undefined;
  }
  // 修复原因：ws 默认选择首个协议；固定协议必须在前，令牌绝不能作为响应协议回显。
  const protocols = headers
    .get("sec-websocket-protocol")
    ?.split(",")
    .map((part) => part.trim());
  if (protocols?.length !== 2 || protocols[0] !== LOCAL_WEB_PROTOCOL) return undefined;
  const credential = protocols[1];
  if (!credential?.startsWith(TOKEN_PROTOCOL_PREFIX)) return undefined;
  const token = credential.slice(TOKEN_PROTOCOL_PREFIX.length);
  return TOKEN_PATTERN.test(token) ? token : undefined;
}

function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/ws" ||
    pathname.startsWith("/ws/")
  );
}

/** One middleware owns the in-memory local browser sessions for one server instance. */
export function createAiscooLocalWebMiddleware(
  options: LocalWebOptions,
  listenHost: string | undefined,
  authToken: string | undefined,
): {
  middleware: MiddlewareHandler;
  attachSocket(
    incoming: IncomingMessage,
    socket: {
      close(code: number, reason: string): void;
      terminate(): void;
      on(event: "close", listener: () => void): unknown;
    },
  ): boolean;
  isSocketAuthorized(socket: object): boolean;
} {
  if (listenHost !== "127.0.0.1" && listenHost !== "::1") {
    throw new Error("localWeb requires an explicit loopback listen host");
  }
  if (authToken?.trim()) {
    throw new Error("localWeb cannot be combined with the legacy auth token");
  }
  const hosts = allowedPageHosts(options);
  const sessions = new Map<string, Session>();
  // 修复原因：握手检查不能保证连接存续期间令牌仍有效；到期与淘汰必须关闭关联连接。
  const connections = new Map<string, Set<() => void>>();
  const socketSessions = new WeakMap<object, { token: string; session: Session }>();
  const invalidate = (token: string) => {
    sessions.delete(token);
    for (const close of connections.get(token) ?? []) close();
    connections.delete(token);
  };
  const middleware: MiddlewareHandler = async (c, next) => {
    const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
    // 修复原因：仅绑定回环不能防 DNS rebinding；两种 HTTP/WS 路径都必须验证原始 Host。
    if (
      !incoming ||
      !hasSingleHeaders(incoming) ||
      !incoming.url?.startsWith("/") ||
      incoming.url.startsWith("//") ||
      /%2f|%5c/i.test(incoming.url.split("?", 1)[0] ?? "")
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const host = c.req.header("host");
    const origin = c.req.header("origin");
    if (!host || !hosts.has(host) || (origin !== undefined && origin !== `http://${host}`)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    // Hono 的路由会解码 %61 等字符；鉴权必须使用同一路径，防止编码绕过。
    const pathname = c.req.path;
    const isWebSocket = c.req.header("upgrade")?.toLowerCase() === "websocket";
    const isSafeMethod = c.req.method === "GET" || c.req.method === "HEAD";
    const protectedPath = isProtectedPath(pathname);
    const kind = isWebSocket ? "websocket" : protectedPath || !isSafeMethod ? "api" : "static";
    if (
      !validFetchMetadata(c.req.raw.headers, kind) ||
      ((isWebSocket || !isSafeMethod) && origin !== `http://${host}`)
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }

    if (protectedPath || !isSafeMethod || isWebSocket) c.header("Cache-Control", "no-store");
    if (pathname === SESSION_PATH && c.req.method === "POST") {
      // 修复原因：无 Origin 的表单或跨站 POST 不能取得本机会话，也不能通过 URL 传入凭据。
      if (
        new URL(c.req.url).search !== "" ||
        (c.req.header("content-length") !== undefined && c.req.header("content-length") !== "0") ||
        c.req.header("transfer-encoding") !== undefined
      ) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const now = Date.now();
      for (const [token, session] of sessions) {
        if (session.expiresAt <= now) invalidate(token);
      }
      if (sessions.size >= MAX_SESSIONS) {
        const oldest = sessions.keys().next().value;
        if (oldest !== undefined) invalidate(oldest);
      }
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, { host, expiresAt: now + SESSION_SECONDS * 1000 });
      return c.json({ token });
    }

    if (protectedPath || !isSafeMethod || isWebSocket) {
      const token = sessionToken(c.req.raw.headers, isWebSocket);
      const session = token ? sessions.get(token) : undefined;
      if (!session || session.host !== host || session.expiresAt <= Date.now()) {
        if (token && session?.expiresAt && session.expiresAt <= Date.now()) invalidate(token);
        return c.json({ error: "Unauthorized" }, 401);
      }
    }
    await next();
  };

  return {
    middleware,
    attachSocket(incoming, socket) {
      const raw = incoming.headers["sec-websocket-protocol"];
      const headers = new Headers();
      if (typeof raw === "string") headers.set("sec-websocket-protocol", raw);
      const token = sessionToken(headers, true);
      const session = token ? sessions.get(token) : undefined;
      if (
        !token ||
        !session ||
        session.host !== incoming.headers.host ||
        session.expiresAt <= Date.now()
      ) {
        socket.close(4001, "Local session expired");
        return false;
      }
      socketSessions.set(socket, { token, session });
      // 修复原因：close 等待对端握手期间仍可收到 RPC；立即销毁连接才能同步阻断后续消息。
      // 先尽力写出 4001 关闭帧让正常页面提示重连，再同步 terminate，不等待不可信客户端响应；
      // terminate 触发的 close 事件由 Server 的 RPC 连接清理释放 scope（/ws 与 /ws/host 共用）。
      const close = () => {
        try {
          socket.close(4001, "Local session expired");
        } catch {
          // 连接可能已处于关闭中；仍须继续销毁。
        }
        socket.terminate();
      };
      let attached = connections.get(token);
      if (!attached) connections.set(token, (attached = new Set()));
      attached.add(close);
      const timer = setTimeout(() => invalidate(token), session.expiresAt - Date.now());
      timer.unref?.();
      socket.on("close", () => {
        clearTimeout(timer);
        socketSessions.delete(socket);
        attached.delete(close);
        // 会话失效后可能有同名映射被替换，旧连接关闭不能删除新映射。
        if (attached.size === 0 && connections.get(token) === attached) connections.delete(token);
      });
      return true;
    },
    isSocketAuthorized(socket) {
      const attached = socketSessions.get(socket);
      if (!attached) return false;
      // 修复原因：101 与 onOpen 之间会话可能过期或被淘汰，不能仅凭握手时的检查注册 RPC。
      if (sessions.get(attached.token) !== attached.session) return false;
      if (attached.session.expiresAt <= Date.now()) {
        invalidate(attached.token);
        return false;
      }
      return true;
    },
  };
}
