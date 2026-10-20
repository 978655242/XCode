import { describe, expect, it } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import { buildRegistryModelSelectGroups } from "../src/lib/modelSelectionGroups.js";

describe("model selection groups", () => {
  it("保留精确模型 ID 和供应商品牌；vision 能力只在设置页展示", () => {
    const modelId = "upstream/family/vision-preview";
    const view: ModelSelectionView = {
      revision: 1,
      providers: [
        {
          providerId: "aggregator",
          config: {
            api: { type: "openai-chat-completions", baseUrl: "https://example.test/v1" },
            logo: { type: "builtin", key: "deepseek" },
          },
          models: [{ modelId, config: { properties: { inputFormat: { supportsImage: true } } } }],
        },
      ],
    };
    expect(buildRegistryModelSelectGroups("glm", view)[0]?.items).toEqual([
      {
        key: `registry-provider:aggregator:${modelId}`,
        value: "custom:aggregator:upstream%2Ffamily%2Fvision-preview",
        name: modelId,
      },
    ]);
    expect(buildRegistryModelSelectGroups("glm", view)[0]?.logo).toEqual({
      type: "builtin",
      key: "deepseek",
    });
    expect(view.providers[0]?.models[0]?.config.properties?.inputFormat?.supportsImage).toBe(true);
  });
  it("直接把 Registry API Provider 投影为有序模型组", () => {
    const selectionView: ModelSelectionView = {
      revision: 7,
      providers: [
        {
          providerId: "anthropic-api",
          providerName: "Anthropic API",
          config: {
            access: { type: "api-key", apiKey: "secret" },
            api: {
              type: "anthropic-messages",
              baseUrl: "https://example.com/anthropic",
            },
            models: ["claude-a", "claude-b"],
          },
          models: [
            {
              modelId: "claude-a",
              config: { properties: { inputFormat: { supportsImage: true } } },
            },
            { modelId: "claude-b", config: {} },
          ],
        },
        {
          providerId: "openai-api",
          providerName: "OpenAI API",
          config: {
            access: { type: "api-key", apiKey: "secret" },
            api: {
              type: "openai-responses",
              baseUrl: "https://example.com/openai",
            },
            models: ["model-a"],
          },
          models: [{ modelId: "model-a", config: {} }],
        },
      ],
    };

    expect(buildRegistryModelSelectGroups("glm", selectionView)).toEqual([
      {
        key: "registry-provider:anthropic-api",
        label: "Anthropic API",
        labelBadge: "API",
        items: [
          {
            key: "registry-provider:anthropic-api:claude-a",
            value: "custom:anthropic-api:claude-a",
            name: "claude-a",
          },
          {
            key: "registry-provider:anthropic-api:claude-b",
            value: "custom:anthropic-api:claude-b",
            name: "claude-b",
          },
        ],
      },
      {
        key: "registry-provider:openai-api",
        label: "OpenAI API",
        labelBadge: "API",
        items: [
          {
            key: "registry-provider:openai-api:model-a",
            value: "custom:openai-api:model-a",
            name: "model-a",
          },
        ],
      },
    ]);
  });

  it("直接把 Registry Account Provider 投影为已选连接，不重新裁决 Family", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan;
    const selectionView: ModelSelectionView = {
      revision: 8,
      providers: [
        {
          providerId,
          providerName: "BigModel Coding Plan",
          config: {
            access: {
              type: "zhipu-account",
              accountType: "bigmodel",
              mode: "team-coding-plan",
              entitled: true,
            },
            api: {
              type: "anthropic-messages",
              baseUrl: "https://example.com/anthropic",
            },
            models: ["GLM-5.2"],
          },
          models: [{ modelId: "GLM-5.2", config: {} }],
        },
      ],
    };

    expect(buildRegistryModelSelectGroups("glm", selectionView)).toEqual([
      {
        key: `registry-provider:${providerId}`,
        label: "BigModel",
        labelBadge: "Team",
        directItems: true,
        items: [
          {
            key: `registry-provider:${providerId}:GLM-5.2`,
            value: "custom:account%3Abigmodel-team-coding-plan:GLM-5.2",
            name: "GLM-5.2",
          },
        ],
      },
    ]);
  });
});
