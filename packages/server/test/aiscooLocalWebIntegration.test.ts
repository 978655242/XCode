import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("runs the local Web account through a real Host and WebSocket RPC with isolated storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "aiscoo-local-web-integration-"));
  const home = join(root, "home");
  const storage = join(root, "storage");
  const logs = join(root, "logs");
  const cache = join(root, "cache");
  await Promise.all([home, storage, logs, cache].map((directory) => mkdir(directory)));
  try {
    // Only a small allowlist is inherited: user configuration, proxy and credentials stay out.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(root, "appdata"),
      LOCALAPPDATA: join(root, "localappdata"),
      XDG_CONFIG_HOME: join(root, "xdg-config"),
      XDG_DATA_HOME: join(root, "xdg-data"),
      XDG_CACHE_HOME: cache,
      TMPDIR: root,
      TMP: root,
      TEMP: root,
      ZCODE_DATA_BASE_DIR: home,
      ZCODE_STORAGE_DIR: storage,
      ZCODE_SESSION_DB_PATH: join(storage, "session.db"),
      ZCODE_SESSION_DB: join(storage, "session.db"),
      ZCODE_LOG_DIR: logs,
      ZCODE_CREDENTIAL_SECRET: "isolated-integration-test-only",
      ZCODE_ENV: "test",
      NODE_ENV: "test",
      AISCOO_INTEGRATION_ROOT: root,
    };
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", resolve("packages/server/test/fixtures/aiscooLocalWebIntegration.mjs")],
      { cwd: process.cwd(), env, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
    );
    expect(result.stdout).toContain("AISCOO_LOCAL_WEB_RPC_VERIFIED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 100_000);
