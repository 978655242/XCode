import {
  createChildTraceContext,
  runWithModelInvocationContext,
  traceContextToLogContext,
  type SessionEvent,
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
import { normalizeStreamError } from "../runtime/helpers/model-errors.js";
import { auxiliaryModelOptions } from "../model/auxiliary-model-options.js";
import type { WorkspaceModelTextStreamOptions } from "./contract.js";

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
  const traceContext = createChildTraceContext(owner.rootTraceContext, {
    attributes: { model: `${model.providerId}/${model.modelId}`, querySource },
  });
  const events: SessionEvent[] = [];
  const startedAt = Date.now();
  let text = "";
  let result: RuntimeModelTextResult | undefined;
  let error: unknown;
  let toolCallCount = 0;
  let hasToolInput = false;
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
          messages: input.messages?.length
            ? input.messages.map((message) => ({ ...message }))
            : [{ role: "user", content: input.prompt!.trim() }],
          tools: [],
          // 真实目录可能只允许 4096；说明的期望预算必须按实际模型上限钳制，不能越界或缺失。
          options: modelOptions,
        })) {
          signal?.throwIfAborted();
          if (event.type === "error") throw normalizeStreamError(event.error);
          if (event.type === "tool_call") toolCallCount += 1;
          if (event.type === "tool_input_start") hasToolInput = true;
          if (event.type === "text_delta" && event.text) {
            if (result) throw new Error("Workspace text stream emitted text after finish");
            text += event.text;
            await options.onDelta(event.text);
            signal?.throwIfAborted();
          }
          if (event.type === "finish") {
            if (result) throw new Error("Workspace text stream emitted duplicate finish");
            result = {
              text,
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
    if (completed.finishReason !== "stop" || toolCallCount || hasToolInput)
      throw new Error(
        `Workspace text stream did not produce a supported completion (${completed.finishReason})`,
      );
    return {
      text: completed.text,
      selection: {
        ...selection,
        options: { ...selection.options, reasoningLevel: modelOptions.reasoningLevel },
      },
      finishReason: completed.finishReason,
      usage: completed.usage,
    };
  } catch (caught) {
    error = normalizeStreamError(caught);
    throw error;
  } finally {
    await recordModelUsageFact(owner, {
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
