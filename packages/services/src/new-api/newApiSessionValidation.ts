import { Buffer } from "node:buffer";
import { NewApiMeSchema, NewApiSessionBundleSchema, type NewApiSessionBundle, type UserInfo } from "@zcode/shared";

export function sessionError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

export function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : "XCODE_BACKEND_UNAVAILABLE";
}

export function isRevocation(error: unknown): boolean {
  return ["XCODE_SESSION_INVALID", "XCODE_CREDENTIAL_SCOPE_DENIED"].includes(errorCode(error));
}

export function validateSession(bundle: NewApiSessionBundle, now: number, fresh: boolean): void {
  if (!NewApiSessionBundleSchema.safeParse(bundle).success) throw sessionError("XCODE_PROTOCOL_INVALID");
  try {
    const segments = bundle.access_token.split(".");
    if (segments.length !== 3 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) throw new Error();
    const claims = JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8"));
    if (claims.iss !== "new-api" || !Array.isArray(claims.aud) || claims.aud.length !== 1 ||
      claims.aud[0] !== "new-api-xcode" || claims.token_use !== "xcode_access" ||
      claims.sub !== bundle.user.id || claims.sid !== bundle.session_id ||
      !Number.isSafeInteger(claims.exp) || claims.exp * 1000 !== bundle.access_expires_at ||
      (fresh && (bundle.access_expires_at <= now || bundle.refresh_expires_at <= now ||
        bundle.relay_credential.expires_at <= now))) throw new Error();
  } catch { throw sessionError("XCODE_PROTOCOL_INVALID"); }
}

export function confirmedProfile(value: unknown, bundle: NewApiSessionBundle): UserInfo {
  const result = NewApiMeSchema.safeParse(value);
  if (!result.success) throw sessionError("XCODE_PROTOCOL_INVALID");
  const me = result.data;
  if (me.session_id !== bundle.session_id || me.user.id !== bundle.user.id) {
    throw sessionError("XCODE_SESSION_INVALID");
  }
  return { id: me.user.id, username: me.user.username, displayName: me.user.display_name,
    ...(me.user.avatar_url === null ? {} : { avatarUrl: me.user.avatar_url }) };
}
