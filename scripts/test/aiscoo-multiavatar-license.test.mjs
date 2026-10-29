import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { isReviewedMultiavatarLicense } from "../license-identifiers.mjs";

test("账号头像专用许可仅接受已核验的 Multiavatar 精确三元组", () => {
  const avatar = {
    name: "@multiavatar/multiavatar",
    version: "1.0.7",
    license: "SEE LICENSE IN LICENSE",
  };
  assert.equal(isReviewedMultiavatarLicense(avatar), true);
  for (const changed of [
    { name: "multiavatar" },
    { name: "@unreviewed/multiavatar" },
    { name: "unknown" },
    { version: "1.0.6" },
    { version: "1.0.8" },
    { version: "^1.0.7" },
    { version: "1.0.7-beta.1" },
    { license: "MIT" },
    { license: "AGPL-3.0" },
    { license: "Multiavatar v1.0" },
    { license: "SEE LICENSE IN LICENSE.md" },
    { license: "see license in license" },
    { license: " SEE LICENSE IN LICENSE " },
    { license: { type: "SEE LICENSE IN LICENSE" } },
    { license: ["SEE LICENSE IN LICENSE"] },
    { license: undefined },
  ]) {
    assert.equal(isReviewedMultiavatarLicense({ ...avatar, ...changed }), false);
  }
});

test("实际门禁读取原始 Multiavatar 标识且保持其他 SEE LICENSE 包阻断", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aiscoo-license-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = join(root, "scripts");
  await mkdir(join(scripts, "aiscoo"), { recursive: true });
  for (const file of ["licenses.mjs", "license-identifiers.mjs", "aiscoo/multiavatar-license.mjs"]) {
    await copyFile(new URL(`../${file}`, import.meta.url), join(scripts, file));
  }
  // 隔离安装图和声明 IO，只运行真实门禁与复核代码，避免测试改写工作区依赖。
  await writeFile(
    join(scripts, "generate-third-party-notices.mjs"),
    "export const generateThirdPartyNotices = () => {};\n",
  );
  await writeFile(
    join(scripts, "third-party-notices.mjs"),
    "export const readVerifiedNotices = () => {};\n",
  );
  await writeFile(
    join(scripts, "third-party-npm.mjs"),
    `
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile(new URL("./fixture.json", import.meta.url), "utf8"));
export const readWorkspaceProductionGraph = () => ({ required: new Map([[\`\${pkg.name}@\${pkg.version}\`, pkg]]), projects: [] });
export const scanInstalledPackages = () => new Map([[\`\${pkg.name}@\${pkg.version}\`, { pkg }]]);
export const missingProductionPackages = () => [];
`,
  );
  await mkdir(join(root, "third-party"));
  await writeFile(join(root, "third-party/inventory.json"), '{"reviewRequired":[]}\n');
  const avatar = JSON.parse(
    await readFile(
      new URL("../../third-party/upstream/multiavatar-1.0.7-package.json", import.meta.url),
      "utf8",
    ),
  );
  const exec = promisify(execFile);
  for (const [changed, allowed] of [
    [{}, true],
    [{ name: "unknown" }, false],
    [{ version: "1.0.8" }, false],
    [{ license: "SEE LICENSE IN LICENSE.md" }, false],
    [{ license: " SEE LICENSE IN LICENSE " }, false],
    [{ license: { type: "SEE LICENSE IN LICENSE" } }, false],
    [{ license: undefined, licenses: ["SEE LICENSE IN LICENSE"] }, false],
  ]) {
    await writeFile(join(scripts, "fixture.json"), JSON.stringify({ ...avatar, ...changed }));
    const run = () => exec(process.execPath, [join(scripts, "licenses.mjs"), "check"]);
    if (allowed) {
      const { stdout } = await run();
      assert.match(stdout, /许可标识与声明新鲜度检查通过/u);
    } else {
      await assert.rejects(run, (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /\[unresolved\]/u);
        return true;
      });
    }
  }
});
