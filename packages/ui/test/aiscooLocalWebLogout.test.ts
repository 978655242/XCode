// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRootWorkspaceActions } from "@/root/useRootWorkspaceActions.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
import { useAlertDialogStore } from "@/store/alertDialogStore.js";
import { aiscooLocalWebOAuthLifecycle } from "@/aiscoo/local-web-oauth/index.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import enUS from "@/i18n/locales/en-US.js";

afterEach(() => {
  useConfirmDialogStore.getState().settleConfirmation(false);
  useAlertDialogStore.getState().settleAlert();
  cleanup();
});

it("本机 Web 撤销未确认时显示明确提示且不执行桌面重启", async () => {
  const platform = {
    aiscooLocalWebOAuthSync: true,
    reportTelemetryEvent: vi.fn(async () => {}),
    executeDesktopCommand: vi.fn(async () => {}),
  };
  const logout = vi.fn(async () => {
    throw Object.assign(new Error("XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED"), {
      code: "XCODE_LOCAL_WEB_LOGOUT_UNCONFIRMED",
    });
  });
  const setUser = vi.fn();
  const refreshProviderState = vi.fn(async () => {});
  const setOAuthError = vi.fn();
  const oauthService = {
    logout,
    getActiveProvider: async () => null,
    getLocalWebLogoutToken: async () => "generation-1",
    logoutLocalWeb: logout,
  };
  const intl = { formatMessage: ({ id }: { id: string }) => zhCN[id as keyof typeof zhCN] ?? id };
  const logoutOverride = aiscooLocalWebOAuthLifecycle.createLogout!({
    oauthService,
    intl,
    requestConfirmation: (payload) => useConfirmDialogStore.getState().requestConfirmation(payload),
    requestAlert: (payload) => useAlertDialogStore.getState().requestAlert(payload),
    setUser,
    setOAuthError,
    refreshProviderState,
  });
  const { result } = renderHook(() =>
    useRootWorkspaceActions({
      intl: intl as never,
      platform: platform as never,
      services: { oauthService, settingService: { get: async () => ({}) } } as never,
      tabStoreApi: { getState: () => ({ activeTabId: null }) } as never,
      addTab: vi.fn(),
      activeWorkspacePath: null,
      activeWorkspaceIdentity: null,
      supportsSettings: true,
      allowOpenWorkspace: true,
      preferDirectoryBrowser: false,
      refreshProviderState,
      updateAppSettings: vi.fn(),
      setOAuthError,
      setUser,
      logoutOverride,
    }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.handleLogout();
  });
  expect(useConfirmDialogStore.getState().pendingRequest?.title).toBe("退出本机账号？");
  await act(async () => {
    useConfirmDialogStore.getState().settleConfirmation(true);
  });
  await waitFor(() =>
    expect(useAlertDialogStore.getState().pendingRequest).toMatchObject({
      title: "本机已退出",
      description: "无法确认服务端会话是否已撤销。",
    }),
  );
  expect(setUser).not.toHaveBeenCalled();
  expect(refreshProviderState).not.toHaveBeenCalled();
  expect(platform.executeDesktopCommand).not.toHaveBeenCalled();
  await act(async () => {
    useAlertDialogStore.getState().settleAlert();
    await pending;
  });
});

it("退出确认期间切换账号后不会撤销新账号", async () => {
  let generation = 1;
  let active = "A";
  let confirm!: (value: boolean) => void;
  const confirmation = new Promise<boolean>((resolve) => {
    confirm = resolve;
  });
  const revoked: string[] = [];
  const oauthService = {
    getActiveProvider: async () => "new-api" as const,
    getLocalWebLogoutToken: async () => String(generation),
    logoutLocalWeb: async (token: string) => {
      if (token !== String(generation))
        throw Object.assign(new Error("stale"), { code: "XCODE_STALE_OWNER" });
      revoked.push(active);
    },
    logout: async () => {
      revoked.push(active);
    },
  };
  const alerts: Array<{ title: string }> = [];
  const logout = aiscooLocalWebOAuthLifecycle.createLogout!({
    oauthService,
    intl: { formatMessage: ({ id }) => zhCN[id as keyof typeof zhCN] ?? id },
    requestConfirmation: () => confirmation,
    requestAlert: async (payload) => {
      alerts.push(payload);
      return true;
    },
    setUser: vi.fn(),
    setOAuthError: vi.fn(),
    refreshProviderState: vi.fn(),
  });
  const pending = logout();
  await Promise.resolve();
  active = "B";
  generation++;
  confirm(true);
  await pending;
  expect(revoked).toEqual([]);
  expect(alerts).toHaveLength(1);
});

it("本地清理失败显示未完成，不能冒充本机已退出", async () => {
  const alerts: Array<{ title: string; description?: string }> = [];
  const logout = aiscooLocalWebOAuthLifecycle.createLogout!({
    oauthService: {
      logout: async () => {
        throw new Error("synthetic disk failure");
      },
      getLocalWebLogoutToken: async () => "generation-1",
      logoutLocalWeb: async () => {
        throw new Error("synthetic disk failure");
      },
      getActiveProvider: async () => null,
    },
    intl: { formatMessage: ({ id }) => zhCN[id as keyof typeof zhCN] ?? id },
    requestConfirmation: async () => true,
    requestAlert: async (payload) => {
      alerts.push(payload);
      return true;
    },
    setUser: vi.fn(),
    setOAuthError: vi.fn(),
    refreshProviderState: vi.fn(),
  });
  await logout();
  expect(alerts).toEqual([
    {
      title: "无法确认退出状态",
      description: "本机登录凭据或账号状态可能未完成清理，请检查后再继续。",
    },
  ]);
  expect(enUS["logout.localWeb.unconfirmed.description"]).toContain("could not be confirmed");
});
