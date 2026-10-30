import { describe, expect, it } from "vitest";

import { localWebNewApiModule } from "./module.js";
import { createLocalWebHostConfiguration } from "./index.js";

// 契约测试只 import contract 与 module，不知道实现是谁；同一份测试应同时跑真实现与跨进程代理。
describe("local-web-new-api contract", () => {
  it("declares its module manifest", () => {
    expect(localWebNewApiModule.id).toBe("local-web-new-api");
  });

  it("validates and freezes Host overrides without replacing the credential owner", () => {
    const cipher = { encrypt: (value: string) => value, decrypt: (value: string) => value };
    const credentials = { credentialsFile: "/isolated/credentials.json", cipherProvider: cipher };
    const paths = {
      personalFilePath: "/isolated/provider_config.json",
      zcodeBuiltinActiveFilePath: "/isolated/builtin.json",
    };
    const config = createLocalWebHostConfiguration(credentials, paths);
    expect(config.credentialStore.cipherProvider).toBe(cipher);
    expect(config.personalFilePath).toBe(paths.personalFilePath);
    expect(config.providerRuntimeOptions).toEqual({
      personalFilePath: paths.personalFilePath,
      zcodeBuiltinActiveFilePath: paths.zcodeBuiltinActiveFilePath,
      zcodeBuiltinEnvironment: undefined,
      zcodeBuiltinRemote: undefined,
      readLegacyProviders: undefined,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.credentialStore)).toBe(true);
    expect(Object.isFrozen(config.providerRuntimeOptions)).toBe(true);
    credentials.credentialsFile = "/changed";
    paths.personalFilePath = "/changed";
    expect(config.credentialStore.credentialsFile).toBe("/isolated/credentials.json");
    expect(config.personalFilePath).toBe("/isolated/provider_config.json");
  });

  it("rejects incomplete credential and Provider ports before Host assembly", () => {
    const cipher = { encrypt: (value: string) => value, decrypt: (value: string) => value };
    const paths = {
      personalFilePath: "/isolated/personal",
      zcodeBuiltinActiveFilePath: "/isolated/builtin",
    };
    for (const credentials of [
      undefined,
      {},
      { credentialsFile: "/isolated/credentials" },
      { cipherProvider: cipher },
    ]) {
      expect(() => createLocalWebHostConfiguration(credentials, paths)).toThrow(
        "XCODE_LOCAL_WEB_CREDENTIAL_STORE_INVALID",
      );
    }
    for (const invalid of [
      undefined,
      { ...paths, personalFilePath: " " },
      { ...paths, zcodeBuiltinActiveFilePath: "" },
    ]) {
      expect(() =>
        createLocalWebHostConfiguration(
          { credentialsFile: "/isolated/credentials", cipherProvider: cipher },
          invalid,
        ),
      ).toThrow("XCODE_LOCAL_WEB_PROVIDER_CONFIG_INVALID");
    }
  });
});
