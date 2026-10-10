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
      providerName: `New API · ${apiType}`,
      config: new ProviderConfig({
        group: "new-api-family",
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
