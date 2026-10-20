import { describe, expect, it } from "vitest";
import { createModelId, createModelProviderId } from "@zcode/contracts";
import {
  createGenerateTextOptions,
  createStreamTextOptions,
  shouldIncludeStreamResponseBody,
} from "../src/model/runner-options.js";
import { isOpenCodeGoBaseUrl } from "../src/model/opencode-session.js";
import { createStatusContext } from "../src/model/runner-status.js";
import type { AiSdkModelTextRequest, ResolvedAiSdkModel } from "../src/model/runner-runtime.js";
import { createTestModelProperties } from "./test-model-format.js";

function resolved(partial: Partial<ResolvedAiSdkModel> = {}): ResolvedAiSdkModel {
  return {
    model: {} as ResolvedAiSdkModel["model"],
    providerId: createModelProviderId("fixture"),
    modelId: createModelId("fixture-model"),
    providerKind: "openai-compatible",
    properties: createTestModelProperties(),
    ...partial,
  };
}

function runnerInput(
  request: Partial<AiSdkModelTextRequest> = {},
  partial: Partial<ResolvedAiSdkModel> = {},
) {
  const model = resolved(partial);
  const textRequest: AiSdkModelTextRequest = {
    messages: [{ role: "user", content: "hello" }],
    ...request,
  };
  return {
    includeModelIO: false,
    request: textRequest,
    resolved: model,
    statusContext: createStatusContext({
      maxAttempts: 1,
      request: textRequest,
      resolved: model,
      transport: "http",
    }),
  };
}

const startPlanAccess = {
  type: "zhipu-account",
  accountType: "zai",
  mode: "start-plan",
  entitled: true,
} as const;

describe("shouldIncludeStreamResponseBody", () => {
  it("captures business response bodies from explicit Start Plan access", () => {
    expect(shouldIncludeStreamResponseBody(resolved({ accountAccess: startPlanAccess }))).toBe(
      true,
    );
  });

  it("does not infer account access from the endpoint", () => {
    expect(
      shouldIncludeStreamResponseBody(
        resolved({ baseURL: "https://zcode.z.ai/api/v1/zcode-plan" }),
      ),
    ).toBe(false);
    expect(
      shouldIncludeStreamResponseBody(
        resolved({ providerKind: "anthropic", accountAccess: startPlanAccess }),
      ),
    ).toBe(false);
  });
});

describe("isOpenCodeGoBaseUrl", () => {
  it.each(["https://opencode.ai/zen/go/v1", "https://api.opencode.ai/zen/go/v1/"])(
    "matches OpenCode Go host and path boundaries: %s",
    (baseURL) => {
      expect(isOpenCodeGoBaseUrl(baseURL)).toBe(true);
    },
  );

  it.each([
    "https://opencode.ai/zen/v1",
    "https://opencode.ai/zen/go/v2",
    "https://opencode.ai.example/zen/go/v1",
    "not a url",
    undefined,
  ])("rejects unrelated OpenCode endpoints: %s", (baseURL) => {
    expect(isOpenCodeGoBaseUrl(baseURL)).toBe(false);
  });
});

describe("runner request options", () => {
  it("maps a JSON response schema only into generateText structured output", async () => {
    const responseJsonSchema = {
      additionalProperties: false,
      properties: { selected_memories: { items: { type: "string" }, type: "array" } },
      required: ["selected_memories"],
      type: "object",
    };
    const input = runnerInput({ responseJsonSchema });
    const generateOptions = createGenerateTextOptions(input);

    await expect(generateOptions.output?.responseFormat).resolves.toEqual({
      schema: responseJsonSchema,
      type: "json",
    });
    expect(createStreamTextOptions(input)).not.toHaveProperty("output");
  });

  it("keeps explicit Anthropic schemas native without rewriting reasoning options", () => {
    const anthropic = { effort: "medium", thinking: { budgetTokens: 8_000, type: "enabled" } };
    const input = runnerInput(
      { responseJsonSchema: { type: "object", properties: {} }, maxOutputTokens: 256 },
      { providerKind: "anthropic", providerOptions: { anthropic } },
    );

    expect(createGenerateTextOptions(input).providerOptions).toEqual({
      anthropic: { ...anthropic, structuredOutputMode: "outputFormat" },
    });
    expect(createStreamTextOptions(input).providerOptions).toEqual({ anthropic });
    expect(anthropic).not.toHaveProperty("structuredOutputMode");
  });

  it("keeps empty-user wire content valid for generate and stream", () => {
    for (const createOptions of [createGenerateTextOptions, createStreamTextOptions]) {
      const options = createOptions(runnerInput({ messages: [{ role: "user", content: "" }] }));
      expect(options.messages).toEqual([{ role: "user", content: "(no content)" }]);
    }
  });

  it("uses Effective Model Config image support for message transforms", () => {
    const input = runnerInput(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "image", mediaType: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" },
            ],
          },
        ],
      },
      { properties: createTestModelProperties({ supportsImage: false }) },
    );
    for (const createOptions of [createGenerateTextOptions, createStreamTextOptions]) {
      expect(createOptions(input).messages[0]?.content).toEqual([
        {
          type: "text",
          text: "[Attached image/png]\n[Media omitted from provider request because the selected model does not support image input.]",
        },
      ]);
    }
  });

  it("omits video with a text notice when model metadata declares it unsupported", () => {
    const input = runnerInput(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "video", mediaType: "video/mp4", dataUrl: "data:video/mp4;base64,dmlkZW8=" },
            ],
          },
        ],
      },
      { providerKind: "openai", properties: createTestModelProperties({ supportsVideo: false }) },
    );
    for (const createOptions of [createGenerateTextOptions, createStreamTextOptions]) {
      const content = createOptions(input).messages[0]?.content;
      expect(content).toEqual([{ type: "text", text: expect.any(String) }]);
      if (Array.isArray(content) && content[0]?.type === "text") {
        expect(content[0].text.trim().length).toBeGreaterThan(0);
      }
      expect(JSON.stringify(content)).not.toContain("dmlkZW8=");
    }
  });

  // XCODE: 输出和思考字段由 Effective Model Config 的原始 body map 唯一负责，runner 不再二次计算预算。
  it.each(["anthropic", "openai", "openai-compatible"] as const)(
    "does not introduce an SDK output budget or adjust thinking for %s",
    (providerKind) => {
      const providerOptions = {
        anthropic: { effort: "high", thinking: { budgetTokens: 32_000, type: "enabled" } },
      };
      for (const maxOutputTokens of [undefined, 1, 20_000, 64_000, 131_072]) {
        const input = runnerInput({ maxOutputTokens, providerOptions }, { providerKind });
        for (const createOptions of [createGenerateTextOptions, createStreamTextOptions]) {
          const options = createOptions(input);
          expect(options).not.toHaveProperty("maxOutputTokens");
          expect(options.providerOptions).toEqual(providerOptions);
        }
      }
      expect(providerOptions.anthropic.thinking.budgetTokens).toBe(32_000);
    },
  );

  it("preserves existing namespaces instead of inventing provider option projections", () => {
    const staticOptions = { openai: { store: false }, anthropic: { vendorFlag: true } };
    const requestOptions = { openaiCompatible: { extra_body: { vendor_flag: true } } };
    for (const createOptions of [createGenerateTextOptions, createStreamTextOptions]) {
      const options = createOptions(
        runnerInput({ providerOptions: requestOptions }, { providerOptions: staticOptions }),
      );
      expect(options.providerOptions).toEqual({ ...staticOptions, ...requestOptions });
    }
    expect(staticOptions).not.toHaveProperty("openaiCompatible");
  });

  it("captures Start Plan stream response bodies without requiring full Model IO", () => {
    expect(
      createStreamTextOptions(runnerInput({}, { accountAccess: startPlanAccess }))
        .experimental_include,
    ).toEqual({ responseBody: true });
    const input = { ...runnerInput(), includeModelIO: true };
    for (const createOptions of [createGenerateTextOptions, createStreamTextOptions]) {
      expect(createOptions(input).experimental_include).toEqual({
        requestBody: true,
        responseBody: true,
      });
    }
  });

  it("uses merged Responses provider options while transforming history", () => {
    const input = runnerInput(
      {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "reasoning",
                text: "stored reasoning",
                providerOptions: { openai: { itemId: "rs_1" } },
              },
              { type: "text", text: "checking" },
            ],
            toolCalls: [{ id: "call_read", name: "Read", input: { file_path: "README.md" } }],
          },
        ],
      },
      { providerKind: "openai", providerOptions: { apiFormat: "openai-responses" } },
    );
    const options = createGenerateTextOptions(input);
    expect(options.messages[0]?.content).toEqual([
      { type: "text", text: "checking" },
      {
        type: "tool-call",
        toolCallId: "call_read",
        toolName: "Read",
        input: { file_path: "README.md" },
      },
    ]);
    expect(options.providerOptions).toEqual({ apiFormat: "openai-responses" });
  });

  it("retains runtime platform headers and authoritative per-request attribution", () => {
    const input = runnerInput(
      {
        metadata: {
          requestId: "req_generate",
          queryId: "query_generate",
          sessionId: "sess_generate",
          traceId: "trace_generate",
        },
        modelRequestSessionType: "main",
      },
      {
        headers: {
          "X-Os-Category": "macos",
          "X-Os-Version": "25.0.0",
          "X-Platform": "darwin-arm64",
          "x-zcode-session-type": "spoofed",
          "x-zcode-query-source": "spoofed",
        },
      },
    );
    for (const createOptions of [createGenerateTextOptions, createStreamTextOptions]) {
      expect(createOptions(input).headers).toEqual({
        "X-Os-Category": "macos",
        "X-Os-Version": "25.0.0",
        "X-Platform": "darwin-arm64",
        "x-query-id": "generate",
        "x-request-id": "req_generate",
        "x-session-id": "generate",
        "x-zcode-session-type": "main",
        "x-zcode-trace-id": "trace_generate",
      });
    }
  });

  it("strips internal subagent and query prefixes from attribution headers", () => {
    const input = runnerInput({
      modelRequestSessionType: "subagent",
      metadata: {
        queryId: "query_ad8740cd-f843-4235-ba0d-395063e56fda",
        sessionId: "sess_subagent_agent_b3d813c3-c568-42e9-8f67-eeb814bc8ef2",
      },
    });
    expect(createGenerateTextOptions(input).headers).toMatchObject({
      "x-query-id": "ad8740cd-f843-4235-ba0d-395063e56fda",
      "x-session-id": "b3d813c3-c568-42e9-8f67-eeb814bc8ef2",
      "x-zcode-session-type": "subagent",
    });
  });

  it.each([createGenerateTextOptions, createStreamTextOptions])(
    "adds a stable OpenCode Go session header to %s requests",
    (createOptions) => {
      const input = runnerInput(
        { metadata: { sessionId: "sess_conversation_stable" } },
        { baseURL: "https://opencode.ai/zen/go/v1", headers: { "x-opencode-session": "spoofed" } },
      );
      expect(createOptions(input).headers).toMatchObject({
        "x-opencode-session": "conversation_stable",
      });
    },
  );

  it("does not add an OpenCode Go session header for another path on the same host", () => {
    const input = runnerInput({}, { baseURL: "https://opencode.ai/zen/v1" });
    expect(createGenerateTextOptions(input).headers).not.toHaveProperty("x-opencode-session");
  });
});
