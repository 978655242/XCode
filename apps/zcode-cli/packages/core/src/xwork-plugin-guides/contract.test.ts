import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionId, type ModelEvent } from "@zcode/contracts";
import { createTestAgentRuntime } from "../../tests/test-agent-runtime.js";
import { createTestModelFactory } from "../../tests/test-runtime-model.js";
import { createTestSessionEventStore } from "../../tests/test-event-store.js";
import * as usage from "../runtime/methods/usage-observability.js";
import { streamWorkspaceModelText } from "./index.js";

const selection = { providerId: "test", modelId: "guide" };
const input = { selection, prompt: "Write a guide", querySource: "plugin_guide" };
const actualUsage = { inputTokens: 7, outputTokens: 3, totalTokens: 10 };
afterEach(() => vi.restoreAllMocks());
function fixture(events: ModelEvent[]) {
  const eventStore = createTestSessionEventStore();
  const generateText = vi.fn(async () => {
    throw new Error("Nonstream fallback forbidden");
  });
  const modelFactory = createTestModelFactory({
    generateText,
    streamText: async function* () {
      yield* events;
    },
  });
  const runtime = createTestAgentRuntime(
    createSessionId("plugin-guide-stream"),
    {},
    { eventStore, modelFactory },
  );
  return { runtime, generateText, eventStore };
}

describe("workspace model streaming", () => {
  it("forwards genuine deltas, returns actual usage, and leaves model and conversation unchanged", async () => {
    const { runtime, generateText, eventStore } = fixture([
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
      { type: "finish", finishReason: "stop", usage: actualUsage },
    ]);
    const record = vi.spyOn(usage, "recordModelUsageFact").mockResolvedValue(undefined);
    const selected = runtime.getSessionModelSelection();
    const conversationEvents = await eventStore.getEvents(runtime.sessionId);
    const deltas: string[] = [];
    const result = await streamWorkspaceModelText(runtime, input, {
      onDelta: async (text) => {
        deltas.push(text);
      },
    });
    expect(deltas).toEqual(["Hello ", "world"]);
    expect(result).toMatchObject({
      text: "Hello world",
      finishReason: "stop",
      usage: actualUsage,
      selection,
    });
    expect(runtime.getSessionModelSelection()).toEqual(selected);
    expect(await eventStore.getEvents(runtime.sessionId)).toEqual(conversationEvents);
    expect(generateText).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({ usage: actualUsage }),
      }),
    );
  });

  it.each(["length", "tool-calls", "content-filter", "unknown", "error"])(
    "rejects unsupported completion %s and records its real usage",
    async (finishReason) => {
      const { runtime } = fixture([{ type: "finish", finishReason, usage: actualUsage }]);
      const record = vi.spyOn(usage, "recordModelUsageFact").mockResolvedValue(undefined);
      await expect(streamWorkspaceModelText(runtime, input, { onDelta: () => {} })).rejects.toThrow(
        /completion/i,
      );
      expect(record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: "error",
          result: expect.objectContaining({ usage: actualUsage }),
        }),
      );
    },
  );

  it("rejects streams that close without finish", async () => {
    const { runtime } = fixture([{ type: "text_delta", text: "incomplete" }]);
    await expect(streamWorkspaceModelText(runtime, input, { onDelta: () => {} })).rejects.toThrow(
      /finish/i,
    );
  });

  it("normalizes provider stream errors without a nonstream retry", async () => {
    const { runtime, generateText } = fixture([
      { type: "error", error: new Error("provider failed") },
    ]);
    await expect(streamWorkspaceModelText(runtime, input, { onDelta: () => {} })).rejects.toThrow(
      "provider failed",
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("stops at cancellation and records cancellation rather than committing a later finish", async () => {
    const controller = new AbortController();
    const { runtime } = fixture([
      { type: "text_delta", text: "partial" },
      { type: "finish", finishReason: "stop", usage: actualUsage },
    ]);
    const record = vi.spyOn(usage, "recordModelUsageFact").mockResolvedValue(undefined);
    await expect(
      streamWorkspaceModelText(runtime, input, {
        abortSignal: controller.signal,
        onDelta: () => controller.abort(new DOMException("Cancelled", "AbortError")),
      }),
    ).rejects.toThrow("Cancelled");
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "cancelled" }),
    );
  });
});
