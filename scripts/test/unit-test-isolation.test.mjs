import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const repository = fileURLToPath(new URL("../..", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("unit storage and backup initialization cannot mutate the caller's home", async (t) => {
  const cache = join(repository, "packages/desktop/.e2e-cache");
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(join(cache, "unit-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const callerHome = join(root, "caller-home");
  const callerData = join(callerHome, ".zcode");
  const callerDatabase = join(callerData, "v2/tasks-index.sqlite");
  const callerBackups = join(callerData, "backup");
  await mkdir(join(callerData, "v2"), { recursive: true });
  await mkdir(callerBackups);
  await writeFile(join(callerBackups, "preserve"), "caller-owned backup\n");
  const database = new DatabaseSync(callerDatabase);
  database.exec(
    "CREATE TABLE protected_data (value TEXT); INSERT INTO protected_data VALUES ('caller-owned');",
  );
  database.close();
  const before = hash(await readFile(callerDatabase));
  const proof = join(root, "proof.json");
  const fixture = join(root, "default-storage.test.ts");
  const uri = (path) => JSON.stringify(pathToFileURL(resolve(repository, path)).href);
  await writeFile(
    fixture,
    `
import { test, expect } from ${JSON.stringify(import.meta.resolve("vitest"))};
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { TaskIndexRepo } from ${uri("packages/services/src/session/taskIndexRepo.ts")};
import { getTasksIndexDatabasePath } from ${uri("packages/services/src/paths.ts")};
test("initialize real default and explicit databases", async () => {
  const ordinary = new TaskIndexRepo();
  const explicit = new TaskIndexRepo(undefined, undefined, ${JSON.stringify(join(root, "explicit.sqlite"))});
  try {
    await ordinary.ensureReady();
    await explicit.ensureReady();
    const ready = existsSync(getTasksIndexDatabasePath());
    expect(ready).toBe(true);
    await writeFile(${JSON.stringify(proof)}, JSON.stringify({ home: process.env.HOME, ready }));
  } finally {
    explicit.close();
    ordinary.close();
  }
});
`,
  );
  const configuration = join(root, "isolation.config.mjs");
  await writeFile(
    configuration,
    `
import base from ${uri("vitest.config.ts")};
export default {
  ...base,
  root: ${JSON.stringify(repository)},
  test: { ...base.test, projects: undefined, include: [${JSON.stringify(fixture)}], maxWorkers: 1, pool: "forks" }
};
`,
  );
  const vitest = resolve(
    dirname(require.resolve("vitest/package.json")),
    require("vitest/package.json").bin.vitest,
  );
  const result = await exec(process.execPath, [vitest, "run", "--config", configuration], {
    cwd: repository,
    env: {
      ...process.env,
      HOME: callerHome,
      USERPROFILE: callerHome,
      ZCODE_DATA_BASE_DIR: callerHome,
    },
    maxBuffer: 2_000_000,
  });
  const observed = JSON.parse(await readFile(proof, "utf8"));
  assert.equal(observed.ready, true, result.stdout + result.stderr);
  assert.equal(
    hash(await readFile(callerDatabase)),
    before,
    "unit tests migrated the caller's database",
  );
  assert.deepEqual(
    await readdir(callerBackups),
    ["preserve"],
    "unit tests wrote into the caller's migration backups",
  );
  assert.equal(await readFile(join(callerBackups, "preserve"), "utf8"), "caller-owned backup\n");
  await assert.rejects(readFile(join(observed.home, ".zcode/v2/tasks-index.sqlite")), {
    code: "ENOENT",
  });
});
