import { describe, expect, it } from "vitest";
import enUS from "@/i18n/locales/en-US.js";
import zhCN from "@/i18n/locales/zh-CN.js";

describe("onboarding welcome i18n", () => {
  // 缺失 key 会被 IntlProvider 原样显示，既破坏引导文案，也会污染复用按钮文案的埋点。
  it.each([
    ["start", "开始使用", "Get started"],
    ["continue", "下一步", "Next"],
    ["saving", "正在保存…", "Saving…"],
    ["back", "返回", "Back"],
    ["error", "保存失败，请重试。", "Failed to save. Please try again."],
  ])("provides translated onboarding %s text in both locales", (key, chinese, english) => {
    const id = `occupationOnboarding.${key}`;
    expect(zhCN[id]).toBe(chinese);
    expect(enUS[id]).toBe(english);
  });
});
