import { describe, expect, it } from "vitest";
import { resolveLobeIcon } from "@/components/LobeIcon.js";
import { resolveModelLobeIcon } from "@/lib/modelBrandLogo.js";

describe("resolveModelLobeIcon", () => {
  it.each([
    ["claude-sonnet-4.5", "Claude.Color"],
    ["gpt-5-codex", "OpenAI"],
    ["deepseek-flash", "DeepSeek.Color"],
    ["MiniMax-M2", "Minimax.Color"],
    ["kimi-k2", "Moonshot"],
    ["GLM-5.3-Flash", "ZAI"],
    ["qwen3-coder", "Qwen.Color"],
  ])("%s 映射到与后端一致的图标名 %s，且有对应资源", (modelId, name) => {
    expect(resolveModelLobeIcon(modelId)).toBe(name);
    expect(resolveLobeIcon(name)).not.toBeNull();
  });

  it("未识别模型返回 undefined，不猜厂商", () => {
    expect(resolveModelLobeIcon("custom-model")).toBeUndefined();
  });
});
