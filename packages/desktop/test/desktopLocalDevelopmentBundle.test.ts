import assert from "node:assert/strict";
import test from "node:test";

import { isLocalDevelopmentBundleLaunch } from "../src/main/desktopLocalDevelopmentBundle.js";

test("recognizes current and legacy generated macOS development bundles", () => {
  assert.equal(
    isLocalDevelopmentBundleLaunch({
      env: { ZCODE_LOCAL_DEV_BUNDLE: "1" },
      execPath:
        "/Users/example/ai/XCode/.zcode-runtime/desktop-dev/41.0.3-arm64/Aiscoo Dev.app/Contents/MacOS/Electron",
      platform: "darwin",
    }),
    true,
  );
  assert.equal(
    isLocalDevelopmentBundleLaunch({
      env: { ZCODE_LOCAL_DEV_BUNDLE: "1" },
      execPath:
        "/Users/example/ai/XCode/.zcode-runtime/desktop-dev/41.0.3-arm64/XWork Dev.app/Contents/MacOS/Electron",
      platform: "darwin",
    }),
    true,
  );
  assert.equal(
    isLocalDevelopmentBundleLaunch({
      env: { ZCODE_LOCAL_DEV_BUNDLE: "1" },
      execPath:
        "/Users/example/ai/XCode/.zcode-runtime/desktop-dev/41.0.3-arm64/XCode Dev.app/Contents/MacOS/Electron",
      platform: "darwin",
    }),
    true,
  );
  assert.equal(
    isLocalDevelopmentBundleLaunch({
      env: { ZCODE_LOCAL_DEV_BUNDLE: "1" },
      execPath: "/Applications/XCode.app/Contents/MacOS/XCode",
      platform: "darwin",
    }),
    false,
  );
});
