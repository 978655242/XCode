import assert from "node:assert/strict";
import { app, safeStorage } from "electron";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  desktopDevelopmentKeychainName,
  desktopProductIdentities,
} from "../scripts/desktop-product-identity.mjs";

const [mode, flavor, temporary] = process.argv.slice(2);
const identities = {
  development: { legacy: desktopDevelopmentKeychainName, display: "Aiscoo Dev" },
  production: {
    legacy: desktopProductIdentities.production.macKeychainName,
    display: desktopProductIdentities.production.productName,
  },
  preview: {
    legacy: desktopProductIdentities.preview.macKeychainName,
    display: desktopProductIdentities.preview.productName,
  },
};
const identity = identities[flavor];
assert.ok(identity && temporary, "Launch through runAiscooKeychainSmoke.mjs");
assert.ok(["seed", "renamed", "compatible"].includes(mode), "Unsupported smoke mode");
const fixture = join(temporary, `${flavor}.encrypted`);
const marker = `aiscoo-keychain-regression:${flavor}`;
// 名称必须在首轮事件循环前设置，否则 Electron 已用默认名称固定钥匙串。
const source = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
const early = source.match(/^app\.setName\([\s\S]*?\);/mu)?.[0];
const ready = source.match(
  /app\.whenReady\(\)\.then\(async \(\) => \{\s*(?:\/\/[^\n]*\n\s*)*(app\.setName\([^\n]+\);)/u,
)?.[1];
assert.ok(early && ready, "Desktop startup identity assembly was not found");
const context = {
  app,
  process: { platform: "darwin" },
  runtimeKeychainApplicationName: identity.legacy,
  runtimeApplicationName: identity.display,
};
if (mode === "compatible") runInNewContext(early, context);
else app.setName(mode === "seed" ? identity.legacy : identity.display);
app.setPath("userData", join(temporary, `${flavor}-${mode}-profile`));
app.commandLine.appendSwitch("no-startup-window");

app.whenReady().then(async () => {
  try {
    if (mode === "compatible") runInNewContext(ready, context);
    assert.ok(safeStorage.isEncryptionAvailable(), "macOS secure storage is unavailable");
    if (mode === "seed") {
      await writeFile(fixture, safeStorage.encryptString(marker), { mode: 0o600 });
    } else {
      const encrypted = await readFile(fixture);
      if (mode === "renamed") assert.throws(() => safeStorage.decryptString(encrypted));
      else {
        assert.equal(app.getName(), identity.display);
        assert.equal(safeStorage.decryptString(encrypted), marker);
      }
      assert.deepEqual(await readFile(fixture), encrypted, "Existing ciphertext was changed");
    }
    console.log(`Aiscoo keychain smoke PASS: ${flavor}/${mode}`);
    app.quit();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Keychain smoke failed");
    app.exit(1);
  }
});
