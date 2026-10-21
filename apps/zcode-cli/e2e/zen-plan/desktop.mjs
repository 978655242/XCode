// 桌面客户端协议替身：使用桌面真实 client_id 与精确 zcode:// 回调，经真实浏览器授权页取得 code。
// 不启动 Electron、不注册系统深链；仅用于证明服务端桌面 SID 与 CLI SID 共存且互不撤销。
import { createHash, randomBytes } from "node:crypto";
import { authorizeInBrowser, newSession } from "./browser.mjs";

export function desktopLoginFactory(context) {
  return async function desktopLogin(account) {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const url = new URL("/api/xcode/v1/auth/authorize", context.backend.origin);
    url.search = new URLSearchParams({ client_id: "xcode-desktop", response_type: "code", redirect_uri: "zcode://oauth/callback", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    const session = await newSession(context.browser);
    let callback;
    // 浏览器把授权结果交给 zcode:// 深链；在此截获该导航即为桌面 Main 收到的 URL。
    session.page.on("request", (request) => { if (request.url().startsWith("zcode://")) callback = request.url(); });
    await session.page.exposeFunction("__zenCaptureDeepLink", (value) => { callback = value; });
    await session.page.addInitScript(() => {
      const open = window.open;
      window.open = (target, ...rest) => { if (String(target).startsWith("zcode://")) { window.__zenCaptureDeepLink(String(target)); return null; } return open.call(window, target, ...rest); };
      const assign = window.location.assign.bind(window.location);
      window.location.assign = (target) => { if (String(target).startsWith("zcode://")) { window.__zenCaptureDeepLink(String(target)); return; } assign(target); };
    });
    await authorizeInBrowser(session, url.toString(), { account });
    const deadline = Date.now() + 15_000;
    while (!callback && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    await session.close();
    if (!callback) throw new Error("desktop deep-link callback was not produced");
    const parsed = new URL(callback);
    if (parsed.searchParams.get("state") !== state) throw new Error("desktop callback state mismatch");
    const response = await fetch(`${context.backend.origin}/api/xcode/v1/auth/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", client_id: "xcode-desktop", redirect_uri: "zcode://oauth/callback", code: parsed.searchParams.get("code"), code_verifier: verifier }),
    }).then((result) => result.json());
    if (!response.success) throw new Error(`desktop token exchange failed: ${response.code}`);
    return response.data;
  };
}

export function desktopLogout(context) {
  return async (bundle) => {
    const response = await fetch(`${context.backend.origin}/api/xcode/v1/auth/logout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "xcode-desktop", session_id: bundle.session_id, refresh_token: bundle.refresh_token }),
    }).then((result) => result.json());
    if (!response.success) throw new Error(`desktop logout failed: ${response.code}`);
  };
}
