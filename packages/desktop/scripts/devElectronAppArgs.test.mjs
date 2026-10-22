import assert from "node:assert/strict";
import test from "node:test";
import { DEV_ELECTRON_APP_ARGS_ENV, resolveDevElectronAppArgs } from "./devElectronAppArgs.mjs";

test("forwards --open-workspace to the dev Electron app", () => {
  assert.deepEqual(resolveDevElectronAppArgs({}), []);
  assert.deepEqual(
    resolveDevElectronAppArgs({ [DEV_ELECTRON_APP_ARGS_ENV]: '["--open-workspace=/tmp/a b"]' }),
    ["--open-workspace=/tmp/a b"],
  );
  assert.deepEqual(
    resolveDevElectronAppArgs({ [DEV_ELECTRON_APP_ARGS_ENV]: '["--open-workspace","/tmp/w"]' }),
    ["--open-workspace", "/tmp/w"],
  );
});

test("rejects malformed values and arbitrary Chromium or Node switches", () => {
  for (const raw of [
    "--open-workspace=/tmp",
    '"x"',
    "[1]",
    '["--inspect"]',
    '["--remote-debugging-port=1"]',
  ]) {
    assert.throws(() => resolveDevElectronAppArgs({ [DEV_ELECTRON_APP_ARGS_ENV]: raw }), raw);
  }
});
