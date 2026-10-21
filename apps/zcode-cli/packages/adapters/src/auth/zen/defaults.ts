import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { NewApiSessionBundle } from "@zcode/shared";
import { ZenClient } from "./client.js";
import { createZenAuthorization } from "./authorization.js";
import { createZenCredentialStore, createZenSystemKeyStore } from "./store.js";
import { openUrlInBrowser } from "../browser.js";

// XCODE: CLI 的平台与环境差异在 adapter 组装，bootstrap 不直接读取环境或密钥文件。
export async function createZenDefaultDependencies(
  env: Readonly<Record<string, string | undefined>>,
) {
  const origin = env.NEW_API_BASE_URL?.trim();
  if (!origin) throw new Error("Set NEW_API_BASE_URL to use XWork Zen Plan.");
  const root = env.ZCODE_DATA_BASE_DIR?.trim()
    ? resolve(env.ZCODE_DATA_BASE_DIR.trim())
    : homedir();
  const client = new ZenClient(origin);
  const directory = join(root, ".zcode", "cli", "zen");
  const store = createZenCredentialStore<NewApiSessionBundle>({
    directory,
    keyStore: await createZenSystemKeyStore(directory),
  });
  return {
    client,
    store,
    createAuthorization: () => createZenAuthorization(client.origin),
    openBrowser: openUrlInBrowser,
  };
}
