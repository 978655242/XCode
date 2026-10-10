// XCODE: 仅统一本产品展示文案，保留内部标识、协议与既有数据。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { atomicWritePrivateTextFile, backupCorruptFile, withFileLock } from "@zcode/shared/node";
import {
  credentialKeySchema,
  credentialRecordSchema,
  credentialValueSchema,
  formatZodError,
  CREDENTIAL_DECRYPT_ERROR_CODE,
} from "@zcode/shared";
import { createPrivateCredentialCipherProvider } from "./providers/privateCredentialCipherProvider.js";
import type { ICredentialService } from "./credential.js";
import {
  createCredentialCipherProvider,
  type CredentialCipherProvider,
} from "./providers/credentialCipherProvider.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getAppConfigDir } from "../paths.js";

/**
 * 凭据存储路径
 *
 * 当前持久化格式仍是 JSON，但 value 会在写入前加密，读取时自动解密。
 * 后续可切换到 Electron safeStorage（钥匙串）托管密钥，
 * 届时 host process 需要向 main 进程请求 encrypt/decrypt。
 */
const logger = createServiceLogger("credentialService");

function getCredentialsDir() {
  return getAppConfigDir();
}

function getCredentialsFile() {
  return join(getCredentialsDir(), "credentials.json");
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function readAll(credentialsFile = getCredentialsFile()): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(credentialsFile, "utf-8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {};
    }
    throw new Error(`Unable to read XWork credentials: ${credentialsFile}`, { cause: error });
  }

  try {
    const rawValue = JSON.parse(raw);
    const result = credentialRecordSchema.safeParse(rawValue);
    if (!result.success) {
      throw new Error(formatZodError(result.error));
    }
    return result.data;
  } catch {
    // 把损坏 JSON/schema 当成空 store 后继续 save 会清空其他 OAuth 与登录凭据。
    // 保留损坏文件证据并向上传递错误，禁止自动覆盖。
    const backupPath = await backupCorruptFile(credentialsFile).catch(() => undefined);
    // 服务层日志必须统一经过分级 logger，确保生产环境的损坏凭据告警
    // 进入相同的落盘/采集策略，同时不记录凭据内容。
    logger.warn(undefined, "read failed; refusing to overwrite corrupt credential store", {
      backupPath,
      credentialsFile,
    });
    throw Object.assign(new Error("XWork credentials require manual storage recovery"), {
      code: CREDENTIAL_DECRYPT_ERROR_CODE,
    });
  }
}

async function writeAll(credentialsFile: string, data: Record<string, string>): Promise<void> {
  // 凭据路径之前在模块加载时就绑定到 homedir()，
  // Windows 测试里即使切换 HOME 也会继续写真实用户目录，导致隔离失效。
  await atomicWritePrivateTextFile(credentialsFile, `${JSON.stringify(data, null, 2)}\n`);
}

interface CredentialServiceDependencies {
  cipherProvider?: CredentialCipherProvider;
  /** Host 私有的持久化成功通知；不进入 Renderer/RPC 凭据接口。 */
  onDidMutate?: (event: { operation: "save" | "delete"; key: string }) => void;
}
// XCODE: Renderer 的任意 key RPC 不能读取、覆盖或删除 Host 私有身份。
function assertPublicCredentialKey(key: string): void {
  if (key.startsWith("new-api:") || key.startsWith("official-cloud:")) {
    throw Object.assign(new Error("Private credentials are not available through RPC"), {
      code: "XCODE_CREDENTIAL_SCOPE_DENIED",
    });
  }
}

function assertHostCredentialKey(key: string): void {
  credentialKeySchema.parse(key);
  if (!key.startsWith("new-api:") && !key.startsWith("official-cloud:")) {
    throw new Error("Invalid private credential namespace");
  }
}

export interface HostCredentialStoreDependencies {
  credentialsFile?: string;
  cipherProvider?: CredentialCipherProvider;
}

// XCODE: 此 standalone Host port 不注册为 RPC，私有密文与旧官方密文使用不同 key。
export async function readHostCredentialRecords<T>(
  read: (load: (key: string) => string | null) => T,
  dependencies: HostCredentialStoreDependencies = {},
): Promise<T> {
  const records = await readAll(dependencies.credentialsFile ?? getCredentialsFile());
  let cipher = dependencies.cipherProvider;
  return read((key) => {
    assertHostCredentialKey(key);
    const encrypted = records[key];
    if (encrypted === undefined) return null;
    if (!encrypted.startsWith("enc:v1:")) {
      throw Object.assign(new Error("Private credentials require encrypted storage recovery"), {
        code: CREDENTIAL_DECRYPT_ERROR_CODE,
      });
    }
    cipher ??= createPrivateCredentialCipherProvider();
    return cipher.decrypt(encrypted);
  });
}

// XCODE: 同SID跨窗口的 refresh 必须覆盖HTTP与CAS，不能丢弃服务端最后轮换的secret。
export async function withHostCredentialRefreshLease<T>(
  key: string,
  run: () => Promise<T>,
  dependencies: HostCredentialStoreDependencies = {},
): Promise<T> {
  assertHostCredentialKey(key);
  const credentialsFile = dependencies.credentialsFile ?? getCredentialsFile();
  const ownerKey = createHash("sha256").update(key).digest("hex");
  return withFileLock(`${credentialsFile}.refresh-${ownerKey}`, run);
}

export async function updateHostCredentialRecords<T>(
  keys: readonly string[],
  mutate: (records: ReadonlyMap<string, string | null>) => {
    changes: ReadonlyMap<string, string | null>;
    result: T;
  },
  dependencies: HostCredentialStoreDependencies = {},
): Promise<T> {
  for (const key of keys) assertHostCredentialKey(key);
  const credentialsFile = dependencies.credentialsFile ?? getCredentialsFile();
  return withFileLock(credentialsFile, async () => {
    const records = await readAll(credentialsFile);
    const cipher = dependencies.cipherProvider ?? createPrivateCredentialCipherProvider();
    const selected = new Map<string, string | null>();
    for (const key of keys) {
      const encrypted = records[key];
      if (encrypted !== undefined && !encrypted.startsWith("enc:v1:")) {
        throw Object.assign(new Error("Private credentials require encrypted storage recovery"), {
          code: CREDENTIAL_DECRYPT_ERROR_CODE,
        });
      }
      selected.set(key, encrypted === undefined ? null : cipher.decrypt(encrypted));
    }
    const { changes, result } = mutate(selected);
    for (const [key, value] of changes) {
      if (!selected.has(key)) throw new Error("Undeclared private credential mutation");
      if (value === null) {
        delete records[key];
      } else {
        records[key] = cipher.encrypt(credentialValueSchema.parse(value));
      }
    }
    if (changes.size > 0) await writeAll(credentialsFile, records);
    return result;
  });
}

export function createCredentialService(
  dependencies: CredentialServiceDependencies = {},
): ICredentialService {
  const cipherProvider = dependencies.cipherProvider ?? createCredentialCipherProvider();

  return {
    async load(key: string): Promise<string | null> {
      const validatedKey = credentialKeySchema.parse(key);
      assertPublicCredentialKey(validatedKey);
      const creds = await readAll();
      const rawValue = creds[validatedKey];
      if (rawValue === undefined) {
        return null;
      }

      return cipherProvider.decrypt(rawValue);
    },

    async save(key: string, value: string): Promise<void> {
      const validatedKey = credentialKeySchema.parse(key);
      assertPublicCredentialKey(validatedKey);
      const validatedValue = credentialValueSchema.parse(value);
      const encryptedValue = cipherProvider.encrypt(validatedValue);
      const credentialsFile = getCredentialsFile();
      // desktop host 与 CLI adapter 是独立进程，进程内排队不能阻止 whole-file
      // read-modify-write 丢更新；共享目录锁必须覆盖读取、变更和原子替换全过程。
      await withFileLock(credentialsFile, async () => {
        const creds = await readAll(credentialsFile);
        creds[validatedKey] = encryptedValue;
        await writeAll(credentialsFile, creds);
      });
      dependencies.onDidMutate?.({ operation: "save", key: validatedKey });
    },

    async delete(key: string): Promise<void> {
      const validatedKey = credentialKeySchema.parse(key);
      assertPublicCredentialKey(validatedKey);
      const credentialsFile = getCredentialsFile();
      await withFileLock(credentialsFile, async () => {
        const creds = await readAll(credentialsFile);
        delete creds[validatedKey];
        await writeAll(credentialsFile, creds);
      });
      dependencies.onDidMutate?.({ operation: "delete", key: validatedKey });
    },
  };
}
