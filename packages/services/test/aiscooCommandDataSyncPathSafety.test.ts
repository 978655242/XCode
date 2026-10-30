import assert from "node:assert/strict";
import test from "node:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CommandDataSyncPayload, DataSyncImportItem } from "@zcode/shared";
import { createUserConfigSyncService } from "../src/data-sync/node.js";

const CONTENT = Buffer.from(
  "---\ndescription: Preserve all command bytes\nx-extra: kept\n---\nRun the command.\n",
);

async function withHome(run: (home: string, external: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "aiscoo-command-sync-path-"));
  const home = join(directory, "home");
  const external = join(directory, "external");
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    ZCODE_DATA_BASE_DIR: process.env.ZCODE_DATA_BASE_DIR,
  };
  await mkdir(home);
  await mkdir(external);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.ZCODE_DATA_BASE_DIR = home;
  try {
    await run(home, external);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

function payload(relativePath = "group/example.md", enabled = true): CommandDataSyncPayload {
  return {
    sourceHomeDir: "/source",
    items: [
      {
        key: `/${relativePath.slice(0, -3).toLowerCase()}`,
        name: `/${relativePath.slice(0, -3)}`,
        relativePath,
        content: CONTENT,
        enabled,
      },
    ],
  };
}

function importCommand(
  service: ReturnType<typeof createUserConfigSyncService>,
  input = payload(),
  item: Omit<DataSyncImportItem, "key"> = { mode: "createOnly" },
) {
  return service.importSyncItems({
    category: "commands",
    payload: input,
    items: [{ key: input.items[0]!.key, ...item }],
  });
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of (await readdir(directory)).sort()) {
      const path = join(directory, entry);
      const key = prefix ? `${prefix}/${entry}` : entry;
      const info = await lstat(path);
      if (info.isSymbolicLink()) result[key] = `link:${await readlink(path)}`;
      else if (info.isDirectory()) {
        result[key] = "directory";
        await visit(path, key);
      } else result[key] = `file:${(await readFile(path)).toString("hex")}`;
    }
  }
  await visit(root, "");
  return result;
}

for (const segments of [
  [".zcode"],
  [".zcode", "commands"],
  [".zcode", "commands", "group"],
  [".zcode", "commands", "group", "deep"],
]) {
  test(`command import rejects an existing ${segments.join("/")} directory link before writing outside its root`, async () => {
    await withHome(async (home, external) => {
      const link = join(home, ...segments);
      await mkdir(dirname(link), { recursive: true });
      await writeFile(join(external, "keep.txt"), "unchanged");
      await symlink(external, link, process.platform === "win32" ? "junction" : "dir");
      const before = await snapshotTree(external);
      const service = createUserConfigSyncService();
      const input = payload(segments.length === 4 ? "group/deep/example.md" : undefined);
      const first = await importCommand(service, input);
      const firstExternal = await snapshotTree(external);
      const second = await importCommand(service, input);
      assert.deepEqual(
        firstExternal,
        before,
        "the first import must not create external files or directories",
      );
      assert.deepEqual(
        await snapshotTree(external),
        before,
        "a repeated import must not recreate an invisible command",
      );
      for (const result of [first, second]) {
        assert.equal(result.results[0]?.status, "failed");
        assert.match(result.results[0]?.error ?? "", /symlink|symbolic link/i);
        assert.ok(result.results[0]?.error?.includes(link));
      }
      assert.ok((await lstat(link)).isSymbolicLink());
    });
  });
}

for (const dangling of [false, true]) {
  for (const mode of ["createOnly", "overwrite"] as const) {
    test(`command ${mode} refuses a ${dangling ? "dangling" : "live"} final file link without changing its target`, async () => {
      await withHome(async (home, external) => {
        const root = join(home, ".zcode", "commands");
        const link = join(root, "group", "example.md");
        const externalFile = join(external, "example.md");
        await mkdir(dirname(link), { recursive: true });
        if (!dangling) await writeFile(externalFile, "original external bytes");
        await symlink(externalFile, link, "file");
        const before = await snapshotTree(external);
        const configPath = join(home, ".zcode", "cli", "config.json");
        await mkdir(dirname(configPath), { recursive: true });
        const config = JSON.stringify({ command: { [link]: { enable: false } }, keep: "same" });
        await writeFile(configPath, config);
        const service = createUserConfigSyncService();
        const existing = (await service.listSyncItems({ category: "commands" })).items[0];
        const result = await importCommand(service, payload(), {
          mode,
          ...(existing?.contentHash ? { expectedTargetHash: existing.contentHash } : {}),
        });
        assert.deepEqual(await snapshotTree(external), before);
        assert.equal(await readlink(link), externalFile);
        assert.equal(await readFile(configPath, "utf8"), config);
        assert.equal(result.results[0]?.status, "failed");
        assert.match(result.results[0]?.error ?? "", /symlink|symbolic link/i);
      });
    });
  }
}

test("command import rejects a link back inside the command root while preserving the successful sibling", async () => {
  await withHome(async (home) => {
    const root = join(home, ".zcode", "commands");
    const target = join(root, "real");
    await mkdir(target, { recursive: true });
    await symlink(target, join(root, "group"), process.platform === "win32" ? "junction" : "dir");
    const input: CommandDataSyncPayload = {
      sourceHomeDir: "/source",
      items: [payload().items[0]!, payload("normal/new.md").items[0]!],
    };
    const service = createUserConfigSyncService();
    const result = await service.importSyncItems({
      category: "commands",
      payload: input,
      items: input.items.map(({ key }) => ({ key, mode: "createOnly" })),
    });
    assert.deepEqual(await readdir(target), []);
    assert.equal(result.results[0]?.status, "failed");
    assert.equal(result.results[1]?.status, "created");
    assert.deepEqual(await readFile(join(root, "normal", "new.md")), CONTENT);
  });
});

test("normal nested command creation, listing, export and disabled state keep their existing contract", async () => {
  await withHome(async (home) => {
    const service = createUserConfigSyncService();
    const input = payload("group/new.md", false);
    const imported = await importCommand(service, input);
    assert.deepEqual(imported.results, [{ key: "/group/new", status: "created" }]);
    const path = join(home, ".zcode", "commands", "group", "new.md");
    assert.deepEqual(await readFile(path), CONTENT);
    const listed = await service.listSyncItems({ category: "commands" });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]?.key, "/group/new");
    assert.equal(listed.items[0]?.enabled, false);
    const exported = await service.exportSyncItems({ category: "commands", keys: ["/group/new"] });
    assert.deepEqual(Buffer.from(exported.items[0]!.content), CONTENT);
    assert.equal(exported.items[0]?.relativePath, "group/new.md");
    assert.equal(exported.items[0]?.enabled, false);
    const repeated = await importCommand(service, input);
    assert.deepEqual(repeated.results, [{ key: "/group/new", status: "conflict" }]);
    assert.deepEqual(await readFile(path), CONTENT);
  });
});

test("normal command overwrite keeps hash conflicts, target bytes, mode and enabled state", async () => {
  await withHome(async (home) => {
    const path = join(home, ".zcode", "commands", "group", "example.md");
    const original = Buffer.from("Original target\n");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, original, { mode: 0o640 });
    const mode = (await stat(path)).mode & 0o777;
    const configPath = join(home, ".zcode", "cli", "config.json");
    await mkdir(dirname(configPath), { recursive: true });
    const config = JSON.stringify({ command: { [path]: { enable: false } }, keep: "same" });
    await writeFile(configPath, config);
    const service = createUserConfigSyncService();
    const listed = await service.listSyncItems({ category: "commands" });
    const hash = listed.items[0]!.contentHash!;
    for (const expectedTargetHash of [undefined, "stale-hash"]) {
      const result = await importCommand(service, payload(), {
        mode: "overwrite",
        expectedTargetHash,
      });
      assert.deepEqual(result.results, [{ key: "/group/example", status: "conflict" }]);
      assert.deepEqual(await readFile(path), original);
    }
    const updated = await importCommand(service, payload(), {
      mode: "overwrite",
      expectedTargetHash: hash,
    });
    assert.deepEqual(updated.results, [{ key: "/group/example", status: "updated" }]);
    assert.deepEqual(await readFile(path), CONTENT);
    assert.equal((await stat(path)).mode & 0o777, mode);
    assert.equal(await readFile(configPath, "utf8"), config);
    assert.equal((await service.listSyncItems({ category: "commands" })).items[0]?.enabled, false);
  });
});

test("a regular-file ancestor fails without being replaced or creating a command", async () => {
  await withHome(async (home) => {
    const root = join(home, ".zcode", "commands");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "group"), "keep ancestor");
    const result = await importCommand(createUserConfigSyncService());
    assert.equal(result.results[0]?.status, "failed");
    assert.ok(result.results[0]?.error);
    assert.equal(await readFile(join(root, "group"), "utf8"), "keep ancestor");
    assert.deepEqual(await readdir(root), ["group"]);
  });
});
