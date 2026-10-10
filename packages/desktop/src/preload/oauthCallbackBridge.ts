import type { OAuthCallbackEvent } from "@zcode/shared";

type OAuthCallback = (event: OAuthCallbackEvent) => void | Promise<void>;

export function createOAuthCallbackHandler(callback: OAuthCallback, notifyHandled: () => void) {
  return async (_event: unknown, payload: unknown): Promise<void> => {
    try {
      // XCODE: 旧字符串payload不能猜用途；只有Main已绑定provider/purpose的信封可进入Renderer。
      if (
        !payload ||
        typeof payload !== "object" ||
        !("url" in payload) ||
        !("provider" in payload) ||
        !("purpose" in payload) ||
        typeof payload.url !== "string" ||
        typeof payload.provider !== "string" ||
        (payload.purpose !== "primary-account" && payload.purpose !== "official-cloud") ||
        !["new-api", "bigmodel", "zai"].includes(payload.provider) ||
        (payload.provider === "new-api" && payload.purpose !== "primary-account")
      )
        return;
      await callback({ url: payload.url, provider: payload.provider, purpose: payload.purpose });
    } catch {
      // preload 只负责桥接 OAuth 回调与主进程握手，不能把 renderer 回调异常继续外抛成未处理 rejection。
      // 业务错误由 renderer 自己展示；这里无论成功失败都必须保证 handled 回执发回 main。
    } finally {
      notifyHandled();
    }
  };
}
