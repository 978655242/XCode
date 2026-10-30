// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AISCOO_ASSET_URLS,
  AiscooIntlProvider,
  AiscooLoginHeader,
  resolveAiscooOAuthWaitingDisplayNames,
} from "@/aiscoo/brand/index.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { WelcomeScreen } from "@/WelcomeScreen.js";

const oauthState = vi.hoisted(() => ({
  status: "idle" as "idle" | "waiting" | "error",
  manualAuthorizationUrl: null as string | null,
  providerId: "new-api",
  providerName: "New API",
  cancel: vi.fn(),
  startLogin: vi.fn(),
  startLoginFromUserGesture: vi.fn(),
}));

vi.mock("@/hooks/useOAuth.js", () => ({
  useOAuth: () => ({
    startLogin: oauthState.startLogin,
    startLoginFromUserGesture: oauthState.startLoginFromUserGesture,
    cancel: oauthState.cancel,
    reset: vi.fn(),
    status: oauthState.status,
    error: oauthState.status === "error" ? "登录失败，请重试" : null,
    providers: [
      { id: oauthState.providerId, displayName: oauthState.providerName, enabled: true, order: 0 },
    ],
    loadingProviders: false,
    pendingProvider: oauthState.status === "waiting" ? oauthState.providerId : null,
    manualAuthorizationUrl: oauthState.manualAuthorizationUrl,
    refreshProviders: vi.fn(),
  }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: null,
      oauthError: null,
      oauthSuccessSeq: 0,
      lastOAuthSuccessProvider: null,
      loginEntryRequest: null,
      setOAuthError: vi.fn(),
      clearLoginEntryRequest: vi.fn(),
      markLoginEntryAttemptStatus: vi.fn(),
      theme: "zai-light",
    }),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({ executeDesktopCommand: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  oauthState.providerId = "new-api";
  oauthState.providerName = "New API";
  oauthState.cancel.mockClear();
  oauthState.startLogin.mockClear();
  oauthState.startLoginFromUserGesture.mockClear();
});

describe("Aiscoo 登录页完整字标", () => {
  it("未传品牌头部插槽时保留原默认标题、说明和图标", () => {
    oauthState.status = "idle";
    render(
      createElement(ZCodeIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, { onComplete: vi.fn() }),
      }),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("XWork");
    expect(screen.getByText("连接账号，开始使用 XWork", { exact: true })).toBeTruthy();
    expect(screen.getByRole("img", { name: "XWork" })).toBeTruthy();
  });

  it.each(["idle", "waiting", "error"] as const)("%s 状态展示可访问的完整主题字标", (status) => {
    oauthState.status = status;
    render(
      createElement(AiscooIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, {
          onComplete: vi.fn(),
          header: createElement(AiscooLoginHeader),
        }),
      }),
    );

    const logo = screen.getByRole("img", { name: "Aiscoo" });
    const graphic = logo.querySelector('[data-aiscoo-brand="wordmark-animated"]');
    const still = logo.querySelector('[data-aiscoo-brand="wordmark"]');
    expect(graphic).not.toBeNull();
    expect(graphic?.getAttribute("viewBox")).toBe("0 0 615.58 200");
    expect(graphic?.classList.contains("motion-reduce:hidden")).toBe(true);
    expect(still?.classList.contains("motion-reduce:block")).toBe(true);
    const sources = Array.from(graphic!.querySelectorAll("image"), (image) =>
      image.getAttribute("href"),
    );
    expect(sources).toEqual([
      AISCOO_ASSET_URLS.wordmarkAnimated.light,
      AISCOO_ASSET_URLS.wordmarkAnimated.dark,
    ]);
    expect(logo.querySelector('[data-aiscoo-brand="mark"]')).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByText("连接账号，开始使用", { exact: true })).toBeTruthy();
    expect(screen.queryByText("连接账号，开始使用 Aiscoo")).toBeNull();
    if (status === "error") {
      expect(screen.getByText("登录失败，请重试")).toBeTruthy();
    }
  });
  it("品牌登录页主按钮只显示“登录”，且可隐藏 API key 入口", () => {
    oauthState.status = "idle";
    render(
      createElement(AiscooIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, {
          onComplete: vi.fn(),
          header: createElement(AiscooLoginHeader),
          hideApiKeyLogin: true,
        }),
      }),
    );
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
    expect(screen.queryByText(/New API/)).toBeNull();
    expect(screen.queryByText("使用 API key")).toBeNull();
  });

  it.each([
    ["zh-CN", "等待 aiscoo 完成认证..."],
    ["en-US", "Waiting for aiscoo authentication..."],
  ] as const)("%s 等待提示使用 aiscoo，取消仍使用原 provider ID", (locale, text) => {
    oauthState.status = "waiting";
    render(
      createElement(AiscooIntlProvider, {
        initialLocale: locale,
        children: createElement(WelcomeScreen, {
          onComplete: vi.fn(),
          oauthWaitingDisplayNames: resolveAiscooOAuthWaitingDisplayNames(),
        }),
      }),
    );
    expect(screen.getByText(text)).toBeTruthy();
    fireEvent.click(screen.getByTestId("oauth-cancel"));
    expect(oauthState.cancel).toHaveBeenCalledExactlyOnceWith("new-api");
  });

  it("未传等待展示名映射时保留上游 provider 名称", () => {
    oauthState.status = "waiting";
    render(
      createElement(ZCodeIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, { onComplete: vi.fn() }),
      }),
    );
    expect(screen.getByText("等待 New API 完成认证...")).toBeTruthy();
  });

  it("其他 provider 继续使用原名称", () => {
    oauthState.status = "waiting";
    oauthState.providerId = "bigmodel";
    oauthState.providerName = "BigModel";
    const view = render(
      createElement(AiscooIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, {
          onComplete: vi.fn(),
          oauthWaitingDisplayNames: resolveAiscooOAuthWaitingDisplayNames(),
        }),
      }),
    );
    expect(screen.getByText("等待 BigModel 完成认证...")).toBeTruthy();
    oauthState.providerId = "unknown-provider";
    oauthState.providerName = "Custom Provider";
    view.rerender(
      createElement(AiscooIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, {
          onComplete: vi.fn(),
          oauthWaitingDisplayNames: resolveAiscooOAuthWaitingDisplayNames(),
        }),
      }),
    );
    expect(screen.getByText("等待 Custom Provider 完成认证...")).toBeTruthy();
  });

  it("弹窗被阻止时显示安全的手动授权链接", () => {
    oauthState.status = "waiting";
    oauthState.manualAuthorizationUrl = "https://example.test/authorize?state=synthetic";
    try {
      render(
        createElement(AiscooIntlProvider, {
          initialLocale: "zh-CN",
          children: createElement(WelcomeScreen, { onComplete: vi.fn() }),
        }),
      );
      const link = screen.getByRole("link", { name: "打开登录页面" });
      expect(link.getAttribute("href")).toBe(oauthState.manualAuthorizationUrl);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(screen.queryByText(/synthetic/)).toBeNull();
    } finally {
      oauthState.manualAuthorizationUrl = null;
    }
  });

  it.each(["idle", "error"] as const)("%s 状态点击同步使用手势登录入口", (status) => {
    oauthState.status = status;
    render(
      createElement(AiscooIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, { onComplete: vi.fn() }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: status === "idle" ? "登录" : "重新登录" }));
    expect(oauthState.startLoginFromUserGesture).toHaveBeenCalledExactlyOnceWith(
      "new-api",
      undefined,
    );
    expect(oauthState.startLogin).not.toHaveBeenCalled();
  });

  it("未传 hideApiKeyLogin 时保留上游 API key 入口", () => {
    oauthState.status = "idle";
    render(
      createElement(ZCodeIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, { onComplete: vi.fn() }),
      }),
    );
    expect(screen.getByText("使用 API key")).toBeTruthy();
  });
});
