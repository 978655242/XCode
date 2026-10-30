// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TID_OAUTH_COPY_LOGIN_LINK } from "@zcode/shared/test-ids";
import type { OAuthProviderMeta } from "@zcode/shared";
import { AISCOO_ASSET_URLS, AiscooIntlProvider, AiscooLoginHeader } from "@/xwork/brand/index.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { WelcomeScreen } from "@/WelcomeScreen.js";

const oauthState = vi.hoisted(() => ({
  status: "idle" as "idle" | "waiting" | "error",
  providers: [
    { id: "new-api", displayName: "New API", enabled: true, order: 0 },
  ] as OAuthProviderMeta[],
  startLogin: vi.fn(),
  cancel: vi.fn(),
  authorizeUrl: null as string | null,
}));

vi.mock("@/hooks/useOAuth.js", () => ({
  useOAuth: () => ({
    startLogin: oauthState.startLogin,
    cancel: oauthState.cancel,
    reset: vi.fn(),
    status: oauthState.status,
    error: oauthState.status === "error" ? "登录失败，请重试" : null,
    providers: oauthState.providers,
    loadingProviders: false,
    pendingProvider: oauthState.status === "waiting" ? "new-api" : null,
    authorizeUrl: oauthState.authorizeUrl,
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

vi.mock("@/login/LoginApiKeyForm.js", () => ({
  LoginApiKeyForm: () => createElement("div", { "data-testid": "api-key-form-fixture" }),
}));

afterEach(() => {
  cleanup();
  oauthState.status = "idle";
  oauthState.authorizeUrl = null;
  oauthState.providers = [{ id: "new-api", displayName: "New API", enabled: true, order: 0 }];
  oauthState.startLogin.mockClear();
  oauthState.cancel.mockClear();
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

  it.each([
    ["zh-CN", "登录", "使用 API key"],
    ["en-US", "Sign in", "Use API key"],
  ] as const)(
    "%s 产品登录按钮隐藏后端名称和 API key，但保留原 provider",
    (locale, login, apiKey) => {
      render(
        createElement(AiscooIntlProvider, {
          initialLocale: locale,
          children: createElement(WelcomeScreen, {
            onComplete: vi.fn(),
            header: createElement(AiscooLoginHeader),
            hideApiKeyLogin: true,
          }),
        }),
      );
      expect(screen.queryByText(apiKey)).toBeNull();
      expect(screen.queryByText(/New API/u)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: login }));
      expect(oauthState.startLogin).toHaveBeenCalledExactlyOnceWith("new-api", undefined);
    },
  );

  it.each([
    ["zh-CN", "登录 New API", "使用 API key"],
    ["en-US", "Sign in to New API", "Use API key"],
  ] as const)("%s 默认欢迎页保留原文案和可打开的 API key 表单", (locale, login, apiKey) => {
    render(
      createElement(ZCodeIntlProvider, {
        initialLocale: locale,
        children: createElement(WelcomeScreen, { onComplete: vi.fn() }),
      }),
    );
    expect(screen.getByRole("button", { name: login })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: apiKey }));
    expect(screen.getByTestId("api-key-form-fixture")).toBeTruthy();
  });

  it("其他登录提供方仍保留真实名称和原有选择", () => {
    oauthState.providers = [
      { id: "zai", displayName: "Z.ai", enabled: true, order: 1 },
      { id: "bigmodel", displayName: "BigModel", enabled: true, order: 0 },
    ];
    render(
      createElement(AiscooIntlProvider, {
        initialLocale: "en-US",
        children: createElement(WelcomeScreen, {
          onComplete: vi.fn(),
          hideApiKeyLogin: true,
        }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Connect to Z\.ai/u }));
    expect(screen.getByRole("button", { name: /Connect to BigModel/u })).toBeTruthy();
    expect(oauthState.startLogin).toHaveBeenCalledExactlyOnceWith("zai", undefined);
    expect(screen.queryByRole("button", { name: "Use API key" })).toBeNull();
  });

  it("等待时取消和失败后重试仍沿用原 provider", () => {
    oauthState.status = "waiting";
    const onComplete = vi.fn();
    const renderScreen = () =>
      createElement(AiscooIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, {
          onComplete,
          hideApiKeyLogin: true,
        }),
      });
    const view = render(renderScreen());
    fireEvent.click(screen.getByTestId("oauth-cancel"));
    expect(oauthState.cancel).toHaveBeenCalledWith("new-api");
    oauthState.status = "error";
    view.rerender(renderScreen());
    fireEvent.click(screen.getByRole("button", { name: "重新登录" }));
    expect(oauthState.startLogin).toHaveBeenCalledExactlyOnceWith("new-api", undefined);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("新版等待页在 Aiscoo 字标下复制当前登录链接，取消后不保留旧链接", async () => {
    oauthState.status = "waiting";
    oauthState.authorizeUrl = "https://account.example.test/authorize?state=fixture";
    const writeText = vi.fn(async () => {});
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      const renderScreen = () =>
        createElement(AiscooIntlProvider, {
          initialLocale: "zh-CN",
          children: createElement(WelcomeScreen, {
            onComplete: vi.fn(),
            header: createElement(AiscooLoginHeader),
            hideApiKeyLogin: true,
          }),
        });
      const view = render(renderScreen());
      expect(screen.getByRole("img", { name: "Aiscoo" })).toBeTruthy();
      fireEvent.click(screen.getByTestId(TID_OAUTH_COPY_LOGIN_LINK));
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledExactlyOnceWith(oauthState.authorizeUrl),
      );
      oauthState.status = "idle";
      oauthState.authorizeUrl = null;
      view.rerender(renderScreen());
      expect(screen.queryByTestId(TID_OAUTH_COPY_LOGIN_LINK)).toBeNull();
    } finally {
      if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
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
});
