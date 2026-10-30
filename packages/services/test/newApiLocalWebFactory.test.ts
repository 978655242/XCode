import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

test("standalone Host invokes an explicitly injected private account factory", async () => {
  const home = await mkdtemp(join(tmpdir(), "aiscoo-web-injection-"));
  const source = `
    import { createServerHostServices, disposeServiceResourcesAndWait } from ${JSON.stringify(resolve("packages/services/src/node.ts"))};
    let invoked = false;
    let host;
    try {
      host = await createServerHostServices({
        sourceServerId: "test-web-owner",
        zcodeBuiltinProviderConfigFilePath: ${JSON.stringify(resolve("config/provider/zcode-builtin.json"))},
        newApiAccountFactory: {
          credentialStore: {
            credentialsFile: ${JSON.stringify(join(home, "web-credentials.json"))},
            cipherProvider: { encrypt(value) { return value; }, decrypt(value) { return value; } },
          },
          providerConfigPaths: {
            personalFilePath: ${JSON.stringify(join(home, "web-provider.json"))},
            zcodeBuiltinActiveFilePath: ${JSON.stringify(join(home, "web-builtin.json"))},
          },
          create() { invoked = true; throw new Error("INJECTED_FACTORY_CALLED"); },
        },
      });
    } catch (error) {
      if (!invoked || error.message !== "INJECTED_FACTORY_CALLED") throw error;
    } finally {
      if (host) await disposeServiceResourcesAndWait(host.services);
    }
    if (!invoked) throw new Error("standalone Host ignored the private account factory");
    process.stdout.write("FACTORY_INVOKED\\n");
    process.exit(0);
  `;
  try {
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          ZCODE_DATA_BASE_DIR: home,
          NEW_API_BASE_URL: "http://127.0.0.1:3001",
        },
        timeout: 30_000,
      },
    );
    assert.match(result.stdout, /FACTORY_INVOKED/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("invalid Web credential ports fail closed without touching desktop storage", async () => {
  const home = await mkdtemp(join(tmpdir(), "aiscoo-web-invalid-store-"));
  const source = `
    import assert from "node:assert/strict";
    import { mkdir, readFile, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import { createLocalServices } from ${JSON.stringify(resolve("packages/services/src/node.ts"))};
    const desktopDir = join(process.env.HOME, ".zcode", "v2");
    const desktopFile = join(desktopDir, "credentials.json");
    const original = JSON.stringify({ "oauth:bigmodel:access_token": "synthetic-desktop-token" });
    await mkdir(desktopDir, { recursive: true });
    await writeFile(desktopFile, original);
    const cipher = { encrypt(value) { return value; }, decrypt(value) { return value; } };
    const cases = [
      undefined,
      {},
      { credentialsFile: join(process.env.HOME, "web.json") },
      { cipherProvider: cipher },
      { credentialsFile: "", cipherProvider: cipher },
      { credentialsFile: join(process.env.HOME, "web.json"), cipherProvider: {} },
    ];
    for (const credentialStore of cases) {
      let invoked = false;
      assert.throws(() => createLocalServices({
        serviceAuthorityMode: "standalone-server",
        zcodeBuiltinProviderConfigFilePath: ${JSON.stringify(resolve("config/provider/zcode-builtin.json"))},
        newApiAccountFactory: { credentialStore, create() { invoked = true; } },
      }), /XCODE_LOCAL_WEB_CREDENTIAL_STORE_INVALID/);
      assert.equal(invoked, false);
      assert.equal(await readFile(desktopFile, "utf8"), original);
    }
    process.stdout.write("INVALID_STORE_DENIED\\n");
    process.exit(0);
  `;
  try {
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOME: home,
          USERPROFILE: home,
          ZCODE_DATA_BASE_DIR: home,
          ZCODE_CREDENTIAL_SECRET: "synthetic-desktop-test-key",
          ZCODE_ENV: "test",
          NODE_ENV: "test",
        },
        timeout: 30_000,
      },
    );
    assert.match(result.stdout, /INVALID_STORE_DENIED/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
