import assert from "node:assert/strict";
import test from "node:test";
import { createXworkCommandCenter, runXwork } from "../src/xwork/index.js";
import { createCommandCenter } from "../src/command-center.js";
import type { CommandCenterDeps } from "../src/command-center/types.js";

function capture() {
  let output = "";
  const stream = {
    write: (text: string) => {
      output += text;
      return true;
    },
  };
  return { stream, read: () => output, reset: () => (output = "") };
}

test("Zen CLI login and logout route to isolated account without leaking secrets", async () => {
  const out = capture();
  const ctx = (argv: string[]) => ({ argv, stdout: out.stream, stderr: out.stream }) as never;
  const deps = {
    env: {},
    loadDotenv: () => ({}),
    loginZenCli: async () => ({ providerId: "zen", user: { id: "1", display_name: "Test" } }),
    logoutZenCli: async () => ({ localCleared: true, serverRevoked: true }),
  };
  assert.equal(await runXwork(ctx(["login", "zen", "--json", "--no-browser"]), deps as never), 0);
  assert.match(out.read(), /"provider": "zen"/);
  out.reset();
  assert.equal(await runXwork(ctx(["logout", "zen", "--json"]), deps as never), 0);
  assert.match(out.read(), /"serverRevoked": true/);
});

test("Zen CLI reports failure with exit code 1 and no stack", async () => {
  const out = capture();
  const deps = {
    env: {},
    loadDotenv: () => ({}),
    logoutZenCli: async () => {
      throw new Error("XCODE_STALE_OWNER");
    },
  };
  const code = await runXwork(
    { argv: ["logout", "zen"], stdout: out.stream, stderr: out.stream } as never,
    deps as never,
  );
  assert.equal(code, 1);
  assert.equal(out.read(), "Error: XCODE_STALE_OWNER\n");
});

test("help keeps upstream text and appends Zen commands once", async () => {
  const out = capture();
  const code = await runXwork(
    { argv: ["--help", "--locale", "zh-CN"], stdout: out.stream, stderr: out.stream } as never,
    { env: {} } as never,
  );
  assert.equal(code, 0);
  assert.match(out.read(), /login \[zai\|bigmodel\]/);
  assert.equal(out.read().match(/login zen/g)?.length, 1);
  assert.match(out.read(), /退出 XWork Zen Plan/);
});

const zenDeps = (status = { available: false, reason: "unavailable" }) => ({
  loginZen: async () => ({ user: { username: "test", display_name: "Test" }, modelStatus: status }),
  logoutZen: async () => ({ localCleared: true, serverRevoked: false }),
  refreshAccountModels: async () => {},
});
const baseDeps = (locale: "zh-CN" | "en-US"): CommandCenterDeps => ({
  getApp: async () => {
    throw new Error("unused");
  },
  getLocale: () => locale,
  resumeApp: async () => {
    throw new Error("unused");
  },
});

test("Zen Plan is prepended to the unchanged upstream login choices", async () => {
  const upstream = await createCommandCenter(baseDeps("zh-CN"))("/login", {} as never);
  const center = createXworkCommandCenter(baseDeps("zh-CN"), zenDeps());
  const items = (await center("/login", {} as never)).selection?.items ?? [];
  assert.equal(items[0]?.command, "/login zen");
  // TUI 只为带 pending 的选项保留可取消的等待态；缺失时浏览器授权期间无法 Esc 取消。
  assert.equal(items[0]?.pending?.primary, "等待 XWork Zen Plan 授权");
  assert.ok(items[0]?.pending?.cancelStatus);
  assert.deepEqual(
    items.slice(1).map((item) => item.id),
    upstream.selection?.items.map((item) => item.id),
  );
});

test("without Zen configured the command center is the upstream one", async () => {
  const center = createXworkCommandCenter(baseDeps("en-US"), undefined);
  const items = (await center("/login", {} as never)).selection?.items ?? [];
  assert.equal(
    items.some((item) => item.id === "zen"),
    false,
  );
});

test("Zen login explains an unavailable catalog without promising a model", async () => {
  const center = createXworkCommandCenter(baseDeps("zh-CN"), zenDeps());
  const result = await center("/login zen", {} as never);
  assert.match(result.response, /没有可用的 Zen 套餐模型/);
  assert.doesNotMatch(result.response, /使用 \/model/);
});

test("Zen logout reports unconfirmed server revocation", async () => {
  const center = createXworkCommandCenter(baseDeps("en-US"), zenDeps());
  const result = await center("/logout zen", {} as never);
  assert.match(result.response, /could not be confirmed/);
});

test("slash /help keeps upstream text and appends Zen commands", async () => {
  const upstream = await createCommandCenter(baseDeps("en-US"))("/help", {} as never);
  const result = await createXworkCommandCenter(baseDeps("en-US"), zenDeps())("/help", {} as never);
  assert.ok(result.response.startsWith(upstream.response));
  assert.match(result.response, /\/login zen/);
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
  const exited = Promise.withResolvers<number>();
  const loginStarted = Promise.withResolvers<void>();
  const compensation = Promise.withResolvers<void>();
  const out = capture();
  // 模拟 bootstrap finally 中对已签发 SID 的异步撤销：由测试控制何时完成。
  const loginZenCli = async (options: { signal?: AbortSignal }) => {
    loginStarted.resolve();
    const { promise, reject } = Promise.withResolvers<never>();
    options.signal?.addEventListener(
      "abort",
      () =>
        void compensation.promise.then(() => {
          compensated = true;
          reject(options.signal?.reason);
        }),
      { once: true },
    );
    return promise;
  };
  const deps = {
    env: {},
    loadDotenv: () => ({}),
    shutdownProcess,
    exitProcess: (code: number) => exited.resolve(code),
    loginZenCli,
  };
  const pending = runXwork(
    { argv: ["login", "zen", "--json", "--no-browser"], stdout: out.stream, stderr: out.stream } as never,
    deps as never,
  );
  await loginStarted.promise;
  listeners.get("SIGINT")?.();
  let exitedEarly = false;
  void exited.promise.then(() => (exitedEarly = !compensated));
  compensation.resolve();
  assert.notEqual(await pending, 0);
  assert.equal(await exited.promise, 130);
  assert.equal(compensated, true, "compensation ran");
  assert.equal(exitedEarly, false, "process did not exit before compensation finished");
  assert.equal(listeners.size, 0, "signal handlers are removed afterwards");
});
