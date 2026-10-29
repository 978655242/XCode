// XWork 策略扩展：architecture-policy.aiscoo.yaml 的模块追加到上游策略后统一校验。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { adoptModule } from "../architecture/adopt.mjs";
import { loadPolicy } from "../architecture/index.mjs";

const UPSTREAM = `version: 1
modules:
  - id: upstream
    roots: [src/upstream]
global:
  maxFileLines: 20
`;

async function withPolicy(extension, fn) {
  const cwd = await mkdtemp(join(tmpdir(), "aiscoo-policy-"));
  try {
    await writeFile(join(cwd, "architecture-policy.yaml"), UPSTREAM);
    if (extension !== undefined)
      await writeFile(join(cwd, "architecture-policy.aiscoo.yaml"), extension);
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("without an extension file the upstream policy loads unchanged", async () => {
  await withPolicy(undefined, async (cwd) => {
    const policy = await loadPolicy(cwd);
    assert.deepEqual(
      policy.modules.map((module) => module.id),
      ["upstream"],
    );
    assert.equal(policy.global.maxFileLines, 20);
  });
});

test("extension modules are appended and may depend on upstream modules", async () => {
  const extension = `modules:
  - id: downstream
    roots: [src/downstream]
    managed: true
    requires: [upstream]
`;
  await withPolicy(extension, async (cwd) => {
    const policy = await loadPolicy(cwd);
    assert.deepEqual(
      policy.modules.map((module) => module.id),
      ["upstream", "downstream"],
    );
    assert.deepEqual(policy.modules[1].requires, ["upstream"]);
    assert.equal(policy.global.maxFileLines, 20);
  });
});

test("extension modules go through the same validation as upstream modules", async () => {
  await withPolicy("modules:\n  - id: upstream\n    roots: [src/other]\n", (cwd) =>
    assert.rejects(loadPolicy(cwd), /模块 id 重复/),
  );
  await withPolicy(
    "modules:\n  - id: downstream\n    roots: [src/d]\n    requires: [missing]\n",
    (cwd) => assert.rejects(loadPolicy(cwd), /依赖未知模块 missing/),
  );
  await withPolicy("version: 1\n", (cwd) =>
    assert.rejects(loadPolicy(cwd), /必须包含 modules 数组/),
  );
});

test("adopt registers and re-adopts XWork modules in the extension file only", async () => {
  await withPolicy("modules:\n  - id: downstream\n    roots: [src/downstream]\n", async (cwd) => {
    await mkdir(join(cwd, "src/downstream"), { recursive: true });
    await mkdir(join(cwd, "src/fresh"), { recursive: true });
    // 已登记在扩展文件中的模块：更新扩展条目，不在上游 YAML 重复登记。
    await adoptModule({ cwd, id: "downstream", roots: ["src/downstream"] });
    // 新模块：登记到扩展文件。
    await adoptModule({ cwd, id: "fresh", roots: ["src/fresh"] });
    // 上游已有模块：仍写上游 YAML。
    await mkdir(join(cwd, "src/upstream"), { recursive: true });
    await adoptModule({ cwd, id: "upstream", roots: ["src/upstream"] });

    const upstreamYaml = await readFile(join(cwd, "architecture-policy.yaml"), "utf8");
    assert.doesNotMatch(upstreamYaml, /downstream|fresh/);
    const policy = await loadPolicy(cwd);
    assert.deepEqual(
      policy.modules.map((module) => [module.id, module.managed]),
      [
        ["upstream", true],
        ["downstream", true],
        ["fresh", true],
      ],
    );
  });
});
