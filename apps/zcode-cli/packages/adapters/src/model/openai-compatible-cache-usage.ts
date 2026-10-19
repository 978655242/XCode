// XCODE: OpenAI Chat Completions 缓存读取缺失时保留“未知”语义。
import type { LanguageModelMiddleware } from "ai";

/** provider 层 usage 中本模块读写的字段；其余字段原样透传。 */
export interface ProviderCacheUsage {
  inputTokens: { cacheRead: number | undefined; noCache: number | undefined };
  raw?: unknown;
}

// 修复原因：@ai-sdk/openai-compatible 把缺失的 prompt_tokens_details.cached_tokens 归一化成 0，
// Kiro Claude 等上游根本不回报缓存计数，UI 因此显示“命中率 0%”。原始 usage 只在 provider
// 层还可见，这里按 raw 是否真的带 cached_tokens 恢复 undefined，下游据此展示“未知”。
export function withUnknownCacheRead<T extends ProviderCacheUsage>(usage: T): T {
  const raw = usage.raw as { prompt_tokens_details?: { cached_tokens?: unknown } } | undefined;
  if (!raw || typeof raw.prompt_tokens_details?.cached_tokens === "number") return usage;
  return { ...usage, inputTokens: { ...usage.inputTokens, cacheRead: undefined, noCache: undefined } };
}

export const openAICompatibleCacheUsageMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    return { ...result, usage: withUnknownCacheRead(result.usage) };
  },
  wrapStream: async ({ doStream }) => {
    const result = await doStream();
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            controller.enqueue(
              part.type === "finish" ? { ...part, usage: withUnknownCacheRead(part.usage) } : part,
            );
          },
        }),
      ),
    };
  },
};
