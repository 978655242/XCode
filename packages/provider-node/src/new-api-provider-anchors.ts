import {
  NewApiAccountAccessConfig,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
} from "@zcode/provider";
import { NEW_API_MODEL_PROVIDER_IDS, normalizeNewApiOrigin } from "@zcode/shared";

/** Local anchors survive CDN changes; only the explicit Host origin owns their routes. */
export function createNewApiProviderAnchors(origin: string): ProviderConfigMap {
  const canonicalOrigin = normalizeNewApiOrigin(origin);
  return new ProviderConfigMap(
    Object.entries(NEW_API_MODEL_PROVIDER_IDS).map(([apiType, providerId]) => ({
      providerId,
      // XCODE: 模型设置中的托管提供商统一显示为 XWork Zen。
      providerName: apiType === "openai-chat-completions" ? "XWork Zen" : `New API · ${apiType}`,
      config: new ProviderConfig({
        group: "new-api-family",
        // XCODE: 前端仅开放 Chat Completions，保留其他协议的历史身份但不自动迁移。
        visibility: apiType === "openai-chat-completions" ? "visible" : "hidden",
        access: new NewApiAccountAccessConfig({ entitled: false }),
        api: new ProviderApiConfig({
          type: apiType as "anthropic-messages" | "openai-chat-completions" | "openai-responses",
          baseUrl: apiType === "anthropic-messages" ? canonicalOrigin : `${canonicalOrigin}/v1`,
        }),
        builtinModelIds: [],
      }),
    })),
  );
}
