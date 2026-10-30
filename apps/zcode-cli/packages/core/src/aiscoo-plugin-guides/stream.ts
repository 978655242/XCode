import {
  createChildTraceContext,
  runWithModelInvocationContext,
  traceContextToLogContext,
  type SessionEvent,
  type ModelInputMessage,
  type ModelReasoningContentBlock,
  type ModelUsage,
} from "../runtime/deps.js";
import type { AgentRuntime } from "../runtime.js";
import type { AgentRuntimeInternal } from "../runtime/internal.js";
import type { RuntimeModelTextResult } from "../runtime/types.js";
import type {
  WorkspaceGenerateTextInput,
  WorkspaceGenerateTextResult,
} from "../runtime/methods/workspace-generate-text.js";
import { createRuntimeModel } from "../runtime/methods/runtime-model.js";
import { createRefreshRuntimeHeadersBeforeModelAttempt } from "../runtime/methods/model-runtime-headers.js";
import { recordModelUsageFact } from "../runtime/methods/usage-observability.js";
import { normalizeStreamError, readRawFinishReason } from "../runtime/helpers/model-errors.js";
import { auxiliaryModelOptions } from "../model/auxiliary-model-options.js";
import type { WorkspaceModelTextStreamOptions } from "./contract.js";
import { createRuntimeAssistantEntry } from "../agent/message-history.js";
import { getOrCreateReasoningBlock } from "../runtime/methods/reasoning-stream.js";
import {
  classifyOutputTokenContinuation,
  hasAssistantReasoningContent,
  OUTPUT_TOKEN_CONTINUE_PROMPT,
  OUTPUT_TOKEN_LIMIT_ERROR_MESSAGE,
} from "../runtime/methods/turn-output-token-continuation.js";

/** Auxiliary workspace stream: no turn, session message, model mutation, tool execution, or synthetic deltas. */
export async function streamWorkspaceModelText(
  runtime: AgentRuntime,
  input: WorkspaceGenerateTextInput,
  options: WorkspaceModelTextStreamOptions,
): Promise<WorkspaceGenerateTextResult> {
  if (!input.messages?.length && !input.prompt?.trim())
    throw new Error("Workspace text prompt or messages must not be empty");
  if (input.tools?.length) throw new Error("Workspace text streams do not execute tools");
  const signal = options.abortSignal;
  signal?.throwIfAborted();
  // AgentRuntime's methods are wired onto this internal shape, just as its existing auxiliary calls are.
  const owner = runtime as unknown as AgentRuntimeInternal;
  const selection = {
    ...input.selection,
    ...(input.selection.options ? { options: { ...input.selection.options } } : {}),
  };
  const model = createRuntimeModel(owner, { selection, scope: "workspace" });
  const modelOptions = {
    ...auxiliaryModelOptions(model),
    // 显式档位属于说明本次请求；只有缺省时才采用辅助调用的最低公开档位。
    ...(selection.options?.reasoningLevel === undefined
      ? {}
      : { reasoningLevel: selection.options.reasoningLevel }),
    maxOutputTokens: Math.min(
      input.maxOutputTokens ?? model.optionSpecs.maxOutputTokens.max,
      model.optionSpecs.maxOutputTokens.max,
    ),
  };
  const querySource = input.querySource.trim() || "workspace_generate_text";
  const messages: ModelInputMessage[] = input.messages?.length
    ? input.messages.map((message) => ({ ...message }))
    : [{ role: "user", content: input.prompt!.trim() }];
  let text = "";
  let totalUsage: ModelUsage | undefined;
  let continuationCount = 0;
  while (true) {
    signal?.throwIfAborted();
    const attemptIndex = continuationCount;
    const traceContext = createChildTraceContext(owner.rootTraceContext, {
      attributes: { model: `${model.providerId}/${model.modelId}`, querySource },
    });
    const events: SessionEvent[] = [];
    const startedAt = Date.now();
    let roundText = "";
    let result: RuntimeModelTextResult | undefined;
    let error: unknown;
    let toolCallCount = 0;
    let hasToolInput = false;
    const reasoning: ModelReasoningContentBlock[] = [];
    const reasoningById = new Map<string, ModelReasoningContentBlock>();
    try {
      const completed = await runWithModelInvocationContext(
        {
          metadata: traceContextToLogContext(traceContext),
          modelCall: { operation: "workspace_generate_text" },
          statusSink: owner.createModelStatusSink(traceContext, events, { persist: false }),
          traceContext,
          refreshRuntimeHeadersBeforeAttempt: createRefreshRuntimeHeadersBeforeModelAttempt(owner, {
            abortSignal: signal,
            model,
            traceContext,
          }),
        },
        async () => {
          for await (const event of model.streamText({
            abortSignal: signal,
            messages,
            tools: [],
            options: modelOptions,
          })) {
            signal?.throwIfAborted();
            if (event.type === "error") throw normalizeStreamError(event.error);
            if (event.type === "tool_call") toolCallCount += 1;
            if (event.type === "tool_input_start") hasToolInput = true;
            if (event.type === "reasoning_start" || event.type === "reasoning_delta") {
              const block = getOrCreateReasoningBlock({
                id: event.id,
                providerMetadata: event.providerMetadata,
                reasoning,
                reasoningById,
              });
              if (event.providerMetadata) block.providerOptions = event.providerMetadata;
              if (event.type === "reasoning_delta") block.text += event.text;
            }
            if (event.type === "reasoning_end") {
              const block = reasoningById.get(event.id);
              if (block && event.providerMetadata) block.providerOptions = event.providerMetadata;
              reasoningById.delete(event.id);
            }
            if (event.type === "text_delta" && event.text) {
              if (result) throw new Error("Workspace text stream emitted text after finish");
              roundText += event.text;
              await options.onDelta(event.text);
              signal?.throwIfAborted();
            }
            if (event.type === "finish") {
              if (result) throw new Error("Workspace text stream emitted duplicate finish");
              result = {
                text: roundText,
                finishReason: event.finishReason,
                usage: event.usage,
                ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
              };
            }
          }
          signal?.throwIfAborted();
          if (!result) throw new Error("Workspace text stream ended before finish");
          return result;
        },
      );
      signal?.throwIfAborted();
      text += completed.text;
      totalUsage =
        attemptIndex === 0
          ? completed.usage
          : totalUsage && completed.usage
            ? sumUsage(totalUsage, completed.usage)
            : undefined;
      // 修复：辅助流曾直接拒绝 length；复用原 harness 的判定、指令和三次预算，保留每轮真实上下文。
      const continuation = classifyOutputTokenContinuation({
        continuationCount,
        finishReason: completed.finishReason,
        rawFinishReason: readRawFinishReason(completed.providerMetadata),
        toolCallCount: toolCallCount || Number(hasToolInput),
      });
      if (continuation === "exhausted") throw new Error(OUTPUT_TOKEN_LIMIT_ERROR_MESSAGE);
      if (continuation === "continue") {
        const continuedReasoning = reasoning.filter(hasAssistantReasoningContent);
        if (completed.text || continuedReasoning.length) {
          messages.push(
            createRuntimeAssistantEntry(completed.text, undefined, continuedReasoning, model)
              .message,
          );
        }
        messages.push({ role: "user", content: OUTPUT_TOKEN_CONTINUE_PROMPT });
        continuationCount += 1;
        continue;
      }
      if (completed.finishReason !== "stop" || toolCallCount || hasToolInput)
        throw new Error(
          `Workspace text stream did not produce a supported completion (${completed.finishReason})`,
        );
      return {
        text,
        selection: {
          ...selection,
          options: { ...selection.options, reasoningLevel: modelOptions.reasoningLevel },
        },
        finishReason: completed.finishReason,
        usage: totalUsage,
      };
    } catch (caught) {
      error = normalizeStreamError(caught);
      throw error;
    } finally {
      await recordModelUsageFact(owner, {
        attemptIndex,
        events,
        model,
        networkEventStartIndex: 0,
        querySource,
        result,
        startedAt,
        status: signal?.aborted ? "cancelled" : error ? "error" : "completed",
        toolCallCount,
        error,
        traceContext,
      });
    }
  }
}

// 各轮缺失的指标保持未知，不能用其他轮的已知小计冒充完整用量。
function sumUsage(left: ModelUsage, right: ModelUsage): ModelUsage {
  const total: ModelUsage = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningTokens",
  ] as const) {
    const before = left[key];
    const after = right[key];
    if (before !== undefined && after !== undefined) total[key] = before + after;
  }
  if (left.serverToolUse && right.serverToolUse) {
    total.serverToolUse = {};
    for (const key of ["webSearchRequests", "webFetchRequests"] as const) {
      const before = left.serverToolUse[key];
      const after = right.serverToolUse[key];
      if (before !== undefined && after !== undefined) total.serverToolUse[key] = before + after;
    }
  }
  return total;
}
