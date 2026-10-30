// 本机 Web 只增加公开配置、同源代理与开发服务器入口限制，不持有登录凭据。
export function browserWebProfile(env) {
  if (env.AISCOO_BROWSER_NEW_API !== "1") return null;
  const origin = new URL(env.NEW_API_BASE_URL || "");
  const browser = new URL(env.AISCOO_BROWSER_ORIGIN || "http://127.0.0.1:5173");
  const serverPort = Number(env.PORT || 3030);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    !["https:", "http:"].includes(origin.protocol) ||
    (origin.protocol === "http:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) ||
    !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(browser.origin) ||
    browser.href !== `${browser.origin}/` ||
    Number(browser.port) > 65535 ||
    !Number.isInteger(serverPort) ||
    serverPort < 1 ||
    serverPort > 65535
  )
    throw new Error("AISCOO_BROWSER_CONFIG_INVALID");
  return {
    origin: origin.origin,
    browserOrigin: browser.origin,
    server: {
      host: "127.0.0.1",
      port: Number(browser.port),
      strictPort: true,
      cors: false,
      allowedHosts: ["127.0.0.1"],
    },
    proxy: {
      "/api/xcode/v1": { target: origin.origin, changeOrigin: true, secure: true },
      "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true },
      "/api": { target: `http://127.0.0.1:${serverPort}` },
    },
    plugin: {
      name: "aiscoo-browser-account-boundary",
      enforce: "pre",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const requestOrigin = req.headers.origin;
          // 授权站的回跳是跨站顶层导航，仅精确 callback 允许进入 SPA。
          const callbackNavigation =
            req.method === "GET" &&
            req.url?.split("?")[0] === "/oauth/callback" &&
            req.headers["sec-fetch-mode"] === "navigate";
          if (
            req.headers.host !== browser.host ||
            (requestOrigin && requestOrigin !== browser.origin) ||
            (req.headers["sec-fetch-site"] === "cross-site" && !callbackNavigation) ||
            req.url?.split("?")[0] === "/__open-in-editor"
          ) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }
          next();
        });
      },
    },
  };
}
