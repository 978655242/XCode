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
    // 未配对的值会被 Main 当作深链或其他 argv 处理，必须整体拒绝。
    '["zcode://workspace/open?path=/real"]',
    '["/tmp/stray"]',
    '["--open-workspace"]',
    '["--open-workspace="]',
    '["--open-workspace","--inspect"]',
    '["--open-workspace=/tmp/w","extra"]',
    // 路径值本身含深链（含编码形式）同样会被 Main 的深链提取命中。
    '["--open-workspace=zcode://workspace/open?path=/real"]',
    '["--open-workspace","%7Acode%3A//workspace/open"]',
  ]) {
    assert.throws(() => resolveDevElectronAppArgs({ [DEV_ELECTRON_APP_ARGS_ENV]: raw }), raw);
  }
});
