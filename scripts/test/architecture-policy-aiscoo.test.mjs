// XWork 策略扩展：architecture-policy.aiscoo.yaml 的模块追加到上游策略后统一校验。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { adoptModule } from "../architecture/adopt.mjs";
import {
  checkArchitecture,
  generateContext,
  loadPolicy,
  updateBaseline,
} from "../architecture/index.mjs";
import { manifestRequires } from "../architecture/policy.mjs";

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

const ALIAS_POLICY = `version: 1
modules:
  - id: consumer
    roots: [packages/consumer/src]
    managed: true
    requires: [legacy-brand]
  - id: stranger
    roots: [packages/stranger/src]
    managed: true
    requires: []
`;
const ALIAS_EXTENSION = `modules:
  - id: brand
    aliases: [legacy-brand]
    roots: [packages/brand/src]
    managed: true
    requires: []
    publicEntrypoints: [packages/brand/src/index.ts, packages/brand/src/contract.ts]
`;

async function withAliasFixture(fn) {
  const cwd = await mkdtemp(join(tmpdir(), "architecture-alias-"));
  try {
    const files = {
      "architecture-policy.yaml": ALIAS_POLICY,
      "architecture-policy.aiscoo.yaml": ALIAS_EXTENSION,
      "pnpm-workspace.yaml": "packages: [packages/*]\n",
      "packages/consumer/package.json": '{"name":"@fixture/consumer"}\n',
      "packages/stranger/package.json": '{"name":"@fixture/stranger"}\n',
      "packages/brand/package.json": '{"name":"@fixture/brand","exports":{".":"./src/index.ts"}}\n',
    };
    for (const id of ["consumer", "stranger", "brand"]) {
      files[`packages/${id}/src/module.ts`] =
        `export const m = { id: "${id}", requires: ${JSON.stringify(id === "consumer" ? ["legacy-brand"] : [])} };\n`;
      files[`packages/${id}/src/contract.ts`] = `export type ${id}Contract = string;\n`;
      files[`packages/${id}/src/contract.example.ts`] = "export {};\n";
      files[`packages/${id}/src/contract.test.ts`] = "export {};\n";
      files[`packages/${id}/src/CONTRACT.md`] = `# ${id}\n`;
    }
    files["packages/brand/src/index.ts"] = 'export { value } from "./internal.js";\n';
    files["packages/brand/src/internal.ts"] = "export const value = 1;\n";
    files["packages/consumer/src/index.ts"] = 'import { value } from "@fixture/brand";\n';
    for (const [relative, content] of Object.entries(files)) {
      await mkdir(join(cwd, relative, ".."), { recursive: true });
      await writeFile(join(cwd, relative), content);
    }
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const rules = (result, rule) => result.violations.filter((item) => item.rule === rule);

async function setConsumerRequires(cwd, policyRequires, manifestRequiresList = policyRequires) {
  await writeFile(
    join(cwd, "architecture-policy.yaml"),
    ALIAS_POLICY.replace("requires: [legacy-brand]", `requires: [${policyRequires.join(", ")}]`),
  );
  await writeFile(
    join(cwd, "packages/consumer/src/module.ts"),
    `export const m = { id: "consumer", requires: ${JSON.stringify(manifestRequiresList)} };\n`,
  );
}

test("legacy and current IDs resolve actual imports and context without duplicating a module", async () => {
  await withAliasFixture(async (cwd) => {
    const policy = await loadPolicy(cwd);
    assert.equal(policy.modules.filter((module) => module.id === "brand").length, 1);
    assert.deepEqual((await checkArchitecture({ cwd })).violations, []);
    for (const id of ["brand", "legacy-brand"]) {
      const context = await generateContext({ cwd, moduleId: id });
      assert.match(context, /# Architecture context: brand/);
      assert.match(context, /packages\/brand\/src\/contract.ts/);
    }
    let context = await generateContext({ cwd, moduleId: "consumer" });
    assert.match(context, /export type brandContract/);
    await setConsumerRequires(cwd, ["legacy-brand", "brand"]);
    assert.deepEqual((await checkArchitecture({ cwd })).violations, []);
    context = await generateContext({ cwd, moduleId: "consumer" });
    assert.equal((context.match(/export type brandContract/g) ?? []).length, 1);
    await setConsumerRequires(cwd, ["brand"]);
    assert.deepEqual((await checkArchitecture({ cwd })).violations, []);
  });
});

test("aliases cannot hide missing, unknown, or mismatched manifest dependencies", async () => {
  await withAliasFixture(async (cwd) => {
    await setConsumerRequires(cwd, ["legacy-brand", "brand"], ["brand"]);
    let result = await checkArchitecture({ cwd });
    assert.match(rules(result, "manifest-policy-mismatch")[0].message, /legacy-brand/);
    await setConsumerRequires(cwd, ["legacy-brand"], ["brand"]);
    result = await checkArchitecture({ cwd });
    assert.match(rules(result, "manifest-policy-mismatch")[0].message, /legacy-brand/);
    assert.match(rules(result, "manifest-policy-mismatch")[0].message, /brand/);
    await setConsumerRequires(cwd, ["legacy-brand"], ["legacy-brand", "unknown"]);
    result = await checkArchitecture({ cwd });
    assert.match(rules(result, "manifest-policy-mismatch")[0].message, /未知模块 unknown/);
    await setConsumerRequires(cwd, ["missing"]);
    await assert.rejects(loadPolicy(cwd), /依赖未知模块 missing/);
  });
});

test("aliases cannot authorize another module or private imports", async () => {
  await withAliasFixture(async (cwd) => {
    await writeFile(
      join(cwd, "packages/stranger/src/index.ts"),
      'import { value } from "@fixture/brand";\n',
    );
    await writeFile(
      join(cwd, "packages/consumer/src/private.ts"),
      'import { value } from "@fixture/brand/src/internal.js";\n',
    );
    const result = await checkArchitecture({ cwd });
    assert.equal(rules(result, "module-dependency").length, 1);
    assert.equal(rules(result, "module-dependency")[0].module, "stranger");
    assert.equal(rules(result, "deep-import").length, 1);
    assert.match(rules(result, "deep-import")[0].detail, /internal\.ts$/);
  });
});

test("invalid or ambiguous aliases fail policy loading", async () => {
  for (const aliases of [
    "aliases: not-a-list",
    "aliases: null",
    "aliases: [legacy-brand, legacy-brand]",
    "aliases: [brand]",
    "aliases: [consumer]",
    'aliases: [""]',
    'aliases: [" legacy-brand"]',
    "aliases: [42]",
  ]) {
    await withAliasFixture(async (cwd) => {
      await writeFile(
        join(cwd, "architecture-policy.aiscoo.yaml"),
        ALIAS_EXTENSION.replace("aliases: [legacy-brand]", aliases),
      );
      await assert.rejects(loadPolicy(cwd), /alias|别名/i, aliases);
    });
  }
  await withAliasFixture(async (cwd) => {
    await writeFile(
      join(cwd, "architecture-policy.aiscoo.yaml"),
      `${ALIAS_EXTENSION}  - id: another\n    roots: [packages/another/src]\n    aliases: [legacy-brand]\n`,
    );
    await assert.rejects(loadPolicy(cwd), /alias|别名/i);
  });
});

test("a changed policy cannot hide violations in unchanged modules", async () => {
  await withAliasFixture(async (cwd) => {
    await setConsumerRequires(cwd, ["brand"], []);
    await writeFile(
      join(cwd, "packages/stranger/src/index.ts"),
      'import { value } from "@fixture/brand";\n',
    );
    for (const changed of [
      "architecture-policy.yaml",
      "architecture-policy.aiscoo.yaml",
      join(cwd, "architecture-policy.aiscoo.yaml"),
    ]) {
      const result = await checkArchitecture({ cwd, changedFiles: [changed] });
      assert.equal(rules(result, "manifest-policy-mismatch").length, 1);
      assert.deepEqual(
        rules(result, "module-dependency")
          .map((item) => item.module)
          .sort(),
        ["consumer", "stranger"],
      );
    }
  });
});

test("policy changes retain an accurate baseline update scope", async () => {
  await withAliasFixture(async (cwd) => {
    await setConsumerRequires(cwd, ["brand"], []);
    let result = await checkArchitecture({ cwd });
    await updateBaseline({
      cwd,
      violations: [...result.violations, { fingerprint: "removed", file: "removed/module.ts" }],
    });
    await setConsumerRequires(cwd, ["brand"]);
    result = await checkArchitecture({ cwd, changedFiles: ["architecture-policy.aiscoo.yaml"] });
    const entries = await updateBaseline({
      cwd,
      violations: result.violations,
      scope: result.changedClosure,
    });
    assert.deepEqual(entries, []);
  });
});

test("adopt refuses an alias before creating artifacts or changing policy", async () => {
  await withAliasFixture(async (cwd) => {
    await mkdir(join(cwd, "packages/fresh/src"), { recursive: true });
    const policyPath = join(cwd, "architecture-policy.aiscoo.yaml");
    const before = await readFile(policyPath, "utf8");
    await assert.rejects(
      adoptModule({ cwd, id: "legacy-brand", roots: ["packages/fresh/src"] }),
      /别名/,
    );
    assert.equal(await readFile(policyPath, "utf8"), before);
    await assert.rejects(readFile(join(cwd, "packages/fresh/src/module.ts")), { code: "ENOENT" });
  });
});

test("repository shared manifests preserve historic IDs alongside their current IDs", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const policy = await loadPolicy(root);
  for (const [id, file, historic, current] of [
    [
      "plugin-sandbox",
      "packages/desktop/src/main/pluginSandbox/module.ts",
      ["xwork-brand"],
      ["aiscoo-brand"],
    ],
    [
      "mobile-ui",
      "packages/ui/src/components/mobile-ui/module.ts",
      ["xwork-brand-ui"],
      ["aiscoo-brand-ui"],
    ],
    [
      "web-remote-control",
      "packages/web/src/web-remote-control/module.ts",
      ["xwork-brand-ui", "xwork-brand"],
      ["aiscoo-brand-ui", "aiscoo-brand"],
    ],
  ]) {
    const module = policy.modules.find((item) => item.id === id);
    const manifest = manifestRequires(await readFile(join(root, file), "utf8"));
    for (const dependency of [...historic, ...current]) {
      assert.ok(module.requires.includes(dependency), `${id} policy is missing ${dependency}`);
      assert.ok(manifest.includes(dependency), `${id} manifest is missing ${dependency}`);
    }
  }
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
