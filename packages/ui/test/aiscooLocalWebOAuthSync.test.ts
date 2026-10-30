// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Emitter } from "@zcode/rpc";
import type { IServiceAccessor } from "@zcode/services";
import type {
  IPlatformService,
  OAuthCachedSessionRestoreResult,
  OAuthSessionState,
} from "@zcode/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRootOAuthEffects } from "@/root/useRootOAuthEffects.js";
import { aiscooLocalWebOAuthLifecycle } from "@/aiscoo/local-web-oauth/index.js";

const { requestAlert, intl } = vi.hoisted(() => ({
  requestAlert: vi.fn(async () => false),
  intl: { formatMessage: ({ id }: { id: string }) => id },
}));
vi.mock("@/hooks/useAlertDialog.js", () => ({ useAlertDialog: () => requestAlert }));
vi.mock("@/i18n/IntlProvider.js", () => ({ useZCodeIntl: () => ({ intl }) }));
vi.mock("@/root/useAccountConnectionLossNotification.js", () => ({
  useAccountConnectionLossNotification: vi.fn(),
}));
vi.mock("@/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const userA = { id: "user-a", username: "a", displayName: "A" };
const userB = { id: "user-b", username: "b", displayName: "B" };
const authenticated = (userInfo = userA): OAuthCachedSessionRestoreResult => ({
  status: "authenticated",
  userInfo,
});

function setup(options: { local?: boolean; provider?: string; desktop?: boolean } = {}) {
  const session = new Emitter<OAuthSessionState>();
  let activeProvider: string | null = null;
  let snapshot: OAuthCachedSessionRestoreResult = { status: "signed-out" };
  let notifyProviderChange: (() => void) | undefined;
  const dispose = vi.fn();
  const onDidChangeSession = vi.fn((handler: (state: OAuthSessionState) => void) => {
    const subscription = session.event(handler);
    return {
      dispose: () => {
        dispose();
        subscription.dispose();
      },
    };
  });
  const oauthService = {
    onDidChangeSession,
    getProviders: vi.fn(async () => [{ id: options.provider ?? "new-api" }]),
    getActiveProvider: vi.fn(async () => activeProvider),
    restoreCachedSessionState: vi.fn(async () => snapshot),
  };
  const services = {
    oauthService,
    providerSettingsService: {
      onDidChange: vi.fn((handler: () => void) => {
        notifyProviderChange = handler;
        return { dispose: vi.fn() };
      }),
    },
    broadcastService: { onMessage: vi.fn(() => ({ dispose: vi.fn() })) },
  } as unknown as IServiceAccessor;
  const platform = {
    ...(options.local
      ? { aiscooLocalWebOAuthSync: true, oauthLifecycle: aiscooLocalWebOAuthLifecycle }
      : {}),
    canOpenLocalFiles: Boolean(options.desktop),
    onOAuthCallback: vi.fn(() => vi.fn()),
    notifyRendererReady: vi.fn(),
  } as unknown as IPlatformService;
  const setUser = vi.fn();
  const setOAuthError = vi.fn();
  const setIsRestoringOAuthSession = vi.fn();
  const markOAuthSuccess = vi.fn();
  const refreshProviderState = vi.fn(async () => {});
  const setOAuthPollingActive = vi.fn();
  const onReauthenticationRequired = vi.fn();
  const params = {
    accountIntentKey: "test",
    platform,
    services,
    setUser,
    setOAuthError,
    setIsRestoringOAuthSession,
    markOAuthSuccess,
    refreshProviderState,
    setOAuthPollingActive,
    onReauthenticationRequired,
    oauthPollingActive: false,
  };
  const mount = (strictMode = false) =>
    renderHook(() => useRootOAuthEffects(params), { reactStrictMode: strictMode });
  const publish = (state: OAuthSessionState) => act(() => session.fire(state));
  const setOwner = (provider: string | null, next: OAuthCachedSessionRestoreResult) => {
    activeProvider = provider;
    snapshot = next;
  };
  const clearEffects = () => {
    setUser.mockClear();
    setOAuthError.mockClear();
    markOAuthSuccess.mockClear();
    refreshProviderState.mockClear();
    oauthService.getActiveProvider.mockClear();
    oauthService.restoreCachedSessionState.mockClear();
  };
  return {
    mount,
    publish,
    setOwner,
    clearEffects,
    oauthService,
    services,
    setUser,
    setOAuthError,
    setIsRestoringOAuthSession,
    markOAuthSuccess,
    refreshProviderState,
    dispose,
    providerSettingsService: services.providerSettingsService,
    notifyProviderChange: () => notifyProviderChange?.(),
  };
}

async function finishStartup(test: ReturnType<typeof setup>) {
  await waitFor(() => expect(test.setIsRestoringOAuthSession).toHaveBeenCalledWith(false));
  test.clearEffects();
}

describe("独立本机 Web OAuth 会话投影", () => {
  it("provider 查询失败时不能应用未确认的旧官方用户", async () => {
    const test = setup({ local: true });
    test.oauthService.getProviders.mockRejectedValue(new Error("offline"));
    test.setOwner("bigmodel", authenticated());
    test.mount();
    await waitFor(() => expect(test.setIsRestoringOAuthSession).toHaveBeenCalledWith(false));
    expect(test.setUser).not.toHaveBeenCalledWith(userA);
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("事件订阅失败不会让 Root 崩溃或应用旧官方用户", async () => {
    const test = setup({ local: true });
    test.oauthService.onDidChangeSession.mockImplementation(() => {
      throw new Error("offline");
    });
    test.setOwner("bigmodel", authenticated());
    test.mount();
    await waitFor(() => expect(test.setIsRestoringOAuthSession).toHaveBeenCalledWith(false));
    expect(test.setUser).not.toHaveBeenCalledWith(userA);
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("先订阅再发现 provider，凭无秘密的成功事件重读已验证 session 并完成 UI 登录", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    expect(test.oauthService.onDidChangeSession).toHaveBeenCalledOnce();
    expect(test.oauthService.onDidChangeSession.mock.invocationCallOrder[0]).toBeLessThan(
      test.oauthService.getProviders.mock.invocationCallOrder[0],
    );
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.markOAuthSuccess).toHaveBeenCalledExactlyOnceWith("new-api"));
    expect(test.oauthService.restoreCachedSessionState).toHaveBeenCalled();
    expect(test.oauthService.getActiveProvider).toHaveBeenCalled();
    expect(test.setUser).toHaveBeenLastCalledWith(userA);
    expect(test.refreshProviderState).toHaveBeenCalled();
    expect(test.setOAuthError).toHaveBeenLastCalledWith(null);
    expect(test.setUser.mock.invocationCallOrder.at(-1)).toBeLessThan(
      test.markOAuthSuccess.mock.invocationCallOrder[0],
    );
  });

  it("事件在 provider 查询期间到达时不会漏掉", async () => {
    const test = setup({ local: true });
    const providers = deferred<Array<{ id: string }>>();
    test.oauthService.getProviders.mockReturnValue(providers.promise);
    test.mount();
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await act(async () => providers.resolve([{ id: "new-api" }]));
    await waitFor(() => expect(test.markOAuthSuccess).toHaveBeenCalledExactlyOnceWith("new-api"));
    expect(test.setUser).toHaveBeenLastCalledWith(userA);
  });

  it("挂载前已完成登录时主动读取快照并发送成功信号", async () => {
    const test = setup({ local: true });
    test.setOwner("new-api", authenticated());
    test.mount();
    await waitFor(() => expect(test.markOAuthSuccess).toHaveBeenCalledExactlyOnceWith("new-api"));
    expect(test.setUser).toHaveBeenLastCalledWith(userA);
  });

  it("启动恢复迟到时不能覆盖后来的退出", async () => {
    const test = setup({ local: true });
    const stale = deferred<OAuthCachedSessionRestoreResult>();
    test.oauthService.restoreCachedSessionState.mockReturnValueOnce(stale.promise);
    test.setOwner("new-api", authenticated());
    test.mount();
    await waitFor(() => expect(test.oauthService.restoreCachedSessionState).toHaveBeenCalled());
    test.setOwner(null, { status: "signed-out" });
    test.publish("signed-out");
    await waitFor(() => expect(test.setUser).toHaveBeenLastCalledWith(null));
    test.setUser.mockClear();
    test.markOAuthSuccess.mockClear();
    await act(async () => stale.resolve(authenticated()));
    expect(test.setUser).not.toHaveBeenCalledWith(userA);
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
    expect(test.setIsRestoringOAuthSession).toHaveBeenCalledWith(false);
  });

  it.each([
    { state: "signed-in" as const, provider: null },
    { state: "signed-out" as const, provider: "new-api" },
  ])("新事件 $state 的 active provider 不匹配时，旧启动快照不能让恢复状态卡住", async ({
    state,
    provider,
  }) => {
    const test = setup({ local: true });
    const startup = deferred<OAuthCachedSessionRestoreResult>();
    test.oauthService.restoreCachedSessionState.mockReturnValueOnce(startup.promise);
    test.mount();
    await waitFor(() => expect(test.providerSettingsService.onDidChange).toHaveBeenCalled());
    await act(async () => {});
    test.clearEffects();
    test.setOwner(provider, authenticated());
    const eventProvider = deferred<string | null>();
    test.oauthService.getActiveProvider.mockReturnValueOnce(eventProvider.promise);

    test.publish(state);
    await waitFor(() => expect(test.oauthService.getActiveProvider).toHaveBeenCalledOnce());
    await act(async () => eventProvider.resolve(provider));
    await act(async () => startup.resolve(authenticated()));

    expect(test.setIsRestoringOAuthSession).toHaveBeenCalledWith(false);
    expect(test.setUser).not.toHaveBeenCalled();
    expect(test.setOAuthError).not.toHaveBeenCalled();
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("provider 查询失败且事件已推进代次时，旧启动快照仍结束恢复但不伪造错误", async () => {
    const test = setup({ local: true });
    const startup = deferred<OAuthCachedSessionRestoreResult>();
    const providers = deferred<Array<{ id: string }>>();
    test.oauthService.restoreCachedSessionState.mockReturnValueOnce(startup.promise);
    test.oauthService.getProviders.mockReturnValue(providers.promise);
    test.mount();
    test.setOwner(null, { status: "signed-out" });
    test.publish("signed-in");
    await act(async () => providers.reject(new Error("offline")));
    await act(async () => startup.resolve(authenticated()));

    expect(test.setIsRestoringOAuthSession).toHaveBeenCalledWith(false);
    expect(test.setUser).not.toHaveBeenCalled();
    expect(test.setOAuthError).not.toHaveBeenCalled();
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("严格模式重新挂载后，旧周期的启动快照不能结束新周期的恢复", async () => {
    const test = setup({ local: true });
    const oldStartup = deferred<OAuthCachedSessionRestoreResult>();
    const newStartup = deferred<OAuthCachedSessionRestoreResult>();
    test.oauthService.restoreCachedSessionState
      .mockReturnValueOnce(oldStartup.promise)
      .mockReturnValueOnce(newStartup.promise);
    test.mount(true);
    await waitFor(() => expect(test.oauthService.restoreCachedSessionState).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(test.providerSettingsService.onDidChange).toHaveBeenCalled());
    await act(async () => {});
    test.setIsRestoringOAuthSession.mockClear();
    test.setUser.mockClear();
    test.setOAuthError.mockClear();
    test.markOAuthSuccess.mockClear();

    await act(async () => oldStartup.resolve(authenticated()));
    expect(test.setIsRestoringOAuthSession).not.toHaveBeenCalled();
    expect(test.setUser).not.toHaveBeenCalled();
    expect(test.setOAuthError).not.toHaveBeenCalled();
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();

    await act(async () => newStartup.resolve({ status: "signed-out" }));
    expect(test.setIsRestoringOAuthSession).toHaveBeenCalledWith(false);
  });

  it("退出使正在读取的旧登录失效", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    const stale = deferred<OAuthCachedSessionRestoreResult>();
    test.oauthService.restoreCachedSessionState.mockReturnValueOnce(stale.promise);
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.oauthService.restoreCachedSessionState).toHaveBeenCalled());
    test.setOwner(null, { status: "signed-out" });
    test.publish("signed-out");
    await waitFor(() => expect(test.setUser).toHaveBeenLastCalledWith(null));
    await act(async () => stale.resolve(authenticated()));
    expect(test.setUser).not.toHaveBeenCalledWith(userA);
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("切换账号时迟到的旧 session 不能覆盖新用户或产生重复成功信号", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    const stale = deferred<OAuthCachedSessionRestoreResult>();
    test.oauthService.restoreCachedSessionState.mockReturnValueOnce(stale.promise);
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.oauthService.restoreCachedSessionState).toHaveBeenCalled());
    test.setOwner(null, { status: "signed-out" });
    test.publish("signed-out");
    test.setOwner("new-api", authenticated(userB));
    test.publish("signed-in");
    await waitFor(() => expect(test.markOAuthSuccess).toHaveBeenCalledExactlyOnceWith("new-api"));
    await act(async () => stale.resolve(authenticated()));
    expect(test.setUser).toHaveBeenLastCalledWith(userB);
    expect(test.setUser).not.toHaveBeenCalledWith(userA);
    expect(test.markOAuthSuccess).toHaveBeenCalledOnce();
  });

  it("退出读取迟到时不能清掉已完成的新账号登录", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    const staleLogout = deferred<string | null>();
    test.oauthService.getActiveProvider.mockReturnValueOnce(staleLogout.promise);
    test.publish("signed-out");
    test.setOwner("new-api", authenticated(userB));
    test.publish("signed-in");
    await waitFor(() => expect(test.markOAuthSuccess).toHaveBeenCalledOnce());
    test.setUser.mockClear();
    await act(async () => staleLogout.resolve(null));
    expect(test.setUser).not.toHaveBeenCalledWith(null);
  });

  it("退出发生在 provider 刷新中时不允许旧登录成功收尾", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    const refresh = deferred<void>();
    test.refreshProviderState.mockReturnValueOnce(refresh.promise);
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.refreshProviderState).toHaveBeenCalled());
    test.setOwner(null, { status: "signed-out" });
    test.publish("signed-out");
    await waitFor(() => expect(test.setUser).toHaveBeenLastCalledWith(null));
    await act(async () => refresh.resolve());
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("退出事件不会恢复尚未清理的旧凭据", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    test.setOwner(null, authenticated());
    test.publish("signed-out");
    await waitFor(() => expect(test.oauthService.getActiveProvider).toHaveBeenCalled());
    expect(test.oauthService.restoreCachedSessionState).not.toHaveBeenCalled();
    expect(test.setUser).toHaveBeenCalledWith(null);
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("登录事件后的身份验证暂不可用时结束等待并显示可重试错误", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    test.setOwner("new-api", { status: "unavailable", reason: "backend-unavailable" });
    test.publish("signed-in");
    await waitFor(() =>
      expect(test.setOAuthError).toHaveBeenCalledWith("login.oauth.loginFailure"),
    );
    expect(test.setIsRestoringOAuthSession).toHaveBeenCalledWith(false);
    expect(test.setUser).not.toHaveBeenCalledWith(null);
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("登录事件后的身份验证 RPC 抛错时结束等待并显示安全错误", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    test.setOwner("new-api", authenticated());
    test.oauthService.restoreCachedSessionState.mockRejectedValueOnce(new Error("offline"));
    test.publish("signed-in");
    await waitFor(() =>
      expect(test.setOAuthError).toHaveBeenCalledWith("login.oauth.loginFailure"),
    );
    expect(test.setUser).not.toHaveBeenCalledWith(null);
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("旧登录的身份验证失败不能覆盖新的登录", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    const stale = deferred<OAuthCachedSessionRestoreResult>();
    test.oauthService.restoreCachedSessionState.mockReturnValueOnce(stale.promise);
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.oauthService.restoreCachedSessionState).toHaveBeenCalled());
    test.setOwner(null, { status: "signed-out" });
    test.publish("signed-out");
    test.setOwner("new-api", authenticated(userB));
    test.publish("signed-in");
    await waitFor(() => expect(test.markOAuthSuccess).toHaveBeenCalledOnce());
    test.setOAuthError.mockClear();
    await act(async () => stale.resolve({ status: "unavailable", reason: "backend-unavailable" }));
    expect(test.setOAuthError).not.toHaveBeenCalled();
    expect(test.setUser).toHaveBeenLastCalledWith(userB);
  });

  it("设置观察的迟到读取不会清掉刚登录的用户", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    await waitFor(() => expect(test.providerSettingsService.onDidChange).toHaveBeenCalled());
    const stale = deferred<string | null>();
    test.oauthService.getActiveProvider.mockReturnValueOnce(stale.promise);
    act(() => test.notifyProviderChange());
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.markOAuthSuccess).toHaveBeenCalledOnce());
    test.setUser.mockClear();
    await act(async () => stale.resolve(null));
    expect(test.setUser).not.toHaveBeenCalledWith(null);
  });

  it("挂载期间替换服务后，旧会话读取不能覆盖新 owner 的用户", async () => {
    const test = setup({ local: true });
    const hook = test.mount();
    await finishStartup(test);
    const stale = deferred<OAuthCachedSessionRestoreResult>();
    test.oauthService.restoreCachedSessionState.mockReturnValueOnce(stale.promise);
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.oauthService.restoreCachedSessionState).toHaveBeenCalled());

    const freshUser = { id: "new-owner", username: "new-owner", displayName: "New owner" };
    const newOauth = {
      ...test.oauthService,
      getActiveProvider: vi.fn(async () => "new-api"),
      restoreCachedSessionState: vi.fn(async () => authenticated(freshUser)),
    };
    Object.assign(test.services, { oauthService: newOauth });
    hook.rerender();
    await waitFor(() => expect(test.setUser).toHaveBeenLastCalledWith(freshUser));
    test.setUser.mockClear();
    await act(async () => stale.resolve(authenticated()));
    expect(test.setUser).not.toHaveBeenCalledWith(userA);
  });

  it("设置观察的旧读取抛错也不能清掉新的本机会话", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    await waitFor(() => expect(test.providerSettingsService.onDidChange).toHaveBeenCalled());
    const stale = deferred<string | null>();
    test.oauthService.getActiveProvider.mockReturnValueOnce(stale.promise);
    act(() => test.notifyProviderChange());
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.markOAuthSuccess).toHaveBeenCalledOnce());
    test.setUser.mockClear();
    await act(async () => stale.reject(new Error("offline")));
    expect(test.setUser).not.toHaveBeenCalledWith(null);
  });

  it("设置观察读取失败不会伪造退出", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    await waitFor(() => expect(test.providerSettingsService.onDidChange).toHaveBeenCalled());
    test.oauthService.getActiveProvider.mockRejectedValueOnce(new Error("offline"));
    await act(async () => test.notifyProviderChange());
    expect(test.setUser).not.toHaveBeenCalledWith(null);
  });

  it("重复 signed-in 不重复通知同一轮登录成功", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.markOAuthSuccess).toHaveBeenCalledOnce());
    test.publish("signed-in");
    await waitFor(() =>
      expect(test.oauthService.restoreCachedSessionState).toHaveBeenCalledTimes(2),
    );
    expect(test.markOAuthSuccess).toHaveBeenCalledOnce();
  });

  it("无法确认有效 provider 或 session 时不接受成功事件", async () => {
    const test = setup({ local: true });
    test.mount();
    await finishStartup(test);
    test.setOwner(null, { status: "unavailable", reason: "backend-unavailable" });
    test.publish("signed-in");
    await waitFor(() => expect(test.oauthService.getActiveProvider).toHaveBeenCalled());
    expect(test.setUser).not.toHaveBeenCalledWith(userA);
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("卸载使未完成的 session 读取失效并取消订阅", async () => {
    const test = setup({ local: true });
    const { unmount } = test.mount();
    await finishStartup(test);
    const stale = deferred<OAuthCachedSessionRestoreResult>();
    test.oauthService.restoreCachedSessionState.mockReturnValueOnce(stale.promise);
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    await waitFor(() => expect(test.oauthService.restoreCachedSessionState).toHaveBeenCalled());
    unmount();
    await act(async () => stale.resolve(authenticated()));
    expect(test.dispose).toHaveBeenCalledOnce();
    expect(test.setUser).not.toHaveBeenCalled();
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it.each([
    { label: "普通 Web", local: false, desktop: false },
    { label: "手机远控", local: false, desktop: false },
    { label: "桌面", local: false, desktop: true },
  ])("$label 没有本机 Web 标识时不订阅", async ({ local, desktop }) => {
    const test = setup({ local, desktop });
    test.mount();
    await finishStartup(test);
    expect(test.oauthService.onDidChangeSession).not.toHaveBeenCalled();
    test.setOwner("new-api", authenticated());
    test.publish("signed-in");
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
  });

  it("明确本机标识下非 new-api provider 不使用会话同步", async () => {
    const test = setup({ local: true, provider: "bigmodel" });
    test.mount();
    await finishStartup(test);
    test.setOwner("bigmodel", authenticated());
    test.publish("signed-in");
    expect(test.markOAuthSuccess).not.toHaveBeenCalled();
    expect(test.dispose).toHaveBeenCalledOnce();
  });
});
