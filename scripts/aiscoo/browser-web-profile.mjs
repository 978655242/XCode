// 本机代理曾整体替换上游表，导致远控/分享 OAuth 被 /api 通配送到本机。
// 保留既有专用目标，再追加本机条目；关闭时返回原表，不修改共享配置对象。
export function composeBrowserWebProxy(profile, existing) {
  if (!profile) return existing;
  const specific = Object.fromEntries(
    Object.entries(existing).filter(([path]) => path !== "/ws" && path !== "/api"),
  );
  return { ...specific, ...profile.proxy };
}

// 本机 Web 只增加公开配置、同源代理与开发服务器入口限制，不持有登录凭据。
export function browserWebProfile(env) {
  if (env.AISCOO_BROWSER_NEW_API !== "1") return null;
  const origin = new URL(env.AISCOO_ADMIN_BASE_URL || "");
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
          // 本机与原远控/分享回跳都是跨站顶层导航；页面仍按原 state 校验处理回调。
          const callbackPaths = new Set([
            "/oauth/callback",
            "/remote/v4",
            "/remote/v4/",
            "/share/callback",
            "/cn/share/callback",
          ]);
          const callbackNavigation =
            req.method === "GET" &&
            callbackPaths.has(req.url?.split("?")[0]) &&
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
