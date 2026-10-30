import type { NewApiSessionBundle, UserInfo } from "@zcode/shared";
import type { NewApiProviderAdapter } from "../oauth/providers/newApiProviderAdapter.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { NewApiSessionRepo, NewApiStoredSession } from "./newApiSessionRepo.js";
import {
  confirmedProfile,
  errorCode,
  sessionError,
  validateSession,
} from "./newApiSessionValidation.js";

const log = createServiceLogger("newApiAccount");

export interface NewApiSessionRefreshFlight {
  session: NewApiStoredSession;
  generation: number;
  promise: Promise<void>;
}

export function refreshStoredSession(
  repo: NewApiSessionRepo,
  adapter: NewApiProviderAdapter,
  expected: NewApiStoredSession,
  now: () => number,
  assertCurrent: () => void,
  onAcquired: (bundle: NewApiSessionBundle) => void,
): Promise<NewApiStoredSession | null> {
  return repo.refreshCurrent(expected, async (current) => {
    assertCurrent();
    if (
      current.access_token !== expected.bundle.access_token &&
      current.access_expires_at > now() &&
      current.refresh_expires_at > now() &&
      current.relay_credential.expires_at > now()
    )
      return current;
    const bundle = await adapter.refresh(current);
    onAcquired(bundle);
    validateSession(bundle, now(), true);
    if (
      bundle.user.id !== expected.bundle.user.id ||
      bundle.session_id !== expected.bundle.session_id ||
      bundle.relay_credential.token !== expected.bundle.relay_credential.token ||
      bundle.refresh_token === current.refresh_token
    )
      throw sessionError("XCODE_SESSION_INVALID");
    return bundle;
  });
}

export async function restoreSessionProfile(
  adapter: NewApiProviderAdapter,
  record: NewApiStoredSession,
  currentSession: () => NewApiStoredSession | null,
  now: () => number,
  refresh: () => Promise<void>,
): Promise<UserInfo> {
  if (record.bundle.refresh_expires_at <= now()) throw sessionError("XCODE_SESSION_INVALID");
  if (record.bundle.access_expires_at <= now()) await refresh();
  try {
    return confirmedProfile(
      await adapter.client.getMe(currentSession()!.bundle.access_token),
      currentSession()!.bundle,
    );
  } catch (error) {
    if (errorCode(error) !== "XCODE_ACCESS_EXPIRED" || currentSession() !== record) throw error;
    await refresh();
    return confirmedProfile(
      await adapter.client.getMe(currentSession()!.bundle.access_token),
      currentSession()!.bundle,
    );
  }
}

// XCODE: 返回是否已确认远端撤销；失败只记录静态错误码，本机 Web 退出据此拒绝“已撤销”，桌面调用方忽略返回值。
export async function revokeSession(
  adapter: NewApiProviderAdapter,
  bundle: NewApiSessionBundle,
): Promise<boolean> {
  try {
    await adapter.logout(bundle);
    log.info(undefined, "Private session remotely revoked");
    return true;
  } catch (error) {
    log.warn(undefined, "Private session remote revocation failed", errorCode(error));
    return false;
  }
}
