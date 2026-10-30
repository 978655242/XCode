import {
  NewApiAccountAccessConfig,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
} from "@zcode/provider";
import { NEW_API_MODEL_PROVIDER_IDS, normalizeNewApiOrigin } from "@zcode/shared";
import { PRODUCT_NAME } from "@zcode/shared/aiscoo-brand";

/** Local anchors survive CDN changes; only the explicit Host origin owns their routes. */
export function createNewApiProviderAnchors(origin: string): ProviderConfigMap {
  const canonicalOrigin = normalizeNewApiOrigin(origin);
  return new ProviderConfigMap(
    Object.entries(NEW_API_MODEL_PROVIDER_IDS).map(([apiType, providerId]) => ({
      providerId,
      // XCODE: 托管套餐显示名称来自统一品牌配置，不改变 Provider 身份。
      providerName:
        apiType === "openai-chat-completions" ? `${PRODUCT_NAME} Zen` : `New API · ${apiType}`,
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
