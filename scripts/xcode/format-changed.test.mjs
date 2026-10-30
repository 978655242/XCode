import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./format-changed.mjs", import.meta.url));
const root = dirname(dirname(dirname(script)));
const oxfmt = process.env.OXFMT_BIN ?? join(root, "node_modules/.bin/oxfmt");

const formatted = "export const value = { a: 1 };\n";
const unformatted = "export const value = {a:1}\n";

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "xwork-format-changed-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
    OXFMT_BIN: oxfmt,
  };
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const write = (path, content) => writeFileSync(join(cwd, path), content);
  git("init", "-q", "-b", "release");
  write(".oxfmtrc.json", "{}\n");
  write("legacy.ts", unformatted);
  write("clean.ts", formatted);
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("switch", "-q", "-c", "feature/x");
  const check = () =>
    spawnSync(process.execPath, [script, "release"], { cwd, env, encoding: "utf8" });
  return { git, write, check };
}

test("skips a changed file that was already unformatted on the base", (t) => {
  const repo = repository(t);
  repo.write("legacy.ts", `${unformatted}export const added = {b:2}\n`);
  repo.git("commit", "-qam", "append to legacy file");
  const result = repo.check();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /跳过（基线即未格式化）：legacy\.ts/);
});

test("still fails a new unformatted file", (t) => {
  const repo = repository(t);
  repo.write("new.ts", unformatted);
  repo.git("add", "new.ts");
  repo.git("commit", "-qm", "add new file");
  const result = repo.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /格式不符：new\.ts/);
});

test("still fails a previously formatted file that the change broke", (t) => {
  const repo = repository(t);
  repo.write("clean.ts", unformatted);
  repo.git("commit", "-qam", "break formatting");
  const result = repo.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /格式不符：clean\.ts/);
});

test("passes a change that touches only files oxfmt does not format", (t) => {
  const repo = repository(t);
  repo.write("assets.zip", "PK\u0003\u0004binary");
  repo.git("add", "assets.zip");
  repo.git("commit", "-qm", "add binary asset");
  const result = repo.check();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /格式不符/);
});

test("passes formatted changes without listing anything", (t) => {
  const repo = repository(t);
  repo.write("clean.ts", `${formatted}export const more = 2;\n`);
  repo.git("commit", "-qam", "formatted change");
  const result = repo.check();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});
