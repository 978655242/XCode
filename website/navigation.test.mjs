import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");

// 回归依据：旧页面把主要内容放进 dialog，只有首屏，用户无法下拉阅读。
test("official-site content is present in the document before interaction", () => {
  for (const id of ["product", "scenarios", "developers", "download", "about"]) {
    const section = markup.match(
      new RegExp(`<section\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/section>`),
    );
    assert.ok(section, `Missing document section: ${id}`);
    assert.match(section[1], /<h2\b/, `${id} must have a visible heading`);
    assert.match(section[1], /<p\b/, `${id} must contain readable content`);
  }
  assert.doesNotMatch(markup, /<dialog\b/);
  assert.doesNotMatch(html, /data-panel|showModal\(/);
});

test("primary navigation and calls to action use resolvable native anchors", () => {
  const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const nav = markup.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav, "Main navigation must exist");
  for (const id of ["product", "scenarios", "developers", "download", "about"]) {
    assert.ok(nav.includes(`href="#${id}"`), `Missing native navigation to ${id}`);
  }
  for (const [, destination] of markup.matchAll(/<a\b[^>]*href="#([^"]+)"/g)) {
    assert.ok(ids.has(destination), `Unresolved anchor: #${destination}`);
  }
  assert.match(markup, /<a\b[^>]*class="cta primary"[^>]*href="#download"/);
  assert.match(markup, /<a\b[^>]*class="cta secondary"[^>]*href="#product"/);
});

// 回归依据：HTML 格式化会折叠普通 code 的换行，复制后把三条命令变成一条。
test("setup commands preserve executable line breaks after HTML formatting", () => {
  const code = markup.match(/<code\b[^>]*id="setup-code"[^>]*>([\s\S]*?)<\/code\s*>/);
  assert.ok(code, "Setup commands must exist");
  const commands = code[1].replace(/&#(?:10|x0a);/gi, "\n");
  assert.equal(
    commands.trim(),
    "git clone https://github.com/978655242/aiscoo.git\ncd aiscoo\npnpm bootstrap",
  );
});
