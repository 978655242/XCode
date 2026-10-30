import type { Event } from "@zcode/rpc";
import type {
  IPlatformService,
  OAuthCachedSessionRestoreResult,
  OAuthProviderId,
  OAuthProviderMeta,
  OAuthSessionState,
  OAuthStartResponse,
  UserInfo,
} from "@zcode/shared";

/** 可选工厂只协调视图；身份事实由 OAuth 服务拥有。 */
export interface OAuthLifecycleExtension {
  createLogin(context: OAuthLoginContext): OAuthLoginLifecycle;
  createSession(context: OAuthSessionContext): OAuthSessionLifecycle;
  createLogout?(context: OAuthLogoutContext): () => Promise<void>;
}

export interface OAuthLoginContext {
  platform: IPlatformService;
  oauthService: object;
  currentAttempt: () => number;
  invalidateAttempt: () => void;
  setManualAuthorizationUrl: (url: string | null) => void;
  fail: () => void;
}

export interface OAuthLoginLifecycle {
  mount(): () => void;
  /**
   * 同步开始一次尝试（可预开授权窗口）。返回启动前握手的准入结果；undefined 表示该 provider 不归扩展。
   * 准入为 false 时扩展已结束本次尝试，调用方不得再启动授权。
   */
  begin(
    provider: OAuthProviderId,
    attempt: number,
    userGesture: boolean,
  ): Promise<boolean> | undefined;
  /**
   * 返回授权页打开操作；null 表示此次启动已结束。尝试已失效（取消、关闭、被替换）时，
   * 按响应的 state 释放 Host 侧授权且不导航。
   */
  acceptResponse(attempt: number, response: OAuthStartResponse): (() => boolean) | null;
  /**
   * 用户取消：仅按本标签尝试的 state 撤销对应授权。返回 null 表示该 provider 不归扩展，
   * 由调用方沿用原 provider 级取消。
   */
  cancel(provider?: OAuthProviderId): Promise<void> | null;
  clear(invalidateAttempt?: boolean): void;
}

export interface OAuthSessionContext {
  oauthService: {
    readonly onDidChangeSession: Event<OAuthSessionState>;
    getProviders: () => Promise<OAuthProviderMeta[]>;
    getActiveProvider: () => Promise<OAuthProviderId | null>;
    restoreCachedSessionState: () => Promise<OAuthCachedSessionRestoreResult>;
  };
  setUser: (user: UserInfo | null) => void;
  setIsRestoringOAuthSession: (restoring: boolean) => void;
  setOAuthError: (error: string | null) => void;
  loginFailureMessage: () => string;
  refreshProviderState: () => Promise<void>;
  markOAuthSuccess: (provider?: OAuthProviderId) => void;
}

export interface OAuthSessionLifecycle {
  readonly preserveIdentityOnReadError: boolean;
  mount(): () => void;
  captureRevision(): number;
  isCurrent(revision: number): boolean;
  admitStartup(revision: number): Promise<boolean>;
}

export interface OAuthLogoutContext {
  oauthService: {
    logout: () => Promise<void>;
    getActiveProvider: () => Promise<OAuthProviderId | null>;
    getLocalWebLogoutToken?: () => Promise<string>;
    logoutLocalWeb?: (token: string) => Promise<void>;
  };
  intl: {
    formatMessage: (descriptor: { id: string }, values?: Record<string, string | number>) => string;
  };
  requestConfirmation: (payload: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
  requestAlert: (payload: {
    title: string;
    description?: string;
    actionLabel?: string;
  }) => Promise<boolean>;
  setUser: (user: UserInfo | null) => void;
  setOAuthError: (error: string | null) => void;
  refreshProviderState: () => Promise<void>;
}

export type OAuthLifecyclePlatform = IPlatformService & {
  oauthLifecycle?: OAuthLifecycleExtension;
};
