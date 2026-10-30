import type { IChannelClient, IDisposable } from "@zcode/rpc";
import type { IOAuthService } from "@zcode/services";
import type { NewApiOwner, OAuthCachedSessionRestoreResult } from "@zcode/shared";

export const BROWSER_ACCOUNT_CHANNEL = "aiscoo/browser-account" as const;

/** Positional arguments and results follow IOAuthService; cached restoration uses `restore`. */
export const BROWSER_ACCOUNT_OAUTH_METHODS = [
  "getProviders",
  "getActiveProvider",
  "restoreSession",
  "startOAuth",
  "startOAuthWithPolling",
  "pollPendingOAuth",
  "handleCallback",
  "refreshToken",
  "logout",
  "logoutAll",
  "cancelPending",
] as const satisfies readonly (keyof IOAuthService)[];

export type BrowserAccountOAuthMethod = (typeof BROWSER_ACCOUNT_OAUTH_METHODS)[number];
export type BrowserAccountOAuthRequest = {
  [M in BrowserAccountOAuthMethod]: { method: M; args: Parameters<IOAuthService[M]> };
}[BrowserAccountOAuthMethod];
export type BrowserAccountOAuthResult<M extends BrowserAccountOAuthMethod> = Awaited<
  ReturnType<IOAuthService[M]>
>;

export interface BrowserAccountSessionEvent {
  owner: NewApiOwner | null;
}

export interface BrowserAccountRestoreResult extends BrowserAccountSessionEvent {
  session: OAuthCachedSessionRestoreResult;
}

export interface BrowserAccountControlRequest {
  owner: NewApiOwner;
}

export interface BrowserAccountControlResult {
  owner: NewApiOwner;
  accessToken: string;
}

export interface BrowserAccountRelayRequest {
  owner: NewApiOwner;
}

export interface BrowserAccountRelayResult {
  token: string;
  expiresAt: number;
}

/** Browser-served reverse channel on the existing socket; never contains a refresh token. */
export interface BrowserAccountWireCommands {
  restore: { arg: undefined; result: BrowserAccountRestoreResult };
  control: { arg: BrowserAccountControlRequest; result: BrowserAccountControlResult };
  relay: { arg: BrowserAccountRelayRequest; result: BrowserAccountRelayResult };
  oauth: {
    arg: BrowserAccountOAuthRequest;
    result: BrowserAccountOAuthResult<BrowserAccountOAuthMethod>;
  };
}

export interface BrowserAccountAuthority {
  readonly oauth: IOAuthService;
  getOwner(): NewApiOwner | null;
  isCurrent(owner: NewApiOwner): boolean;
  withControlSession<T>(
    action: (accessToken: string, owner: NewApiOwner) => Promise<T>,
  ): Promise<T>;
  getRelayCredential(owner: NewApiOwner): Promise<BrowserAccountRelayResult>;
}

export interface BrowserAccountBridgeOptions {
  onOwnerChanged?: (owner: NewApiOwner | null) => void | Promise<void>;
}

export interface BrowserAccountAttachment extends IDisposable {
  /** Includes the first reverse restore and acceptance by onOwnerChanged. */
  readonly ready: Promise<void>;
}

export interface BrowserAccountBridge extends IDisposable {
  readonly authority: BrowserAccountAuthority;
  /** Throws synchronously while another attachment is live, or after bridge disposal. */
  attach(client: IChannelClient): BrowserAccountAttachment;
}
