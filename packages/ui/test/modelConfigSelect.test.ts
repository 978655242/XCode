// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@zcode/shared";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import {
  isModelSelectGroupSelected,
  ModelConfigSelect,
  MODEL_CONFIG_SELECT_BADGE_CLASS_NAME,
  shouldRenderModelGroupSeparator,
  shouldShowModelProviderLevel,
  type ModelSelectGroup,
} from "@/ModelConfigSelect.js";
import { shouldRestoreChatInputFocusAfterPickerClose } from "@/lib/pickerFocus.js";
import { formatModelContextWindowLabel } from "@/lib/tokenNumberFormat.js";

function createGroup(key: string): ModelSelectGroup {
  return {
    key,
    label: key,
    items: [
      {
        key: `${key}:model`,
        value: `${key}/model`,
        name: "Model",
      },
    ],
  };
}

function renderWithTooltipProvider(element: ReactElement, locale: Locale = "zh-CN") {
  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: locale },
      createElement(TooltipProvider, null, element),
    ),
  );
}

describe("ModelConfigSelect menu hierarchy", () => {
  it("多个 provider 时展示 provider 一级菜单", () => {
    expect(
      shouldShowModelProviderLevel([createGroup("Provider A"), createGroup("Provider B")]),
    ).toBe(true);
  });

  it("单个 provider 时也展示 provider 分组层级", () => {
    expect(shouldShowModelProviderLevel([createGroup("Provider A")])).toBe(true);
    expect(shouldShowModelProviderLevel([])).toBe(false);
  });

  it("单个 provider family 有连接方式时仍展示 provider 一级菜单", () => {
    expect(
      shouldShowModelProviderLevel([
        {
          ...createGroup("BigModel"),
          connectionOptions: [
            {
              key: "coding-plan:account:bigmodel-individual-coding-plan",
              label: "Coding plan",
              value: "custom:account:bigmodel-individual-coding-plan:GLM-5.2",
              providerId: "account:bigmodel-individual-coding-plan",
              familyId: "bigmodel",
              mode: "oauth",
            },
          ],
        },
      ]),
    ).toBe(true);
  });

  it("provider 一级菜单能识别当前选中的 model 所在分组", () => {
    const providerA = createGroup("Provider A");
    const providerB = createGroup("Provider B");

    expect(isModelSelectGroupSelected(providerA, "Provider B/model")).toBe(false);
    expect(isModelSelectGroupSelected(providerB, "Provider B/model")).toBe(true);
  });

  it("family 模型块和普通 provider 区之间展示分割线，普通 provider 之间不展示", () => {
    const bigModelFamily: ModelSelectGroup = {
      ...createGroup("BigModel"),
      key: "family:bigmodel",
      labelBadge: "Individual Plan",
    };
    const openRouter = createGroup("OpenRouter");
    const deepSeek = createGroup("DeepSeek");

    expect(shouldRenderModelGroupSeparator(undefined, bigModelFamily)).toBe(false);
    expect(shouldRenderModelGroupSeparator(bigModelFamily, openRouter)).toBe(true);
    expect(shouldRenderModelGroupSeparator(openRouter, deepSeek)).toBe(false);
  });
});

describe("ModelConfigSelect badge style", () => {
  it("个人和团队连接标签使用无边框的弱表面 pill", () => {
    const classTokens = MODEL_CONFIG_SELECT_BADGE_CLASS_NAME.split(/\s+/);

    expect(classTokens).toEqual(
      expect.arrayContaining([
        "rounded-full",
        "bg-surface",
        "px-1",
        "py-px",
        "text-ui-xs",
        "font-medium",
        "text-foreground-subtle",
      ]),
    );
    expect(classTokens).not.toContain("border");
    expect(classTokens).not.toContain("border-border");
    expect(classTokens).not.toContain("bg-secondary");
    expect(classTokens).not.toContain("text-ui-base");
  });
});

describe("ModelConfigSelect trigger label", () => {
  it("允许调用方省略通用 tooltip 并保留模型名可访问文案", () => {
    const html = renderWithTooltipProvider(
      createElement(ModelConfigSelect, {
        modelGroups: [createGroup("Provider A")],
        normalizedValue: "Provider A/model",
        triggerLabel: "GLM-5",
        showManageModelsAction: false,
        lockReasonMessage: "",
        isItemLocked: () => false,
        onValueChange: () => {},
      }),
    );

    expect(html).toContain('aria-label="GLM-5"');
    expect(html).toContain('title="GLM-5"');
  });

  it("pending 状态下 loading 显示在模型文字后面", () => {
    const html = renderWithTooltipProvider(
      createElement(ModelConfigSelect, {
        modelGroups: [createGroup("Provider A")],
        normalizedValue: "Provider A/model",
        triggerLabel: "Model",
        showManageModelsAction: false,
        lockReasonMessage: "Locked",
        isItemLocked: () => false,
        onValueChange: () => {},
        tooltipTitle: "Choose model",
        pending: true,
        pendingLabel: "Switching model",
      }),
    );

    expect(html.indexOf("Switching model")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Switching model")).toBeLessThan(html.indexOf("lucide-loader"));
  });
});

describe("picker focus restoration", () => {
  it("does not restore chat input focus after closing a picker on coarse touch devices", () => {
    expect(
      shouldRestoreChatInputFocusAfterPickerClose({
        isCoarseTouchDevice: true,
      }),
    ).toBe(false);
  });
});

describe("model capacity labels", () => {
  it("保留精确目录容量，不因 locale 或四舍五入虚增上下文", () => {
    expect(formatModelContextWindowLabel(1_050_000, "zh-CN")).toBe("1.05M");
    expect(formatModelContextWindowLabel(1_048_576, "en-US")).toBe("1.048576M");
    expect(formatModelContextWindowLabel(500_000, "zh-CN")).toBe("500K");
  });
});
