import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import {
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
  UPSTREAM_THOUGHT_LEVEL,
  ensureUpstreamProviderForE2E,
} from "./e2e/helpers/upstream-provider.js";

const desktopAppMocks = vi.hoisted(() => ({
  clickTestIdByDom: vi.fn(),
  getE2EAppDataPaths: vi.fn(),
  readModelProvider: vi.fn(),
  readModelProviders: vi.fn(),
  setInputValueByTestIdDom: vi.fn(),
  waitForDefaultWorkspaceReady: vi.fn(),
  waitForTestIdByDom: vi.fn(),
  waitForWorkspaceApp: vi.fn(),
}));

vi.mock("./e2e/helpers/desktop-app.js", () => ({
  DEFAULT_WORKSPACE: "/tmp/zcode-e2e-workspace",
  ...desktopAppMocks,
}));

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("Upstream E2E 工具栏偏好种子", () => {
  beforeEach(() => {
    desktopAppMocks.readModelProvider.mockResolvedValue({
      apiKey: "e2e-fixture-key",
      enabled: true,
      models: [{ id: UPSTREAM_MODEL }],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("按默认任务导航作用域的 Recent 协议写入结构化稀疏选择", async () => {
    const storage = createStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("browser", {
      execute: vi.fn(async (script: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        Reflect.apply(script, undefined, args),
      ),
    });

    await ensureUpstreamProviderForE2E({ skipToolbarSelection: true });

    // XCODE: 未保存导航意图时 V4 读取本机任务作用域，旧 workspace key 已不再被消费。
    expect(
      JSON.parse(storage.getItem('zcode-composer-recent:v2:["desktop","local",null]') ?? "null"),
    ).toEqual({
      providerId: UPSTREAM_PROVIDER_ID,
      modelId: UPSTREAM_MODEL,
      ...(UPSTREAM_THOUGHT_LEVEL.trim()
        ? { options: { reasoningLevel: UPSTREAM_THOUGHT_LEVEL.trim() } }
        : {}),
    });
    expect(storage.getItem("zcode-last-agent-provider")).toBe(ZCODE_AGENT_PROVIDER);
  });
});
