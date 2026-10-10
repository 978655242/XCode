import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { PlatformChannels } from "@zcode/shared";
import { createOAuthCallbackHandler } from "../src/preload/oauthCallbackBridge.js";

const delivered: Array<{ windowId: number; channel: string; value: unknown }> = [];
const windows = [1, 2].map((id) => ({
  webContents: {
    id,
    send: (channel: string, value: unknown) => delivered.push({ windowId: id, channel, value }),
  },
  isMinimized: () => false,
  isVisible: () => true,
  focus() {},
}));
mock.module("electron", {
  namedExports: {
    app: { show() {} },
    dialog: {},
    BrowserWindow: { getAllWindows: () => windows, getFocusedWindow: () => windows[1] },
  },
});
// Electron 不是普通 Node 模块：先安装原生投递 mock，再加载真实 Main 路由。
const {
  parseOAuthStateRegistration,
  registerOAuthState,
  handleDeepLink,
  deliverPendingDeepLink,
  clearOAuthRoutesForWindow,
} = await import("../src/main/desktopOAuthDeepLink.js");
mock.timers.enable({ apis: ["setTimeout"] });
const logger = { info() {}, warn() {} };
const nativeState = "n".repeat(32);
const closedState = "c".repeat(32);
const callback = (state: string, provider = "new-api") =>
  `zcode://oauth/callback?provider=${provider}&state=${state}&code=${"c".repeat(43)}`;
const reset = () => {
  clearOAuthRoutesForWindow(1);
  clearOAuthRoutesForWindow(2);
  delivered.length = 0;
};

// XCODE: 真实 Main 路由必须保护窗口/用途；只替换 Electron 原生投递，不替换被测路由。
test("registration rejects missing or conflicting provider/purpose", () => {
  assert.equal(parseOAuthStateRegistration({ state: "s" }), null);
  assert.equal(
    parseOAuthStateRegistration({ state: "s", provider: "new-api", purpose: "official-cloud" }),
    null,
  );
  assert.equal(
    parseOAuthStateRegistration({ state: "s", provider: "zai", purpose: "unknown" }),
    null,
  );
});
test("legacy official primary login retains its window-purpose route", async () => {
  reset();
  deliverPendingDeepLink(windows[0]!.webContents as never);
  const registration = parseOAuthStateRegistration({
    state: "legacy-primary-state",
    provider: "bigmodel",
    purpose: "primary-account",
  });
  assert.ok(registration);
  registerOAuthState(1, registration);
  const url = callback("legacy-primary-state", "bigmodel");
  assert.equal(handleDeepLink(url, logger), true);
  const message = delivered.find((entry) => entry.channel === PlatformChannels.OAuthCallback);
  assert.ok(message);
  assert.deepEqual(message, {
    windowId: 1,
    channel: PlatformChannels.OAuthCallback,
    value: { url, provider: "bigmodel", purpose: "primary-account" },
  });
  let acceptedPurpose: string | undefined;
  let handled = false;
  await createOAuthCallbackHandler(
    (event) => {
      acceptedPurpose = event.purpose;
    },
    () => {
      handled = true;
    },
  )(null, message.value);
  assert.equal(acceptedPurpose, "primary-account");
  assert.equal(handled, true);
  reset();
});
test("unmatched OAuth cannot populate the next ready window's global callback slot", () => {
  reset();
  assert.equal(handleDeepLink(callback("unregistered"), logger), false);
  deliverPendingDeepLink(windows[1]!.webContents as never);
  assert.deepEqual(
    delivered.filter((entry) => entry.channel === PlatformChannels.OAuthCallback),
    [],
  );
});
test("registered not-ready callback only reaches its original window", () => {
  reset();
  registerOAuthState(1, { state: nativeState, provider: "new-api", purpose: "primary-account" });
  handleDeepLink(callback(nativeState), logger);
  assert.deepEqual(delivered, []);
  deliverPendingDeepLink(windows[1]!.webContents as never);
  assert.deepEqual(delivered, []);
  deliverPendingDeepLink(windows[0]!.webContents as never);
  const deliveredEvent = delivered[0];
  assert.equal(deliveredEvent?.windowId, 1);
  assert.equal(deliveredEvent?.channel, PlatformChannels.OAuthCallback);
  assert.ok(
    deliveredEvent.value &&
      typeof deliveredEvent.value === "object" &&
      "provider" in deliveredEvent.value &&
      deliveredEvent.value.provider === "new-api" &&
      "purpose" in deliveredEvent.value &&
      deliveredEvent.value.purpose === "primary-account",
  );
  handleDeepLink(callback(nativeState), logger);
  assert.equal(delivered.length, 1);
});
test("wrong provider, duplicate state and closed-window callback never change route owner", () => {
  reset();
  deliverPendingDeepLink(windows[0]!.webContents as never);
  registerOAuthState(1, { state: nativeState, provider: "new-api", purpose: "primary-account" });
  registerOAuthState(2, { state: nativeState, provider: "new-api", purpose: "primary-account" });
  assert.equal(handleDeepLink(callback(nativeState, "zai"), logger), false);
  assert.equal(handleDeepLink(`${callback(nativeState)}&state=other`, logger), false);
  assert.equal(delivered.length, 0);
  assert.equal(handleDeepLink(callback(nativeState), logger), true);
  assert.equal(delivered[0]?.windowId, 1);
  registerOAuthState(1, { state: closedState, provider: "new-api", purpose: "primary-account" });
  clearOAuthRoutesForWindow(1);
  handleDeepLink(callback(closedState), logger);
  deliverPendingDeepLink(windows[1]!.webContents as never);
  assert.equal(delivered.length, 1);
  reset();
});

test("new primary flow retires only its window-purpose predecessor and preserves official routing", () => {
  reset();
  deliverPendingDeepLink(windows[0]!.webContents as never);
  registerOAuthState(1, { state: nativeState, provider: "new-api", purpose: "primary-account" });
  registerOAuthState(1, { state: "official-state", provider: "zai", purpose: "official-cloud" });
  registerOAuthState(1, { state: closedState, provider: "new-api", purpose: "primary-account" });
  assert.equal(handleDeepLink(callback(nativeState), logger), false);
  assert.equal(handleDeepLink(callback("official-state", "zai"), logger), true);
  assert.equal(handleDeepLink(callback(closedState), logger), true);
  assert.deepEqual(
    delivered.map(({ value }) => {
      assert.ok(
        value &&
          typeof value === "object" &&
          "purpose" in value &&
          typeof value.purpose === "string",
      );
      return value.purpose;
    }),
    ["official-cloud", "primary-account"],
  );
  reset();
});
