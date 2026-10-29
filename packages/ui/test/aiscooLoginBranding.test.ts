// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AISCOO_ASSET_URLS, AiscooIntlProvider } from "@/xwork/brand/index.js";
import { WelcomeScreen } from "@/WelcomeScreen.js";

const oauthState = vi.hoisted(() => ({
  status: "idle" as "idle" | "waiting" | "error",
}));

vi.mock("@/hooks/useOAuth.js", () => ({
  useOAuth: () => ({
    startLogin: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    status: oauthState.status,
    error: oauthState.status === "error" ? "登录失败，请重试" : null,
    providers: [{ id: "new-api", displayName: "Aiscoo", enabled: true, order: 0 }],
    loadingProviders: false,
    pendingProvider: oauthState.status === "waiting" ? "new-api" : null,
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

afterEach(cleanup);

describe("Aiscoo 登录页完整字标", () => {
  it.each(["idle", "waiting", "error"] as const)("%s 状态展示可访问的完整主题字标", (status) => {
    oauthState.status = status;
    render(
      createElement(AiscooIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(WelcomeScreen, { onComplete: vi.fn() }),
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
