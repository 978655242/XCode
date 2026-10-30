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
  begin(provider: OAuthProviderId, attempt: number, userGesture: boolean): void;
  beforeStart(attempt: number): Promise<boolean> | undefined;
  /** 返回授权页打开操作；null 表示此次启动已结束。 */
  acceptResponse(attempt: number, response: OAuthStartResponse): (() => boolean) | null;
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
