import { describe, expect, it } from "vitest";
import { zcodeSessionSendParamsSchema } from "@zcode/shared";
import { createModelExecutionContext } from "../src/session-execution/index.js";

describe("请求期 Key ID 执行上下文", () => {
  it("协议与冻结投影保留真实 ID，不将其加入模型 Header", async () => {
    const requestAuth = { apiKey: "pat", apiKeyId: "real-key-id", accountScope: "a".repeat(64) };
    const execution = createModelExecutionContext(
      zcodeSessionSendParamsSchema.shape.modelExecution
        .unwrap()
        .parse({ selectionScope: "execution", requestAuth }),
    );
    const value = await execution.requestDependencies?.requestAuth?.source?.resolve({
      attempt: 1,
      providerId: "account:bigmodel-off-peak",
      modelId: "glm",
    });
    expect(value).toEqual(requestAuth);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("执行代际仅投影到请求依赖，不混入鉴权值或可持久化 intent", async () => {
    const executionIdentity = `official-cloud:sha256:${"b".repeat(64)}`;
    const input = zcodeSessionSendParamsSchema.shape.modelExecution.unwrap().parse({
      selectionScope: "execution",
      requestAuth: { apiKey: "pat", executionIdentity },
    });
    const execution = createModelExecutionContext(input);
    expect(execution.requestDependencies?.requestAuth?.executionIdentity).toBe(executionIdentity);
    await expect(
      execution.requestDependencies?.requestAuth?.source?.resolve({
        attempt: 1,
        providerId: "account:bigmodel-offpeak-idle-plan",
        modelId: "glm",
      }),
    ).resolves.toEqual({ apiKey: "pat" });
    expect(execution).not.toHaveProperty("intent");
  });

  it("原样透传 selectionFallback 声明，包括发起方声明的退回目标", () => {
    // 退回目标必须完整到达 core：冷恢复竞态下 runtime 可能没有常驻选择，这是唯一的退回依据。
    const selectionFallback = {
      providerId: "account:bigmodel-highspeed-card",
      rules: [
        { reason: "highspeed_card_expired" as const, providerErrorCode: "3402" },
        { reason: "highspeed_request_failed" as const },
      ],
      target: {
        providerId: "account:bigmodel-team-coding-plan",
        modelId: "GLM-5.3",
        options: { reasoningLevel: "low" },
      },
    };
    const execution = createModelExecutionContext(
      zcodeSessionSendParamsSchema.shape.modelExecution
        .unwrap()
        .parse({ selectionScope: "execution", selectionFallback }),
    );
    expect(execution.selectionFallback).toEqual(selectionFallback);
  });
});
