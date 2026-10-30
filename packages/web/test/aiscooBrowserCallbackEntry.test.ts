// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:5173/"}
import { act } from "react";
import { createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ roots: [] as Root[], callback: vi.fn() }));
vi.mock("react-dom/client", async (load) => {
  const actual = await load<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      state.roots.push(root);
      return root;
    },
  };
});
vi.mock("@zcode/ui", () => ({
  AppErrorBoundary: () => null,
  Root: () => null,
  Button: ({ children }: { children: unknown }) =>
    createElement("button", null, children as string),
  generateMobileDeviceFingerprint: () => "browser-entry",
  installDocumentHiddenMotionPause: vi.fn(),
  playTaskNotificationSound: vi.fn(),
  setStreamClientId: vi.fn(),
  setWebRemoteControlTerminalTransportState: vi.fn(),
}));
vi.mock("@web/aiscoo-browser-account/index.js", () => ({
  createBrowserNewApiAccount: () => ({ oauth: { handleCallback: state.callback } }),
  registerBrowserAccountChannel: vi.fn(),
}));
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("VITE_AISCOO_BROWSER_NEW_API_ORIGIN", "https://account.example");
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(
    null,
    "",
    "/oauth/callback?provider=new-api&code=invalid&state=unknown",
  );
});
afterEach(async () => {
  await act(async () => {
    for (const root of state.roots.splice(0)) root.unmount();
  });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("invalid local callback displays the existing retry page instead of waiting forever", async () => {
  state.callback.mockResolvedValueOnce(null);
  await act(async () => {
    await import("@web/main.js");
  });
  expect(state.callback).toHaveBeenCalledExactlyOnceWith(window.location.href);
  expect(document.body.textContent).toContain("Sign-In Failed");
  expect(document.body.textContent).toContain("Sign In Again");
  expect(document.body.textContent).not.toContain("Finishing Sign-In");
});
