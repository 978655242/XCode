// XCODE: 产品展示归因统一为 XCode，保留来源请求头键与协议。
export const OPENROUTER_ATTRIBUTION_HEADERS = {
  "X-OpenRouter-Title": "XCode",
  "X-OpenRouter-Categories": "programming-app",
} as const;

export function isOpenRouterBaseUrl(baseUrl: string | undefined): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai"))
    );
  } catch {
    return false;
  }
}

export function withOpenRouterAttributionHeaders(
  headers: Record<string, string>,
  baseUrl: string | undefined,
): Record<string, string> {
  if (!isOpenRouterBaseUrl(baseUrl)) {
    return headers;
  }
  return {
    ...headers,
    ...OPENROUTER_ATTRIBUTION_HEADERS,
  };
}
