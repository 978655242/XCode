import { describe, expect, it, vi } from "vitest";
import { applyCachedOAuthSessionRestoreResult } from "@/root/oauthCachedSessionRestore.js";

describe("applyCachedOAuthSessionRestoreResult", () => {
  it("clears the displayed user, shows one expiry alert, then opens reauthentication", async () => {
    const setUser = vi.fn();
    const requestAlert = vi.fn(async () => true);
    const onReauthenticationRequired = vi.fn();

    await applyCachedOAuthSessionRestoreResult({
      result: {
        status: "reauthentication-required",
        reason: "jwt-expired",
      },
      setUser,
      requestAlert,
      onReauthenticationRequired,
      copy: {
        title: "登录已过期",
        description: "为了保障账号安全，请重新登录。",
        actionLabel: "重新登录",
      },
    });

    expect(setUser).toHaveBeenCalledWith(null);
    expect(requestAlert).toHaveBeenCalledTimes(1);
    expect(requestAlert).toHaveBeenCalledWith({
      title: "登录已过期",
      description: "为了保障账号安全，请重新登录。",
      actionLabel: "重新登录",
    });
    expect(onReauthenticationRequired).toHaveBeenCalledTimes(1);
    expect(requestAlert.mock.invocationCallOrder[0]).toBeLessThan(
      onReauthenticationRequired.mock.invocationCallOrder[0],
    );
  });

  it.each(["before-alert", "during-alert"])(
    "does not reopen Native credential recovery after a new login %s",
    async (timing) => {
      let signedOut = timing !== "before-alert";
      const setUser = vi.fn();
      const onReauthenticationRequired = vi.fn();
      const requestAlert = vi.fn(async () => {
        signedOut = false;
        return true;
      });

      await applyCachedOAuthSessionRestoreResult({
        result: { status: "unavailable", reason: "credential-recovery-required" },
        setUser,
        requestAlert,
        onReauthenticationRequired,
        shouldReauthenticate: async () => signedOut,
        copy: { title: "Private credentials need recovery" },
      });

      expect(requestAlert).toHaveBeenCalledTimes(timing === "before-alert" ? 0 : 1);
      expect(setUser).toHaveBeenCalledTimes(timing === "before-alert" ? 0 : 1);
      expect(onReauthenticationRequired).not.toHaveBeenCalled();
    },
  );
});
