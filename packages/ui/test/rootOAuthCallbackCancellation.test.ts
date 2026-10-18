import { describe, expect, it, vi } from "vitest";

const { effects, errorLog } = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  errorLog: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => unknown) => effects.push(effect),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@/hooks/useAlertDialog.js", () => ({ useAlertDialog: () => vi.fn() }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: () => "登录失败" } }),
}));
vi.mock("@/root/useAccountConnectionLossNotification.js", () => ({
  useAccountConnectionLossNotification: vi.fn(),
}));
vi.mock("@/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: errorLog },
}));
import { useRootOAuthEffects } from "@/root/useRootOAuthEffects.js";

describe("失效 OAuth 回调", () => {
  it.each([true, false])("pollingActive=%s 时静默忽略取消结果", async (oauthPollingActive) => {
    effects.length = 0;
    errorLog.mockClear();
    let callback!: (event: {
      url: string;
      provider: string;
      purpose: "primary-account";
    }) => Promise<void>;
    const handleCallback = vi.fn(async () => null);
    const setUser = vi.fn();
    const setOAuthError = vi.fn();
    const markOAuthSuccess = vi.fn();
    const setOAuthPollingActive = vi.fn();
    useRootOAuthEffects({
      accountIntentKey: "test",
      platform: {
        notifyRendererReady: vi.fn(),
        onOAuthCallback: (handler: typeof callback) => {
          callback = handler;
          return vi.fn();
        },
      } as never,
      services: {
        oauthService: {
          getProviders: vi.fn(async () => [{ id: "bigmodel" }, { id: "zai" }]),
          handleCallback,
        },
        broadcastService: {},
      } as never,
      refreshProviderState: vi.fn(async () => {}),
      setUser,
      setIsRestoringOAuthSession: vi.fn(),
      setOAuthError,
      oauthPollingActive,
      setOAuthPollingActive,
      markOAuthSuccess,
      onReauthenticationRequired: vi.fn(),
    });
    // 只挂载回调订阅；启动恢复和轮询在各自测试中验证。
    effects.at(-1)!();
    await callback({
      url: "zcode://oauth/callback?state=cancelled",
      provider: "bigmodel",
      purpose: "primary-account",
    });
    expect(handleCallback).toHaveBeenCalledWith("zcode://oauth/callback?state=cancelled");
    expect(errorLog).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(setOAuthError).not.toHaveBeenCalled();
    expect(markOAuthSuccess).not.toHaveBeenCalled();
    expect(setOAuthPollingActive).not.toHaveBeenCalled();
  });
});
