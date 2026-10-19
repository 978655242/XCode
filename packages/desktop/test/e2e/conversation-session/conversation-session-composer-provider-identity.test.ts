import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodePersonalProviderConfigRepository } from "@zcode/provider-node";
import {
  TID_LOGIN_USE_API_KEY_BUTTON,
  TID_TASK_SETTINGS_BUTTON,
  TID_CHAT_MODEL_SELECT_TRIGGER,
} from "@zcode/shared";
import {
  clearAppData,
  DEFAULT_WORKSPACE,
  getE2EAppDataPaths,
  setCurrentElectronRendererContentSize,
  restoreElectronRendererContentSize,
} from "../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  loginWithApiKey,
  switchV4Model,
  getV4ModelConfig,
} from "../helpers/v4-conversation.js";
import { restartIntoWorkspacePreservingProfile } from "../helpers/model-provider-restart-runtime.js";
import { seedReplayProvider } from "../helpers/model-provider-restart.js";

import { skipOccupationOnboardingIfPresent } from "../helpers/occupation-onboarding.js";

const CASE_NAME = "conversation-session-composer-provider-identity";
const evidence = join(
  process.env.ZCODE_E2E_ARTIFACT_DIR ?? join(process.cwd(), ".e2e-artifacts"),
  CASE_NAME,
);
async function settledSnapshot() {
  return browser.execute((testId) => {
    const trigger = document.querySelector(`[data-testid="${testId}"]`)!;
    return {
      prefix: trigger.querySelector(".composer-provider-prefix")?.textContent ?? null,
      title: trigger.querySelector("[title]")?.getAttribute("title") ?? null,
      icon: Boolean(trigger.querySelector("img, svg")),
    };
  }, TID_CHAT_MODEL_SELECT_TRIGGER);
}

describe("Composer provider 身份回归", () => {
  before(async () => {
    await browser.waitUntil(
      async () =>
        browser.execute(
          (login, settings) =>
            Boolean(
              document.querySelector(
                `[data-testid="${login}"], [data-testid="${settings}"], [data-testid="onboarding-page"]`,
              ),
            ),
          TID_LOGIN_USE_API_KEY_BUTTON,
          TID_TASK_SETTINGS_BUTTON,
        ),
      { timeout: 30000 },
    );
    if (await $(`[data-testid="${TID_LOGIN_USE_API_KEY_BUTTON}"]`).isExisting())
      await loginWithApiKey();
    await skipOccupationOnboardingIfPresent();
  });
  after(async () => {
    await clearAppData();
  });

  it("CMP02: bigmodel-api 没有 providerName 时菜单与按钮只显示模型名和图标", async function () {
    this.timeout(120000);
    await prepareV4ConversationE2E();
    await restartIntoWorkspacePreservingProfile(DEFAULT_WORKSPACE, {
      afterElectronProcessExit: async () => {
        await seedReplayProvider({
          id: "bigmodel-api",
          name: "bigmodel-api",
          models: ["GLM-5.3"],
        });
        const repo = new NodePersonalProviderConfigRepository({
          filePath: getE2EAppDataPaths().configFile,
          pollingIntervalMs: false,
        });
        try {
          await repo.update((current) => {
            const rule = current.providers.getRule("bigmodel-api")!;
            return {
              ...current,
              providers: current.providers.setRule({
                ...rule,
                providerName: null,
              }),
            };
          });
        } finally {
          repo.dispose();
        }
      },
    });
    await switchV4Model("bigmodel-api", "GLM-5.3", "");
    assert.equal((await getV4ModelConfig()).provider, "bigmodel-api");
    const original = await setCurrentElectronRendererContentSize(1600, 760);
    try {
      const trigger = $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`);
      await trigger.click();
      const menu = await $('[role="menu"]').getText();
      assert.ok(menu.includes("GLM-5.3"), "菜单必须展示模型");
      assert.ok(menu.includes("自定义模型"), "自配模型归入「自定义模型」分组");
      assert.ok(!menu.includes("bigmodel-api"), "composer 菜单不显示具体供应商");
      await browser.keys("Escape");
      // rolling 动画短暂保留旧标签；等待实际展示收敛，避免读取退场节点。
      await browser.waitUntil(
        async () => {
          const current = await settledSnapshot();
          return current.prefix === null && current.title === "GLM-5.3";
        },
        { timeout: 5000, timeoutMsg: "模型按钮未收敛到仅模型名" },
      );
      const state = await settledSnapshot();
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, "nameless-provider.json"), JSON.stringify(state, null, 2));
      await browser.saveScreenshot(join(evidence, "nameless-provider.png"));
      assert.equal(state.prefix, null);
      assert.equal(state.title, "GLM-5.3");
      assert.ok(state.icon, "模型名前必须显示图标");
    } finally {
      await restoreElectronRendererContentSize(original);
    }
  });
});
