// 只删除本次 harness 数据根下各设备的钥匙串条目（按目录派生的账户名），不触碰用户已有条目。
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

function accountFor(directory) {
  // 与 adapters zenKeychainAccount 保持一致；单测覆盖该派生规则。
  return `credential-encryption-key:${createHash("sha256").update(resolve(directory)).digest("hex").slice(0, 32)}`;
}

export async function cleanupKeychainEntries(root) {
  const { AsyncEntry } = require("@napi-rs/keyring");
  let devices = [];
  try {
    devices = await readdir(join(root, "devices"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const name of devices) {
    const entry = new AsyncEntry("XWork CLI Zen", accountFor(join(root, "devices", name, ".zcode", "cli", "zen")), { linux: { store: "secret-service" } });
    await entry.deleteCredential().catch(() => undefined);
  }
}
