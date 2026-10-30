import { resolve } from "node:path";

/** 限制本机 Vite 特殊路由；只在显式启用的开发 profile 注册。 */
export function createLocalWebViteBoundary(port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const validRequest = (req, websocket = false) => {
    const host = req.headers.host;
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (!host || !hosts.has(host)) return false;
    if (origin !== undefined && origin !== `http://${host}`) return false;
    if (websocket && origin !== `http://${host}`) return false;
    if (site && site !== "same-origin" && site !== "none") return false;
    return true;
  };
  return {
    name: "aiscoo:local-web-vite-boundary",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname;
        try {
          pathname = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname);
        } catch {
          res.writeHead(403).end();
          return;
        }
        // 修复原因：跨站图片可以不带 Origin 触发 Vite 编辑器启动，必须直接禁用该入口。
        if (
          !validRequest(req) ||
          pathname === "/__open-in-editor" ||
          pathname.startsWith("/__open-in-editor/")
        ) {
          res.writeHead(403, { "Cache-Control": "no-store" }).end("Forbidden");
          return;
        }
        next();
      });
      const httpServer = server.httpServer ?? server.config.server.middlewareMode?.server;
      const guardUpgrade = (req, socket) => {
        const protocol = req.headers["sec-websocket-protocol"];
        if ((protocol === "vite-hmr" || protocol === "vite-ping") && !validRequest(req, true)) {
          // Vite 默认接受 *.localhost 和无 Origin 的 ping，必须在其监听器之前断开。
          socket.destroy();
        }
      };
      httpServer?.prependListener("upgrade", guardUpgrade);
      httpServer?.once("close", () => httpServer.off("upgrade", guardUpgrade));
    },
  };
}

export function localWebViteFileAllow(repoRoot) {
  return [
    "packages/web",
    "packages/ui/src",
    "packages/shared/src",
    "packages/client/src",
    "packages/services/src",
    "packages/provider/src",
    "packages/rpc/src",
    "node_modules",
  ].map((path) => resolve(repoRoot, path));
}
