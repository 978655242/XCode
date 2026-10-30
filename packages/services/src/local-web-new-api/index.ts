import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createZenAuthorization, createZenSystemKeyStore } from "@zcode/adapters/auth";
import { normalizeNewApiOrigin, ZEN_CLI_CLIENT_ID, type ServiceAuthorityMode } from "@zcode/shared";
import { withFileLock } from "@zcode/shared/node";
import { getAppConfigDir } from "../paths.js";
import { createCredentialCipherProvider } from "../credential/providers/credentialCipherProvider.js";
import {
  NewApiAccountService,
  type NewApiHostAuthorization,
} from "../new-api/newApiAccountService.js";
import { NewApiClient } from "../new-api/newApiClient.js";
import { NewApiSessionRepo } from "../new-api/newApiSessionRepo.js";
import { NewApiProviderAdapter } from "../oauth/providers/newApiProviderAdapter.js";
import type {
  LocalWebHostConfiguration,
  LocalWebNewApiAccountFactory,
  LocalWebNewApiAccountFactoryOptions,
} from "./contract.js";

export type {
  LocalWebNewApiAccountFactory,
  LocalWebNewApiAccountFactoryOptions,
} from "./contract.js";

const LOCAL_WEB_REQUEST_TIMEOUT_MS = 15_000;

// XCODE: 本机 Web 网络可能长期无响应；仅以 AbortSignal 终止真实 fetch，保留迟到响应的 owner 补偿。
export function createLocalWebTimeoutFetch(
  fetchImpl: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(LOCAL_WEB_REQUEST_TIMEOUT_MS);
    const existingSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = existingSignal ? AbortSignal.any([existingSignal, deadline]) : deadline;
    return fetchImpl(input, { ...init, signal });
  };
}

function secureStorageError(): Error & { code: string } {
  return Object.assign(new Error("XCODE_SECURE_STORAGE_UNAVAILABLE"), {
    code: "XCODE_SECURE_STORAGE_UNAVAILABLE",
  });
}

/** 创建不可变的 Host 覆盖配置；缺失端口不能落入共享存储默认值。 */
export function createLocalWebHostConfiguration(
  credentials:
    | import("../credential/credentialService.js").HostCredentialStoreDependencies
    | undefined,
  paths: LocalWebNewApiAccountFactory["providerConfigPaths"] | undefined,
): LocalWebHostConfiguration {
  if (
    typeof credentials?.credentialsFile !== "string" ||
    !credentials.credentialsFile.trim() ||
    typeof credentials.cipherProvider?.encrypt !== "function" ||
    typeof credentials.cipherProvider?.decrypt !== "function"
  ) {
    throw Object.assign(new Error("XCODE_LOCAL_WEB_CREDENTIAL_STORE_INVALID"), {
      code: "XCODE_LOCAL_WEB_CREDENTIAL_STORE_INVALID",
    });
  }
  if (
    typeof paths?.personalFilePath !== "string" ||
    !paths.personalFilePath.trim() ||
    typeof paths.zcodeBuiltinActiveFilePath !== "string" ||
    !paths.zcodeBuiltinActiveFilePath.trim()
  )
    throw new Error("XCODE_LOCAL_WEB_PROVIDER_CONFIG_INVALID");
  const credentialStore = Object.freeze({
    credentialsFile: credentials.credentialsFile,
    cipherProvider: credentials.cipherProvider,
  });
  return Object.freeze({
    credentialStore,
    personalFilePath: paths.personalFilePath,
    providerRuntimeOptions: Object.freeze({
      personalFilePath: paths.personalFilePath,
      zcodeBuiltinActiveFilePath: paths.zcodeBuiltinActiveFilePath,
      zcodeBuiltinEnvironment: undefined,
      zcodeBuiltinRemote: undefined,
      readLegacyProviders: undefined,
    }),
  });
}

/** 仅在显式注入时准备隔离配置；缺失字段必须在公共服务装配前失败。 */
export function prepareLocalWebHostConfiguration(
  factory: LocalWebNewApiAccountFactory | undefined,
  serviceAuthorityMode?: ServiceAuthorityMode,
): LocalWebHostConfiguration | undefined {
  if (!factory) return undefined;
  if (serviceAuthorityMode !== "standalone-server")
    throw new Error("XCODE_LOCAL_WEB_AUTHORITY_INVALID");
  return createLocalWebHostConfiguration(factory.credentialStore, factory.providerConfigPaths);
}

/** 仅 Host 调用；创建隔离密钥后才允许装配私有账号。 */
export async function createLocalWebNewApiAccountFactory(
  options: LocalWebNewApiAccountFactoryOptions,
): Promise<LocalWebNewApiAccountFactory> {
  const origin = normalizeNewApiOrigin(options.origin);
  const directory = join(
    resolve(options.dataDirectory ?? getAppConfigDir()),
    "local-web",
    "new-api",
  );
  const credentialsFile = join(directory, "credentials.json");
  let secret: string;
  try {
    const keyStore = options.keyStore ?? (await createZenSystemKeyStore(directory));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    secret = await withFileLock(join(directory, "key"), async () => {
      let current = await keyStore.read();
      if (current === null) {
        if ((await readdir(directory)).some((name) => name.endsWith(".json")))
          throw secureStorageError();
        current = randomBytes(32).toString("base64url");
        await keyStore.write(current);
        if ((await keyStore.read()) !== current) throw secureStorageError();
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(current) || Buffer.from(current, "base64url").length !== 32)
        throw secureStorageError();
      return current;
    });
  } catch {
    throw secureStorageError();
  }
  // XCODE: Provider 文件可能含明文 Key；仅为 Web 目录设私有权限，不改变上游默认目录。
  const providerDirectory = join(directory, "provider");
  await mkdir(providerDirectory, { recursive: true, mode: 0o700 });
  const credentialStore = Object.freeze({
    credentialsFile,
    cipherProvider: Object.freeze(
      createCredentialCipherProvider({ env: { ZCODE_CREDENTIAL_SECRET: secret } }),
    ),
  });
  const providerConfigPaths = Object.freeze({
    personalFilePath: join(providerDirectory, "provider_config.json"),
    zcodeBuiltinActiveFilePath: join(providerDirectory, "zcode-builtin.json"),
  });
  createLocalWebHostConfiguration(credentialStore, providerConfigPaths);
  let account: NewApiAccountService | undefined;
  let disposed = false;
  return {
    // XCODE: 公共凭据先于账号创建，必须在装配时取得相同的 Web 专属路径和安全密钥。
    credentialStore,
    // XCODE: 独立 Provider 文件由 Host 和 Worker 共用，不能指向桌面配置。
    providerConfigPaths,
    create(dependencies) {
      if (disposed || account) throw new Error("XCODE_LOCAL_WEB_FACTORY_ALREADY_USED");
      const client = new NewApiClient(origin, {
        fetch: createLocalWebTimeoutFetch(dependencies.fetch),
        now: options.now,
        bodyAbortAsUnavailable: true,
      });
      const adapter = new NewApiProviderAdapter(client);
      // XCODE: refresh、logout 和补偿与 Web 授权签发保持同一客户端，桌面 adapter 不变。
      adapter.refresh = (session) =>
        client.refreshSession({
          sessionId: session.session_id,
          refreshToken: session.refresh_token,
          clientId: ZEN_CLI_CLIENT_ID,
        });
      adapter.logout = (session) =>
        client.logoutSession({
          sessionId: session.session_id,
          refreshToken: session.refresh_token,
          clientId: ZEN_CLI_CLIENT_ID,
        });
      const authorization: NewApiHostAuthorization = {
        async start() {
          const created = await createZenAuthorization(origin);
          const { listener } = created;
          const state = new URL(created.authorizeUrl).searchParams.get("state")!;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let rejectTimeout!: (error: Error) => void;
          const timeout = new Promise<never>((_, reject) => {
            rejectTimeout = reject;
          });
          timer = setTimeout(() => {
            rejectTimeout(
              Object.assign(new Error("XCODE_AUTH_EXPIRED"), { code: "XCODE_AUTH_EXPIRED" }),
            );
            void listener.close();
          }, 300_000);
          timer.unref();
          return {
            state,
            codeVerifier: created.verifier,
            authorizeUrl: created.authorizeUrl,
            wait: () => Promise.race([listener.wait(), timeout]),
            exchange: (code, codeVerifier) =>
              client.exchangeAuthorizationCode({
                code,
                codeVerifier,
                clientId: ZEN_CLI_CLIENT_ID,
                redirectUri: listener.redirectUri,
              }),
            async close() {
              clearTimeout(timer);
              await listener.close();
            },
          };
        },
      };
      account = new NewApiAccountService({
        adapter,
        repo: new NewApiSessionRepo(origin, credentialStore),
        authorization,
        now: options.now,
        onOwnerChanged: dependencies.onOwnerChanged,
      });
      return { client, account, credentialStore };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await account?.oauth.cancelPending();
      // 迟到的补偿、撤销和落盘随 Host 关闭一起结束，避免在数据根被清理后继续写入。
      await account?.idle();
    },
  };
}
