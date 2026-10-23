import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("model provider restart runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each([false, true])("重启断言读取 Recent 新旧结构（包含模式=%s）", async (withMode) => {
    const selection = {
      providerId: "provider-a",
      modelId: "model-a",
      options: { reasoningLevel: "high" },
    };
    const record = withMode ? { modelSelection: selection, mode: "yolo" } : selection;
    // XCODE: helper 先读 Composer 作用域键（为空时回退本机任务作用域），只有 Recent v2 键返回记录。
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) =>
          key.startsWith("zcode-composer-recent:v2:") ? JSON.stringify(record) : null,
      },
    });
    vi.stubGlobal("browser", {
      execute: async (script: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        Reflect.apply(script, undefined, args),
    });
    const { readLastSelectedAgentConfig } = await import("./e2e/helpers/model-provider-restart.js");
    expect(await readLastSelectedAgentConfig()).toEqual({
      schemaVersion: 1,
      model: "provider-a/model-a",
      thoughtLevel: "high",
    });
  });

  it("Recent 只有 mode 时不伪造模型配置", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) =>
          key.startsWith("zcode-composer-recent:v2:") ? JSON.stringify({ mode: "yolo" }) : null,
      },
    });
    vi.stubGlobal("browser", {
      execute: async (script: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        Reflect.apply(script, undefined, args),
    });
    const { readLastSelectedAgentConfig } = await import("./e2e/helpers/model-provider-restart.js");

    expect(await readLastSelectedAgentConfig()).toBeNull();
  });

  it("通过正式 Model Selection Config 设置冷启动默认模型", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "zcode-restart-selection-"));
    vi.stubEnv("ZCODE_E2E_HOME_DIR", homeDir);
    const { seedTurboAgentStartupModel } =
      await import("./e2e/helpers/model-provider-restart-runtime.js");

    await seedTurboAgentStartupModel("provider-a", "model-a");

    expect(
      JSON.parse(await readFile(join(homeDir, ".zcode", "v2", "provider_config.json"), "utf-8")),
    ).toEqual({
      schemaVersion: 1,
      config: {
        providerOrder: [],
        providerConfigRules: { providerRules: [] },
        modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
        defaultModelSelection: { providerId: "provider-a", modelId: "model-a" },
      },
    });
    await expect(
      stat(join(homeDir, "ZCodeProject", ".zcode", "config.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
