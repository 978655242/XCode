import type { NewApiOwner } from "@zcode/shared";
import type { NewApiAccountService, NewApiClient } from "../node.js";
import type { HostCredentialStoreDependencies } from "../credential/credentialService.js";
import type { ProviderConfigRuntimeOptions } from "../model-provider/providerConfigRuntime.js";

export interface LocalWebSecureKeyStore {
  read(): Promise<string | null>;
  write(secret: string): Promise<void>;
}

export interface LocalWebNewApiAccountFactoryOptions {
  origin: string;
  /** 测试或隔离运行的配置根；默认使用当前 ZCode app 配置目录。 */
  dataDirectory?: string;
  /** Host-only 测试注入；生产环境默认操作系统安全库。 */
  keyStore?: LocalWebSecureKeyStore;
  now?: () => number;
}

export interface LocalWebHostConfiguration {
  readonly credentialStore: Readonly<Required<HostCredentialStoreDependencies>>;
  readonly personalFilePath: string;
  /** 只覆盖下游策略；未注入时调用方原始选项和求值时机不变。 */
  readonly providerRuntimeOptions: Readonly<
    Pick<
      ProviderConfigRuntimeOptions,
      | "personalFilePath"
      | "zcodeBuiltinActiveFilePath"
      | "zcodeBuiltinEnvironment"
      | "zcodeBuiltinRemote"
      | "readLegacyProviders"
    >
  >;
}

export interface LocalWebNewApiAccountFactory {
  /** Host 必须在装配公共凭据服务前使用同一独立文件和密钥。 */
  readonly credentialStore: Required<HostCredentialStoreDependencies>;
  /** Host 与 Worker 共用的 Web 私有 Provider 文件；不迁移桌面或 CLI 配置。 */
  readonly providerConfigPaths: {
    readonly personalFilePath: string;
    readonly zcodeBuiltinActiveFilePath: string;
  };
  /** 只能由一个 standalone Host 使用，创建唯一账号 owner。 */
  create(dependencies: {
    fetch: typeof globalThis.fetch;
    onOwnerChanged(owner: NewApiOwner | null): void | Promise<void>;
  }): {
    client: NewApiClient;
    account: NewApiAccountService;
    credentialStore: HostCredentialStoreDependencies;
  };
  /** 关闭回调 listener 并失效在途登录，不注销已保存账号；可重复调用。 */
  dispose(): Promise<void>;
}
