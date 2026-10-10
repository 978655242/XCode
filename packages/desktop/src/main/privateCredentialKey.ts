import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeStorage } from "electron";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import { getZCodeDataRootDir } from "@zcode/services/node";
import { CREDENTIAL_DECRYPT_ERROR_CODE } from "@zcode/shared";

// XCODE: 只为新私有命名空间创建OS保护的随机key，保留旧官方加密数据的读取语义。
export async function loadPrivateCredentialSecret(): Promise<string> {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw Object.assign(new Error("An operating-system credential keystore is required"), {
      code: "XCODE_SECURE_STORAGE_UNAVAILABLE",
    });
  }
  const keyFile = join(getZCodeDataRootDir(), "private-credential-key.v1");
  return withFileLock(keyFile, async () => {
    let encrypted: string;
    try {
      encrypted = await readFile(keyFile, "utf-8");
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
      const secret = randomBytes(32).toString("base64url");
      await atomicWritePrivateTextFile(
        keyFile,
        safeStorage.encryptString(secret).toString("base64"),
      );
      return secret;
    }
    try {
      const bytes = Buffer.from(encrypted, "base64");
      if (bytes.toString("base64") !== encrypted) throw new Error("Invalid key encoding");
      const secret = safeStorage.decryptString(bytes);
      if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || Buffer.from(secret, "base64url").length !== 32) {
        throw new Error("Invalid private key");
      }
      return secret;
    } catch {
      throw Object.assign(new Error("The private credential keystore requires manual recovery"), {
        code: CREDENTIAL_DECRYPT_ERROR_CODE,
      });
    }
  });
}
