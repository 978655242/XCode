import type { IServiceAccessor } from "@zcode/services";
import { TID_CHAT_ERROR_BANNER, TID_CHAT_MODEL_SELECT_TRIGGER } from "@zcode/shared/test-ids";
import { clearAppData, DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import {
  prepareHighspeedDrawWorkspace,
  waitForHighspeedComposerCleared,
} from "../../../helpers/highspeed-card.js";
import {
  E2E_BIGMODEL_PLAN_PROVIDER_ID,
  E2E_PLAN_FIRST_MODEL,
  seedReplayProvider,
  waitForSelectedModel,
} from "../../../helpers/model-provider-restart.js";
import { startDraftFromProject } from "../../../helpers/project-sidebar.js";
import {
  selectRegistryProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../../../helpers/upstream-provider.js";
import {
  assertVisibleV4UserMessagesNotContaining,
  sendV4Prompt,
  waitForV4ComposerText,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";

const PROMPT = "E2E_HIGHSPEED_ADMISSION_RETAINS_DRAFT";
const RECOVERY_PROVIDER_ID = "highspeed-admission-recovery";
const RECOVERY_MODEL_ID = "recovery-model";

type HighspeedProbeServices = {
  highspeedCardService: IServiceAccessor["highspeedCardService"];
  readonly oauthService: IServiceAccessor["oauthService"];
  readonly providerSettingsService: IServiceAccessor["providerSettingsService"];
};

declare global {
  interface Window {
    __restoreHighspeedAdmissionRegistryRace?: () => void;
    __highspeedAdmissionRegistryRaceCompleted?: boolean;
  }
}

/**
 * 在 draw 已命中、sendText 尚未进入 Agent admission 的唯一窗口撤销 Coding Plan。
 * 该探针只制造真实 Registry 变化，不伪造 Command ACK 或 Renderer 状态。
 */
async function installHighspeedAdmissionRegistryRace() {
  await browser.execute(() => {
    const element = document.querySelector('[data-testid="v4-model-config"]');
    if (!element) throw new Error("Highspeed admission probe 找不到模型配置入口");
    const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber"));
    let fiber: unknown = fiberKey ? Reflect.get(element, fiberKey) : undefined;
    let services: HighspeedProbeServices | undefined;
    while (fiber && typeof fiber === "object") {
      const props: unknown = Reflect.get(fiber, "memoizedProps");
      const value =
        props && typeof props === "object" && "value" in props ? props.value : undefined;
      const candidate =
        value && typeof value === "object" && "highspeedCardService" in value
          ? value
          : props && typeof props === "object" && "services" in props
            ? props.services
            : undefined;
      if (
        candidate &&
        typeof candidate === "object" &&
        "highspeedCardService" in candidate &&
        "providerSettingsService" in candidate &&
        "oauthService" in candidate
      ) {
        // XCODE: 这是 ServiceProvider 注入的同进程 IServiceAccessor，不是网络或持久化数据。
        const matchedServices = candidate as HighspeedProbeServices;
        services = matchedServices;
        break;
      }
      fiber = Reflect.get(fiber, "return");
    }
    if (!services) throw new Error("Highspeed admission probe 找不到 Workspace services");
    const probeServices = services;

    const highspeed = probeServices.highspeedCardService;
    const originalPrepareTurn = highspeed.prepareTurn;
    window.__restoreHighspeedAdmissionRegistryRace = () => {
      probeServices.highspeedCardService = highspeed;
      delete window.__highspeedAdmissionRegistryRaceCompleted;
      delete window.__restoreHighspeedAdmissionRegistryRace;
    };
    window.__highspeedAdmissionRegistryRaceCompleted = false;
    const prepareTurn: HighspeedProbeServices["highspeedCardService"]["prepareTurn"] = async (
      params,
    ) => {
      const result = await originalPrepareTurn.call(highspeed, params);
      if (result?.kind !== "accelerated") return result;

      // Bug 复现：抽卡时普通模型存在；命令 admission 前账号 Provider 与派生 Provider 同时下架。
      await probeServices.oauthService.logoutAll();
      await probeServices.providerSettingsService.refresh("e2e-highspeed-admission-registry-race");
      window.__highspeedAdmissionRegistryRaceCompleted = true;
      return result;
    };
    // XCODE: RPC get trap 忽略方法属性赋值；在服务容器外层拦截并透传其他真实方法。
    probeServices.highspeedCardService = new Proxy(highspeed, {
      get(target, property, receiver) {
        return property === "prepareTurn" ? prepareTurn : Reflect.get(target, property, receiver);
      },
    });
  });
}

async function restoreHighspeedAdmissionRegistryRace() {
  await browser.execute(() => {
    window.__restoreHighspeedAdmissionRegistryRace?.();
  });
}

describe("Highspeed card admission rejection E2E", () => {
  after(async () => {
    await restoreHighspeedAdmissionRegistryRace().catch(() => undefined);
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("HS-E2E-04: Highspeed 与退回目标都不可用时恢复输入并退出加速态", async function () {
    this.timeout(180000);

    // 保留一个非账号 Provider。账号退出后 Registry 仍有可选模型，断言按钮解除的确是
    // Highspeed 锁，而不是把“Registry 为空”的合法禁用误判为产品回归。
    await seedReplayProvider({
      id: RECOVERY_PROVIDER_ID,
      models: [RECOVERY_MODEL_ID],
      name: "Highspeed Admission Recovery",
    });
    await prepareHighspeedDrawWorkspace();
    await installHighspeedAdmissionRegistryRace();
    // XCODE: 通过真实草稿切换重渲染，让 SessionPane 捕获已安装的服务拦截器。
    await startDraftFromProject(DEFAULT_WORKSPACE);
    // XCODE: 账号连接行独立于 Registry 模型分组，沿用 CTP 的真实 Team 入口。
    await $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`).click();
    await $('[data-testid="composer-provider-trigger"]').click();
    const team = $('[aria-label="BigModel Team Org"]');
    await team.waitForClickable({ timeout: 15000 });
    await team.click();
    await browser.keys("Escape");
    await selectRegistryProviderModelById(E2E_PLAN_FIRST_MODEL, {
      includePlainModelFallback: false,
      providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
      providerName: "BigModel Coding Plan",
    });
    await selectUpstreamThoughtLevelValue("high");
    await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, E2E_PLAN_FIRST_MODEL);
    await sendV4Prompt(PROMPT);
    await browser.waitUntil(
      () => browser.execute(() => window.__highspeedAdmissionRegistryRaceCompleted === true),
      { timeout: 30000, timeoutMsg: "Highspeed 准入探针没有执行真实退出与 Registry 刷新" },
    );

    await waitForV4ComposerText(PROMPT, "Highspeed 准入拒绝后 Composer 没有恢复原输入", 30000);
    await waitForHighspeedComposerCleared("Highspeed 准入拒绝后输入框仍处于加速态");
    const pane = await waitForV4Pane(
      (snapshot) => snapshot.rowCount === 0 && !snapshot.canStop,
      "ACK 前拒绝的输入不应出现在 timeline",
    );
    // XCODE: 空会话的 pane 文本含恢复的 Composer 草稿，只按真实消息行判断准入结果。
    expect(pane.rowCount).toBe(0);
    await assertVisibleV4UserMessagesNotContaining(PROMPT);
    expect(await $(`[data-testid="${TID_CHAT_ERROR_BANNER}"]`).isExisting()).toBe(false);

    const modelTrigger = $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`);
    await modelTrigger.waitForExist({ timeout: 15000 });
    await browser.waitUntil(
      async () =>
        (await modelTrigger.isEnabled()) &&
        (await modelTrigger.getAttribute("aria-disabled")) !== "true",
      { timeout: 15000, timeoutMsg: "Highspeed 准入拒绝后模型选择器没有解除锁定" },
    );
    await modelTrigger.click();
    await browser.waitUntil(
      async () => (await modelTrigger.getAttribute("aria-expanded")) === "true",
      { timeout: 15000, timeoutMsg: "Highspeed 准入拒绝后模型选择器仍无法打开" },
    );
    await browser.keys("Escape");
  });
});
