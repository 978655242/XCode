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
test("Zen Plan is the first TUI login choice", () => {
  assert.equal(buildLoginSelection("zh-CN").items[0]?.command, "/login zen");
  assert.equal(buildLoginSelection("en-US").items[0]?.primary, "XWork Zen Plan");
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
