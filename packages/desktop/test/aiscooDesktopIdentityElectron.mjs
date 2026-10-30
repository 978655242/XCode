// XCODE: 仅供隔离合成凭据验收；不加载产品 Main/Host，也不注册协议或创建窗口。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { app, BrowserWindow, safeStorage } from "electron";

async function run() {
  const root = await realpath(process.env.AISCOO_IDENTITY_SMOKE_ROOT || "");
  const allowedRoot = await realpath(resolve(import.meta.dirname, "../out/aiscoo-identity-smoke"));
  assert.equal(
    dirname(root),
    allowedRoot,
    "Fixture requires a fresh runner-owned output directory",
  );
  const config = JSON.parse(await readFile(join(root, "fixture.json"), "utf8"));
  const phase = process.env.AISCOO_IDENTITY_SMOKE_PHASE;
  assert.ok(phase === "encrypt" || phase === "decrypt");
  assert.match(config.name, /^Aiscoo Identity Synthetic [a-f0-9-]+$/u);
  assert.match(config.plaintext, /^aiscoo-synthetic:/u);
  assert.equal(process.versions.electron, "44.7.0");

  // 合成名称与每轮独立路径在 ready 前设置，不使用 XWork 或现有用户目录。
  app.setName(config.name);
  for (const name of ["appData", "userData", "sessionData", "logs", "crashDumps"]) {
    app.setPath(name, join(root, name));
  }
  app.disableHardwareAcceleration();
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
  await app.whenReady();
  assert.equal(safeStorage.isEncryptionAvailable(), true, "OS encryption unavailable");
  if (process.platform === "linux") {
    assert.notEqual(safeStorage.getSelectedStorageBackend(), "basic_text");
  }

  const cipherPath = join(root, "synthetic-cipher.bin");
  // 使用产品当前的同步 safeStorage 语义；文件 IO 保持异步，不读取外部密文。
  if (phase === "encrypt") {
    const cipher = safeStorage.encryptString(config.plaintext);
    assert.notEqual(cipher.toString("utf8"), config.plaintext);
    await writeFile(cipherPath, cipher, { flag: "wx", mode: 0o600 });
  }
  const decrypted = safeStorage.decryptString(await readFile(cipherPath));
  assert.equal(decrypted, config.plaintext);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  const result = {
    status: "pass",
    scope:
      "external synthetic fixture only; not packaged Main/Host or historical credential access",
    phase,
    pid: process.pid,
    electron: process.versions.electron,
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    executable: process.execPath,
    name: app.getName(),
    userData: app.getPath("userData"),
    sessionData: app.getPath("sessionData"),
    plaintextSha256: createHash("sha256").update(decrypted).digest("hex"),
    windowCount: BrowserWindow.getAllWindows().length,
  };
  await writeFile(join(root, `${phase}.json`), JSON.stringify(result, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
}

try {
  await run();
  app.exit(0);
} catch (error) {
  console.error(error);
  app.exit(1);
}
