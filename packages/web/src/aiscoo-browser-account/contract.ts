import type { IOAuthService } from "@zcode/services";
import type { NewApiOwner } from "@zcode/shared";

export interface BrowserNewApiAccountOptions {
  /** Canonicalized New API origin; used for authorization and storage isolation. */
  origin: string;
  /** Exact http://127.0.0.1:<non-default-port> origin, without a path. */
  browserOrigin: string;
  localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  locks: { request<T>(name: string, run: () => Promise<T>): Promise<T> };
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  crypto?: Pick<Crypto, "getRandomValues" | "subtle">;
}

export interface BrowserNewApiAccount {
  readonly oauth: IOAuthService;
  /** Null until /me confirms login or restore; callers await restore before attachment. */
  getOwner(): NewApiOwner | null;
  getControlCredential(expected: NewApiOwner): Promise<{ accessToken: string; owner: NewApiOwner }>;
  getRelayCredential(expected: NewApiOwner): Promise<{ token: string; expiresAt: number }>;
  /** Invalidates this page's in-flight work; persistent login and pending navigation survive. */
  dispose(): void;
}
