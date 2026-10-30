import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateContext, loadPolicy } from "../architecture/index.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const aliases = {
  "cli-xwork": "cli-aiscoo",
  "xwork-startup-context": "aiscoo-startup-context",
  "xwork-plugin-guides-protocol": "aiscoo-plugin-guides-protocol",
  "xwork-plugin-guides-cli": "aiscoo-plugin-guides-cli",
  "xwork-plugin-guides-service": "aiscoo-plugin-guides-service",
  "xwork-plugin-guides-ui": "aiscoo-plugin-guides-ui",
  "xwork-brand": "aiscoo-brand",
  "xwork-brand-ui": "aiscoo-brand-ui",
  "cli-brand": "cli-aiscoo-brand",
};

test("old and new architecture IDs resolve to the same owner and public boundaries", async () => {
  const policy = await loadPolicy(root);
  for (const [oldId, newId] of Object.entries(aliases)) {
    const canonicalId = policy.aliases[oldId] ?? oldId;
    assert.equal(policy.aliases[newId] ?? newId, canonicalId, newId);
    const module = policy.modules.find((item) => item.id === canonicalId);
    const expectedOwner =
      oldId === "cli-xwork"
        ? "cli"
        : oldId === "xwork-startup-context"
          ? "conversation"
          : oldId.startsWith("xwork-brand") || oldId === "cli-brand"
            ? "product"
            : "plugin";
    assert.equal(module?.owner, expectedOwner, oldId);
    const oldRoots = module.roots.filter((entry) => entry.includes("/xwork"));
    const newRoots = module.roots.filter((entry) => entry.includes("/aiscoo"));
    assert.ok(oldRoots.length > 0 && newRoots.length > 0, oldId);
    for (const rootPath of [...oldRoots, ...newRoots]) {
      assert.ok(
        module.publicEntrypoints.some(
          (entry) => path.resolve(root, entry) === path.join(rootPath, "index.ts"),
        ),
        rootPath,
      );
      assert.ok(
        module.publicEntrypoints.some(
          (entry) => path.resolve(root, entry) === path.join(rootPath, "contract.ts"),
        ),
        rootPath,
      );
    }
    const oldContext = await generateContext({ cwd: root, moduleId: oldId });
    const newContext = await generateContext({ cwd: root, moduleId: newId });
    assert.equal(oldContext, newContext, oldId);
    assert.match(oldContext, new RegExp(`owner: ${module.owner}`));
  }
});

test("CLI keeps its old posttest and adds a new equivalent command", async () => {
  const pkg = JSON.parse(
    await readFile(path.join(root, "apps/zcode-cli/packages/cli/package.json")),
  );
  assert.equal(pkg.scripts.posttest, "pnpm run test:xwork");
  assert.match(pkg.scripts["test:xwork"], /zen-login\.test\.ts/);
  assert.equal(pkg.scripts["test:aiscoo"], "pnpm run test:xwork");
});

test("historical brand assets, sync log and pre-push path remain intact", async () => {
  for (const relative of [
    "packages/shared/src/xwork-brand/brand.json",
    "packages/ui/src/xwork/brand/assets/mark-dark.svg",
    "scripts/xcode/start-local.py",
    "scripts/xcode/启动 XCode.command",
    "scripts/aiscoo/start-local.py",
    "scripts/aiscoo/启动 Aiscoo.command",
    "docs/xcode/upstream-sync-log.md",
  ])
    await readFile(path.join(root, relative));
  const current = await readFile(path.join(root, "docs/xcode/upstream-sync-log.md"), "utf8");
  const baseline = execFileSync("git", ["show", "origin/release:docs/xcode/upstream-sync-log.md"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(current, baseline);
  const historicalLinks = [...current.matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]*)?\)/g)];
  assert.ok(historicalLinks.length > 0);
  for (const [, relative] of historicalLinks) {
    await readFile(path.resolve(root, "docs/xcode", relative));
  }
  assert.match(
    await readFile(path.join(root, ".husky/pre-push"), "utf8"),
    /scripts\/xcode\/branch-policy\.mjs push/,
  );
});

test("legacy desktop symlink resolves the script path and preserves its exit code", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "aiscoo-launch-"));
  try {
    const oldDir = path.join(temp, "xcode");
    const newDir = path.join(temp, "aiscoo");
    await mkdir(oldDir);
    await mkdir(newDir);
    const oldLauncher = path.join(oldDir, "启动 XCode.command");
    const newLauncher = path.join(newDir, "启动 Aiscoo.command");
    await writeFile(
      oldLauncher,
      await readFile(path.join(root, "scripts/xcode/启动 XCode.command")),
      { mode: 0o755 },
    );
    await writeFile(
      newLauncher,
      await readFile(path.join(root, "scripts/aiscoo/启动 Aiscoo.command")),
      { mode: 0o755 },
    );
    await writeFile(path.join(oldDir, "start-local.py"), "import sys\nsys.exit(37)\n");
    await writeFile(
      path.join(newDir, "start-local.py"),
      await readFile(path.join(root, "scripts/aiscoo/start-local.py")),
    );
    for (const [name, launcher] of [
      ["old", oldLauncher],
      ["new", newLauncher],
    ]) {
      const link = path.join(temp, `${name}-desktop.command`);
      await symlink(launcher, link);
      const result = spawnSync("/bin/zsh", [link], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.equal(result.status, 37, result.stderr);
    }
    const python = spawnSync("/opt/homebrew/bin/python3", [path.join(newDir, "start-local.py")], {
      encoding: "utf8",
    });
    assert.equal(python.status, 37, python.stderr);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
