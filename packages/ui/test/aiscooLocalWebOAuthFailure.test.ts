// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Emitter } from "@zcode/rpc";
import type { OAuthProviderId } from "@zcode/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOAuth } from "@/hooks/useOAuth.js";
import { aiscooLocalWebOAuthLifecycle } from "@/aiscoo/local-web-oauth/index.js";

interface AuthorizationFailure {
  provider: OAuthProviderId;
  state: string;
  reason: "expired" | "backend-unavailable" | "authorization-failed";
}
const mocks = vi.hoisted(() => ({
  oauth: {
    getProviders: vi.fn(async () => []),
    getActiveProvider: vi.fn(async () => null),
    startOAuth: vi.fn(),
    startOAuthWithPolling: vi.fn(),
    cancelPending: vi.fn(async () => {}),
    cancelLocalWebAuthorization: vi.fn(async (_state: string) => {}),
    getLocalWebAuthorizationCapabilities: vi.fn(async () => ({ failureEvents: true })),
    onDidFailAuthorization: vi.fn(),
  },
  platform: {
    openExternal: vi.fn(),
    registerOAuthState: vi.fn(),
    aiscooLocalWebOAuthSync: true,
    oauthLifecycle: undefined as typeof aiscooLocalWebOAuthLifecycle | undefined,
    prepareLocalWebOAuthWindow:
      vi.fn<() => { navigate(url: string): boolean; close(): void } | null>(),
  },
  setOAuthPollingActive: vi.fn(),
  intl: { formatMessage: ({ id }: { id: string }) => id },
}));
vi.mock("@/hooks/useServices.js", () => ({ useServices: () => ({ oauthService: mocks.oauth }) }));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => mocks.platform }));
vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (select: (state: unknown) => unknown) =>
    select({ setOAuthPollingActive: mocks.setOAuthPollingActive }),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: mocks.intl }),
}));
vi.mock("@/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/appTelemetry.js", () => ({ reportAppTelemetryEvent: vi.fn(async () => {}) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
function response(state: string, provider = "new-api") {
  return {
    provider,
    state,
    purpose: "primary-account",
    authorizeUrl: "https://example.test/authorize",
  };
}
function failure(state: string, provider = "new-api"): AuthorizationFailure {
  return { provider, state, reason: "authorization-failed" };
}
let emitter: Emitter<AuthorizationFailure>;
let dispose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  emitter = new Emitter<AuthorizationFailure>();
  dispose = vi.fn();
  mocks.intl = { formatMessage: ({ id }: { id: string }) => id };
  mocks.platform.aiscooLocalWebOAuthSync = true;
  mocks.platform.oauthLifecycle = aiscooLocalWebOAuthLifecycle;
  mocks.platform.prepareLocalWebOAuthWindow.mockReset();
  mocks.oauth.startOAuth.mockReset();
  mocks.oauth.startOAuthWithPolling.mockReset();
  mocks.oauth.cancelPending.mockResolvedValue();
  mocks.oauth.cancelLocalWebAuthorization.mockReset();
  mocks.oauth.cancelLocalWebAuthorization.mockResolvedValue();
  mocks.oauth.onDidFailAuthorization.mockImplementation(
    (handler: (event: AuthorizationFailure) => void) => {
      const subscription = emitter.event(handler);
      return {
        dispose: () => {
          dispose();
          subscription.dispose();
        },
      };
    },
  );
});
afterEach(cleanup);

async function start(state = "current") {
  mocks.oauth.startOAuth.mockResolvedValueOnce(response(state));
  const hook = renderHook(() => useOAuth());
  await act(async () => hook.result.current.startLogin("new-api"));
  expect(hook.result.current.status).toBe("waiting");
  return hook;
}

describe("本机 Web 登录弹窗", () => {
  it("通过独立手势入口同步预开窗口，原 startLogin 保留原始参数", async () => {
    const capabilities = deferred<{ failureEvents: boolean }>();
    mocks.oauth.getLocalWebAuthorizationCapabilities.mockReturnValueOnce(capabilities.promise);
    const popup = { navigate: vi.fn(() => true), close: vi.fn() };
    mocks.platform.prepareLocalWebOAuthWindow.mockReturnValue(popup);
    mocks.oauth.startOAuth.mockResolvedValueOnce(response("current"));
    const hook = renderHook(() => useOAuth());
    let login!: Promise<void>;
    act(() => {
      login = hook.result.current.startLoginFromUserGesture("new-api");
      expect(mocks.platform.prepareLocalWebOAuthWindow).toHaveBeenCalledOnce();
      expect(mocks.oauth.startOAuth).not.toHaveBeenCalled();
    });
    await act(async () => {
      capabilities.resolve({ failureEvents: true });
      await login;
    });
    expect(popup.navigate).toHaveBeenCalledOnce();
  });

  it("在等待能力握手之前同步预开窗口，仅在授权返回后导航", async () => {
    const capabilities = deferred<{ failureEvents: boolean }>();
    mocks.oauth.getLocalWebAuthorizationCapabilities.mockReturnValueOnce(capabilities.promise);
    const popup = { navigate: vi.fn(() => true), close: vi.fn() };
    mocks.platform.prepareLocalWebOAuthWindow.mockReturnValue(popup);
    mocks.oauth.startOAuth.mockResolvedValueOnce(response("current"));
    const hook = renderHook(() => useOAuth());
    let login!: Promise<void>;
    act(() => {
      login = hook.result.current.startLoginFromUserGesture("new-api");
      expect(mocks.platform.prepareLocalWebOAuthWindow).toHaveBeenCalledOnce();
      expect(mocks.oauth.startOAuth).not.toHaveBeenCalled();
    });
    await act(async () => {
      capabilities.resolve({ failureEvents: true });
      await login;
    });
    expect(popup.navigate).toHaveBeenCalledExactlyOnceWith("https://example.test/authorize");
    expect(mocks.platform.openExternal).not.toHaveBeenCalled();
    expect(hook.result.current.manualAuthorizationUrl).toBeNull();
    hook.unmount();
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("阻止弹窗和自动登录均保留可点击授权地址", async () => {
    mocks.platform.prepareLocalWebOAuthWindow.mockReturnValue(null);
    mocks.oauth.startOAuth.mockResolvedValue(response("current"));
    const hook = renderHook(() => useOAuth());
    await act(async () => hook.result.current.startLoginFromUserGesture("new-api"));
    expect(hook.result.current.manualAuthorizationUrl).toBe("https://example.test/authorize");
    expect(mocks.platform.openExternal).not.toHaveBeenCalled();
    await act(async () => hook.result.current.startLogin("new-api"));
    expect(mocks.platform.prepareLocalWebOAuthWindow).toHaveBeenCalledOnce();
    expect(hook.result.current.manualAuthorizationUrl).toBe("https://example.test/authorize");
    await act(async () => hook.result.current.cancel("new-api"));
    expect(hook.result.current.manualAuthorizationUrl).toBeNull();
  });

  it("取消、失败和重试关闭旧窗口，迟到的结果不能导航", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const old = { navigate: vi.fn(() => true), close: vi.fn() };
    const next = { navigate: vi.fn(() => true), close: vi.fn() };
    mocks.platform.prepareLocalWebOAuthWindow.mockReturnValueOnce(old).mockReturnValueOnce(next);
    mocks.oauth.startOAuth
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response("new"));
    const hook = renderHook(() => useOAuth());
    let first!: Promise<void>;
    act(() => {
      first = hook.result.current.startLoginFromUserGesture("new-api");
    });
    await waitFor(() => expect(mocks.oauth.startOAuth).toHaveBeenCalledOnce());
    await act(async () => hook.result.current.cancel("new-api"));
    await act(async () => hook.result.current.startLoginFromUserGesture("new-api"));
    await act(async () => {
      pending.resolve(response("old"));
      await first;
    });
    expect(old.close).toHaveBeenCalledOnce();
    expect(old.navigate).not.toHaveBeenCalled();
    expect(next.navigate).toHaveBeenCalledOnce();
    act(() => emitter.fire(failure("new")));
    expect(next.close).toHaveBeenCalledOnce();
    expect(hook.result.current.manualAuthorizationUrl).toBeNull();
  });

  it("预开窗口无法导航时仍提供人工授权入口", async () => {
    const popup = { navigate: vi.fn(() => false), close: vi.fn() };
    mocks.platform.prepareLocalWebOAuthWindow.mockReturnValue(popup);
    mocks.oauth.startOAuth.mockResolvedValueOnce(response("current"));
    const hook = renderHook(() => useOAuth());
    await act(async () => hook.result.current.startLoginFromUserGesture("new-api"));
    expect(popup.close).toHaveBeenCalledOnce();
    expect(hook.result.current.manualAuthorizationUrl).toBe("https://example.test/authorize");
  });
});

describe("本机 Web OAuth 授权失败事件", () => {
  it.each(["expired", "backend-unavailable", "authorization-failed"] as const)(
    "%s 匹配当前 provider 与 state 时显示安全错误并结束等待",
    async (reason) => {
      const hook = await start();
      act(() => emitter.fire({ provider: "new-api", state: "current", reason }));
      expect(hook.result.current.status).toBe("error");
      expect(hook.result.current.error).toBe("login.oauth.loginFailure");
      expect(hook.result.current.pendingProvider).toBeNull();
      expect(mocks.setOAuthPollingActive).toHaveBeenLastCalledWith(false);
    },
  );

  it("不匹配 state 或 provider 的迟到事件不影响当前等待", async () => {
    const hook = await start();
    act(() => {
      emitter.fire(failure("old"));
      emitter.fire(failure("current", "bigmodel"));
    });
    expect(hook.result.current.status).toBe("waiting");
    expect(hook.result.current.error).toBeNull();
  });

  it("取消立即废弃 state，即使服务端取消仍在进行", async () => {
    const hook = await start();
    const cancellation = deferred<void>();
    mocks.oauth.cancelLocalWebAuthorization.mockReturnValueOnce(cancellation.promise);
    let cancelPromise!: Promise<void>;
    act(() => {
      cancelPromise = hook.result.current.cancel("new-api");
    });
    act(() => emitter.fire(failure("current")));
    expect(hook.result.current.status).toBe("waiting");
    await act(async () => {
      cancellation.resolve();
      await cancelPromise;
    });
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.error).toBeNull();
  });

  it("替换 flow 后忽略旧失败，仅处理新 state", async () => {
    const hook = await start("old");
    mocks.oauth.startOAuth.mockResolvedValueOnce(response("new"));
    await act(async () => hook.result.current.startLogin("new-api"));
    act(() => emitter.fire(failure("old")));
    expect(hook.result.current.status).toBe("waiting");
    act(() => emitter.fire(failure("new")));
    expect(hook.result.current.status).toBe("error");
  });

  it("事件早于启动 RPC 返回时，匹配后仍能结束等待", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    mocks.oauth.startOAuth.mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useOAuth());
    let login!: Promise<void>;
    act(() => {
      login = hook.result.current.startLogin("new-api");
    });
    await waitFor(() => expect(mocks.oauth.startOAuth).toHaveBeenCalled());
    act(() => emitter.fire(failure("new")));
    await act(async () => {
      pending.resolve(response("new"));
      await login;
    });
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.error).toBe("login.oauth.loginFailure");
  });

  it("新 flow 启动等待中收到旧失败不会污染新 flow", async () => {
    const hook = await start("old");
    const pending = deferred<ReturnType<typeof response>>();
    mocks.oauth.startOAuth.mockReturnValueOnce(pending.promise);
    let login!: Promise<void>;
    act(() => {
      login = hook.result.current.startLogin("new-api");
    });
    act(() => emitter.fire(failure("old")));
    await act(async () => {
      pending.resolve(response("new"));
      await login;
    });
    expect(hook.result.current.status).toBe("waiting");
    expect(hook.result.current.error).toBeNull();
    act(() => emitter.fire(failure("new")));
    expect(hook.result.current.status).toBe("error");
  });

  it("关闭登录页后迟到的启动结果不能重新打开窗口或恢复等待", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const popup = { navigate: vi.fn(() => true), close: vi.fn() };
    mocks.platform.prepareLocalWebOAuthWindow.mockReturnValue(popup);
    mocks.oauth.startOAuth.mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useOAuth());
    let login!: Promise<void>;
    act(() => {
      login = hook.result.current.startLoginFromUserGesture("new-api");
    });
    await waitFor(() => expect(mocks.oauth.startOAuth).toHaveBeenCalledOnce());
    act(() => hook.result.current.reset());
    await act(async () => {
      pending.resolve(response("old"));
      await login;
    });
    expect(popup.close).toHaveBeenCalledOnce();
    expect(popup.navigate).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.manualAuthorizationUrl).toBeNull();
  });

  it("取消等待中的旧请求返回后不得覆盖新 flow", async () => {
    const hook = await start("old");
    const cancellation = deferred<void>();
    mocks.oauth.cancelLocalWebAuthorization.mockReturnValueOnce(cancellation.promise);
    let cancelPromise!: Promise<void>;
    act(() => {
      cancelPromise = hook.result.current.cancel("new-api");
    });
    mocks.oauth.startOAuth.mockResolvedValueOnce(response("new"));
    await act(async () => hook.result.current.startLogin("new-api"));
    await act(async () => {
      cancellation.resolve();
      await cancelPromise;
    });
    expect(hook.result.current.status).toBe("waiting");
    act(() => emitter.fire(failure("new")));
    expect(hook.result.current.status).toBe("error");
  });

  it("卸载时取消订阅，后续事件无效", async () => {
    const hook = await start();
    hook.unmount();
    expect(dispose).toHaveBeenCalledOnce();
    act(() => emitter.fire(failure("current")));
  });

  it("未设置本机模式时不订阅事件", async () => {
    mocks.platform.aiscooLocalWebOAuthSync = false;
    mocks.platform.oauthLifecycle = undefined;
    const hook = await start();
    expect(mocks.oauth.onDidFailAuthorization).not.toHaveBeenCalled();
    act(() => emitter.fire(failure("current")));
    expect(hook.result.current.status).toBe("waiting");
  });

  it("本机事件订阅抛错时不启动授权，直接显示错误", async () => {
    mocks.oauth.onDidFailAuthorization.mockImplementation(() => {
      throw new Error("subscription unavailable");
    });
    const hook = renderHook(() => useOAuth());
    await act(async () => hook.result.current.startLogin("new-api"));
    expect(mocks.oauth.startOAuth).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.error).toBe("login.oauth.loginFailure");
  });

  it("本机事件缺失时不启动授权", async () => {
    const original = mocks.oauth.onDidFailAuthorization;
    (mocks.oauth as { onDidFailAuthorization?: unknown }).onDidFailAuthorization = undefined;
    try {
      const hook = renderHook(() => useOAuth());
      await act(async () => hook.result.current.startLogin("new-api"));
      expect(mocks.oauth.startOAuth).not.toHaveBeenCalled();
      expect(hook.result.current.status).toBe("error");
    } finally {
      mocks.oauth.onDidFailAuthorization = original;
    }
  });

  it("握手失败或不支持失败事件时拒绝启动授权", async () => {
    mocks.oauth.getLocalWebAuthorizationCapabilities.mockRejectedValueOnce(new Error("old host"));
    const hook = renderHook(() => useOAuth());
    await act(async () => hook.result.current.startLogin("new-api"));
    expect(mocks.oauth.startOAuth).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("error");
    expect(mocks.oauth.onDidFailAuthorization).not.toHaveBeenCalled();
    hook.unmount();
    mocks.oauth.getLocalWebAuthorizationCapabilities.mockResolvedValueOnce({
      failureEvents: false,
    });
    const unsupported = renderHook(() => useOAuth());
    await act(async () => unsupported.result.current.startLogin("new-api"));
    expect(mocks.oauth.startOAuth).not.toHaveBeenCalled();
    expect(unsupported.result.current.status).toBe("error");
  });

  it("握手时取消后迟到的回复不能启动授权或显示失败", async () => {
    const capabilities = deferred<{ failureEvents: boolean }>();
    mocks.oauth.getLocalWebAuthorizationCapabilities.mockReturnValueOnce(capabilities.promise);
    const hook = renderHook(() => useOAuth());
    let login!: Promise<void>;
    act(() => {
      login = hook.result.current.startLogin("new-api");
    });
    await act(async () => hook.result.current.cancel("new-api"));
    await act(async () => {
      capabilities.resolve({ failureEvents: true });
      await login;
    });
    expect(mocks.oauth.startOAuth).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
  });

  it("未注入扩展时手势入口沿用桌面原登录流程", async () => {
    mocks.platform.aiscooLocalWebOAuthSync = false;
    mocks.platform.oauthLifecycle = undefined;
    mocks.oauth.startOAuthWithPolling.mockResolvedValueOnce(response("desktop", "bigmodel"));
    const hook = renderHook(() => useOAuth());
    await act(async () => hook.result.current.startLoginFromUserGesture("bigmodel"));
    expect(mocks.platform.prepareLocalWebOAuthWindow).not.toHaveBeenCalled();
    expect(mocks.oauth.startOAuthWithPolling).toHaveBeenCalledWith("bigmodel");
    expect(mocks.platform.openExternal).toHaveBeenCalledWith("https://example.test/authorize");
  });

  it("普通 provider 不消费 new-api 事件", async () => {
    mocks.oauth.startOAuthWithPolling.mockResolvedValueOnce(response("big-state", "bigmodel"));
    const hook = renderHook(() => useOAuth());
    await act(async () => hook.result.current.startLogin("bigmodel"));
    act(() => emitter.fire(failure("big-state")));
    expect(hook.result.current.status).toBe("waiting");
  });
});

describe("本机 Web 取消归属与生命周期稳定性", () => {
  it("取消只按本标签尝试的 state 撤销，不按 provider 关闭其他标签的 flow", async () => {
    const hook = await start("tab-a");
    await act(async () => hook.result.current.cancel("new-api"));
    expect(mocks.oauth.cancelLocalWebAuthorization).toHaveBeenCalledExactlyOnceWith("tab-a");
    expect(mocks.oauth.cancelPending).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
  });

  it("启动 RPC 返回前取消，迟到的响应按其 state 撤销且不导航", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const popup = { navigate: vi.fn(() => true), close: vi.fn() };
    mocks.platform.prepareLocalWebOAuthWindow.mockReturnValue(popup);
    mocks.oauth.startOAuth.mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useOAuth());
    let login!: Promise<void>;
    act(() => {
      login = hook.result.current.startLoginFromUserGesture("new-api");
    });
    await waitFor(() => expect(mocks.oauth.startOAuth).toHaveBeenCalledOnce());
    await act(async () => hook.result.current.cancel("new-api"));
    expect(mocks.oauth.cancelLocalWebAuthorization).not.toHaveBeenCalled();
    expect(mocks.oauth.cancelPending).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(response("late"));
      await login;
    });
    expect(mocks.oauth.cancelLocalWebAuthorization).toHaveBeenCalledExactlyOnceWith("late");
    expect(popup.navigate).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
  });

  it("首次能力握手失败只拒绝当前尝试，重新登录会重新握手", async () => {
    mocks.oauth.getLocalWebAuthorizationCapabilities.mockRejectedValueOnce(new Error("starting"));
    mocks.oauth.startOAuth.mockResolvedValueOnce(response("retry"));
    const hook = renderHook(() => useOAuth());
    await act(async () => hook.result.current.startLogin("new-api"));
    expect(hook.result.current.status).toBe("error");
    expect(mocks.oauth.startOAuth).not.toHaveBeenCalled();
    mocks.oauth.getLocalWebAuthorizationCapabilities.mockClear();
    await act(async () => hook.result.current.startLogin("new-api"));
    expect(mocks.oauth.getLocalWebAuthorizationCapabilities).toHaveBeenCalledTimes(2);
    expect(mocks.oauth.startOAuth).toHaveBeenCalledOnce();
    expect(hook.result.current.status).toBe("waiting");
    act(() => emitter.fire(failure("retry")));
    expect(hook.result.current.status).toBe("error");
  });

  it("语言广播改变 intl 不重建生命周期，等待中的窗口、state 与 waiting 保留", async () => {
    const popup = { navigate: vi.fn(() => true), close: vi.fn() };
    mocks.platform.prepareLocalWebOAuthWindow.mockReturnValue(popup);
    mocks.oauth.startOAuth.mockResolvedValueOnce(response("current"));
    const hook = renderHook(() => useOAuth());
    await act(async () => hook.result.current.startLoginFromUserGesture("new-api"));
    expect(hook.result.current.status).toBe("waiting");
    const subscriptions = mocks.oauth.onDidFailAuthorization.mock.calls.length;
    mocks.intl = { formatMessage: ({ id }: { id: string }) => `${id}:next-locale` };
    hook.rerender();
    expect(hook.result.current.status).toBe("waiting");
    expect(popup.close).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(mocks.oauth.onDidFailAuthorization.mock.calls.length).toBe(subscriptions);
    act(() => emitter.fire(failure("current")));
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.error).toBe("login.oauth.loginFailure:next-locale");
  });
});
