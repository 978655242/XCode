import assert from "node:assert/strict";
import test from "node:test";
import { runLoginCommand, runLogoutCommand } from "../src/login-command.js";
import { buildLoginSelection } from "../src/command-center/login-flow.js";
import { createCommandCenter } from "../src/command-center.js";

test("Zen CLI login and logout route to isolated account without leaking secrets", async () => {
  let output = "";
  const stream = {
    write: (text: string) => {
      output += text;
    },
  };
  const ctx = { stdout: stream, stderr: stream } as never;
  const options = { json: true } as never;
  const deps = {
    env: {},
    loadDotenv: () => ({}),
    loginZenCli: async () => ({ providerId: "zen", user: { id: "1", display_name: "Test" } }),
    logoutZenCli: async () => ({ localCleared: true, serverRevoked: true }),
  };
  assert.equal(await runLoginCommand(ctx, options, deps as never, true, ["zen"]), 0);
  assert.match(output, /"zen"/);
  output = "";
  assert.equal(await runLogoutCommand(ctx, options, deps as never, ["zen"]), 0);
  assert.match(output, /serverRevoked/);
});
// 回归：顶层 login 曾不处理 SIGINT，服务端已签发 SID 后被 Ctrl+C 直接杀死，补偿撤销无机会执行。
test("SIGINT during Zen login aborts the flow and waits for compensation before exiting", async () => {
  const listeners = new Map<string, () => void>();
  const shutdownProcess = {
    platform: "darwin" as NodeJS.Platform,
    once(signal: NodeJS.Signals, listener: () => void) {
      listeners.set(signal, listener);
    },
    off(signal: NodeJS.Signals) {
      listeners.delete(signal);
    },
  };
  let compensated = false;
  let exitCode: number | undefined;
  const stream = { write: () => true };
  const deps = {
    env: {},
    loadDotenv: () => ({}),
    shutdownProcess,
    exitProcess: (code: number) => {
      exitCode = code;
    },
    loginZenCli: (options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => {
            // 模拟 bootstrap finally 中对已签发 SID 的异步撤销
            setTimeout(() => {
              compensated = true;
              reject(options.signal?.reason);
            }, 20);
          },
          { once: true },
        );
      }),
  };
  const pending = runLoginCommand(
    { stdout: stream, stderr: stream } as never,
    { json: true } as never,
    deps as never,
    true,
    ["zen"],
  );
  await new Promise((resolve) => setImmediate(resolve));
  listeners.get("SIGINT")?.();
  assert.notEqual(await pending, 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(compensated, true, "compensation ran before exit");
  assert.equal(exitCode, 130);
  assert.equal(listeners.size, 0, "signal handlers are removed afterwards");
});

test("Zen Plan is the first TUI login choice", () => {
  assert.equal(buildLoginSelection("zh-CN").items[0]?.command, "/login zen");
  assert.equal(buildLoginSelection("en-US").items[0]?.primary, "XWork Zen Plan");
  // TUI 只为带 pending 的选项保留可取消的等待态；缺失时浏览器授权期间无法 Esc 取消。
  const pending = buildLoginSelection("zh-CN").items[0]?.pending;
  assert.equal(pending?.primary, "等待 XWork Zen Plan 授权");
  assert.ok(pending?.cancelStatus);
  assert.equal(
    buildLoginSelection("en-US").items[0]?.pending?.primary,
    "Waiting for XWork Zen Plan authorization",
  );
});
test("Zen login explains an unavailable catalog without promising a model", async () => {
  const center = createCommandCenter({
    getApp: async () => {
      throw new Error("unused");
    },
    getLocale: () => "zh-CN",
    loginZen: async () => ({
      user: { username: "test", display_name: "Test" },
      modelStatus: { available: false, reason: "unavailable" },
    }),
  });
  const result = await center("/login zen", {});
  assert.match(result.response, /没有可用的 Zen 套餐模型/);
  assert.doesNotMatch(result.response, /使用 \/model/);
});
