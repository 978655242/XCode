import type { ModelToolCall } from "../deps.js";
import type { StreamedToolExecutionResult } from "../types.js";

// XCODE: 取消与断流恢复共用有界 drain，避免慢工具阻塞已接纳 call/result 的结算。
export const STREAMING_TOOL_CANCEL_DRAIN_TIMEOUT_MS = 250;

export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectCompletedResults(
  handles: Map<string, Promise<StreamedToolExecutionResult | undefined>>,
  toolCalls: readonly ModelToolCall[],
): Promise<StreamedToolExecutionResult[]> {
  const settled = await Promise.all(
    toolCalls.map((toolCall) => {
      const handle = handles.get(toolCall.id);
      if (!handle) return undefined;
      return raceWithTimeout(
        handle.catch(() => undefined),
        STREAMING_TOOL_CANCEL_DRAIN_TIMEOUT_MS,
      );
    }),
  );
  return settled.filter((result): result is StreamedToolExecutionResult => result !== undefined);
}
