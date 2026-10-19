import {
  ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV,
  TID_SETTINGS_ASK_USER_QUESTION_AUTO_RESOLUTION_SWITCH,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared";
import { clearAppData, clickTestIdByDom, readSettings } from "../../../helpers/desktop-app.js";
import { getLatestUpstreamToolResultByToolCallId } from "../../../helpers/conversation-session-network.js";
import {
  prepareConversationE2E,
  sendPrompt,
  waitForAssistantMessageContaining,
  waitForComposerText,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";

const FIRST_PROMPT = "E2E_ASK_AUTO_RESOLUTION_SETTING_FIRST";
const FIRST_ANSWER = "E2E_ASK_AUTO_RESOLUTION_SETTING_FIRST_ANSWER";
const FIRST_FINAL = "E2E_ASK_AUTO_RESOLUTION_SETTING_FIRST_DONE";
const SECOND_PROMPT = "E2E_ASK_AUTO_RESOLUTION_SETTING_SECOND";
const SECOND_FINAL = "E2E_ASK_AUTO_RESOLUTION_SETTING_SECOND_AUTO_DONE";
const FIRST_TOOL_CALL_ID = "toolu_e2e_ask_auto_resolution_first";
const SECOND_TOOL_CALL_ID = "toolu_e2e_ask_auto_resolution_second";

describe("AskUserQuestion 自动继续设置 GUI 候选", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("计时中关闭后跨 deadline 仍等待，重开不追溯，新问题恢复自动继续", async function () {
    this.timeout(180_000);
    const clockScale = requireInjectedClockScale();
    const acceleratedDeadlineMs = Math.ceil(300_000 / clockScale);

    await prepareConversationE2E();
    await setAutoResolutionEnabled(true);

    await sendPrompt(
      `${FIRST_PROMPT}: call AskUserQuestion exactly once, then wait for my answer. ` +
        `After the answer, reply with ${FIRST_FINAL}.`,
    );
    // XCODE: 发送会点击底部输入框；问题面板随后替换在同一位置，必须先移开指针，否则 hover 会按规格暂停倒计时。
    await browser.action("pointer").move({ origin: "viewport", x: 2, y: 2 }).perform();
    await waitForComposerText("", "首个 AskUserQuestion 提交后输入框没有清空");
    await waitForUserMessageContaining(FIRST_PROMPT);
    await waitForElicitationDialog(FIRST_PROMPT);

    await setAutoResolutionEnabled(false);
    await waitForElicitationDialog(FIRST_PROMPT);
    await browser.pause(acceleratedDeadlineMs + 1_000);
    expect(await getLatestUpstreamToolResultByToolCallId(FIRST_TOOL_CALL_ID)).toBeNull();
    await waitForElicitationDialog(FIRST_PROMPT);

    await setAutoResolutionEnabled(true);
    await browser.pause(acceleratedDeadlineMs + 1_000);
    // XCODE: 弹窗消失不等于自动继续；真实选项作答必须以 tool_result 暴露，不能误归因于 deadline。
    expect(await getLatestUpstreamToolResultByToolCallId(FIRST_TOOL_CALL_ID)).toBeNull();
    await waitForElicitationDialog(FIRST_PROMPT);

    await submitCustomAnswer(FIRST_ANSWER);
    await waitForAssistantMessageContaining(FIRST_FINAL);
    const firstResult = await getLatestUpstreamToolResultByToolCallId(FIRST_TOOL_CALL_ID);
    expect(firstResult?.isError).toBe(false);
    expect(firstResult?.content).toContain(FIRST_ANSWER);

    await sendPrompt(
      `${SECOND_PROMPT}: call AskUserQuestion exactly once, then wait for my answer. ` +
        `After automatic continuation, reply with ${SECOND_FINAL}.`,
    );
    await browser.action("pointer").move({ origin: "viewport", x: 2, y: 2 }).perform();
    await waitForComposerText("", "第二个 AskUserQuestion 提交后输入框没有清空");
    await waitForUserMessageContaining(SECOND_PROMPT);
    // XCODE: 计时场景只读观察问题；工具/消息等待器会点击分组，不能在自动继续前制造交互。
    await waitForElicitationDialog(SECOND_PROMPT);
    await browser.waitUntil(
      async () => (await getLatestUpstreamToolResultByToolCallId(SECOND_TOOL_CALL_ID)) !== null,
      {
        timeout: acceleratedDeadlineMs + 5_000,
        timeoutMsg: "新问题没有在实际自动继续后产生 provider-visible tool_result",
      },
    );
    await waitForAssistantMessageContaining(SECOND_FINAL);
    const secondResult = await getLatestUpstreamToolResultByToolCallId(SECOND_TOOL_CALL_ID);
    expect(secondResult?.isError).toBe(false);
    expect(secondResult?.content).toContain("The user did not provide answers to these questions.");
  });
});

function requireInjectedClockScale(): number {
  const rawScale = process.env[ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV]?.trim();
  const scale = Number(rawScale);
  if (!Number.isFinite(scale) || scale < 20 || scale > 30) {
    throw new Error(
      `本候选需要 ${ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV}=20（允许 20-30），` +
        "以 test 环境的可注入 runtime clock 跨越原五分钟 deadline。",
    );
  }
  return scale;
}

async function setAutoResolutionEnabled(enabled: boolean): Promise<void> {
  await openGeneralSettings();
  if ((await readAutoResolutionSwitch()) !== enabled) {
    await clickTestIdByDom(TID_SETTINGS_ASK_USER_QUESTION_AUTO_RESOLUTION_SWITCH, {
      timeout: 15_000,
      timeoutMsg: "提问自动继续开关不可点击",
    });
  }
  await browser.waitUntil(
    async () => {
      const checked = await readAutoResolutionSwitch();
      const persisted = (await readSettings()).askUserQuestionAutoResolutionEnabled;
      return checked === enabled && persisted === enabled;
    },
    {
      timeout: 15_000,
      timeoutMsg: `提问自动继续设置没有持久化为 ${String(enabled)}`,
    },
  );
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "设置页返回按钮没有出现",
  });
}

async function openGeneralSettings(): Promise<void> {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "没有找到设置入口按钮",
  });
  await browser.waitUntil(
    async () =>
      browser.execute(
        (settingsPageTestId) =>
          Boolean(document.querySelector(`[data-testid="${settingsPageTestId}"]`)),
        TID_SETTINGS_PAGE,
      ),
    { timeout: 15_000, timeoutMsg: "设置页没有打开" },
  );
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"), {
    timeout: 15_000,
    timeoutMsg: "设置页没有常规分区入口",
  });
  await browser.waitUntil(async () => (await readAutoResolutionSwitch()) !== null, {
    timeout: 15_000,
    timeoutMsg: "常规设置没有提问自动继续开关",
  });
}

function readAutoResolutionSwitch(): Promise<boolean | null> {
  return browser.execute((switchTestId) => {
    const control = document.querySelector<HTMLElement>(`[data-testid="${switchTestId}"]`);
    if (!control) return null;
    return (
      control.getAttribute("aria-checked") === "true" ||
      control.getAttribute("data-state") === "checked"
    );
  }, TID_SETTINGS_ASK_USER_QUESTION_AUTO_RESOLUTION_SWITCH);
}

async function waitForElicitationDialog(marker: string): Promise<void> {
  let latest = "";
  await browser.waitUntil(
    async () => {
      latest = await browser.execute(() => {
        const body = document.querySelector<HTMLElement>('[data-elicitation-dialog-body="true"]');
        return body?.innerText ?? "";
      });
      return latest.includes(marker);
    },
    {
      timeout: 15_000,
      timeoutMsg: `AskUserQuestion 仍未处于等待态: marker=${marker}; latest=${latest}`,
    },
  );
}

async function submitCustomAnswer(answer: string): Promise<void> {
  const input = await $('[data-elicitation-dialog-body="true"] textarea');
  await input.waitForDisplayed({ timeout: 15_000 });
  await input.setValue(answer);
  const submitted = (await browser.execute(() => {
    const footer = document.querySelector<HTMLElement>('[data-elicitation-dialog-footer="true"]');
    const button = Array.from(footer?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (candidate) => {
        const text = (candidate.textContent ?? "").trim();
        return text === "Submit" || text === "提交";
      },
    );
    button?.click();
    return Boolean(button);
  })) as boolean;
  expect(submitted).toBe(true);
}
