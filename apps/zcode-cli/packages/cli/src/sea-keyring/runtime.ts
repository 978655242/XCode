import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";

declare const __CLI_VERSION__: string;

type KeyringModule = typeof import("@napi-rs/keyring");

export interface SeaKeyringModule {
  getAsset(key: string, encoding: "utf8"): string;
  getRawAsset(key: string): ArrayBuffer;
  isSea(): boolean;
}

interface SeaKeyringFile {
  mode: number;
  path: string;
  sha256: string;
}

interface SeaKeyringManifest {
  files: SeaKeyringFile[];
  hash: string;
  packageVersion: string;
  target: string;
  version: 1;
}

const ASSET_PREFIX = "zcode-keyring-runtime/";
const MANIFEST_ASSET_KEY = `${ASSET_PREFIX}manifest.json`;
const MARKER_FILE = "keyring-manifest.json";
const PACKAGE_NAME = "@napi-rs/keyring";
const PACKAGE_JSON_PATH = `node_modules/${PACKAGE_NAME}/package.json`;

export interface LoadCliKeyringOptions {
  sea?: SeaKeyringModule;
  cacheBase?: string;
  importModule?: () => Promise<KeyringModule>;
}

/**
 * XCODE: SEA 单文件包无法从仓库 node_modules 解析 @napi-rs/keyring 及其平台原生绑定；
 * 与 Playwright 相同，从内嵌资源解包到按内容哈希命名的缓存目录后 require。
 */
export async function loadCliKeyringModule(
  options: LoadCliKeyringOptions = {},
): Promise<KeyringModule> {
  const sea = options.sea ?? (await import("node:sea"));
  if (!sea.isSea()) {
    return options.importModule ? options.importModule() : import("@napi-rs/keyring");
  }
  const runtimeDirectory = await ensureSeaKeyringRuntime(
    sea,
    options.cacheBase ?? cacheBaseDirectory(),
  );
  const require = createRequire(join(runtimeDirectory, "zcode-keyring-loader.cjs"));
  return require(PACKAGE_NAME) as KeyringModule;
}

async function ensureSeaKeyringRuntime(sea: SeaKeyringModule, cacheBase: string): Promise<string> {
  const manifest = readManifest(sea);
  const cacheDirectory = join(
    cacheBase,
    __CLI_VERSION__,
    manifest.target,
    `keyring-${manifest.packageVersion}-${manifest.hash}`,
  );
  if (await isCacheCurrent(join(cacheDirectory, MARKER_FILE), manifest)) return cacheDirectory;

  const temporaryDirectory = `${cacheDirectory}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporaryDirectory, { force: true, recursive: true });
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    for (const file of manifest.files) {
      assertSafeRuntimePath(file.path);
      const bytes = Buffer.from(sea.getRawAsset(`${ASSET_PREFIX}${file.path}`));
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
        throw new Error(`SEA keychain asset hash mismatch for ${file.path}`);
      }
      const outputPath = join(temporaryDirectory, file.path);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, bytes);
      await chmod(outputPath, file.mode);
    }
    if (!existsSync(join(temporaryDirectory, PACKAGE_JSON_PATH))) {
      throw new Error("SEA keychain runtime is missing @napi-rs/keyring/package.json");
    }
    await writeFile(join(temporaryDirectory, MARKER_FILE), JSON.stringify(manifest, null, 2));
    await mkdir(dirname(cacheDirectory), { recursive: true });
    await rm(cacheDirectory, { force: true, recursive: true });
    await rename(temporaryDirectory, cacheDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }
  return cacheDirectory;
}

function readManifest(sea: SeaKeyringModule): SeaKeyringManifest {
  const parsed = JSON.parse(sea.getAsset(MANIFEST_ASSET_KEY, "utf8")) as SeaKeyringManifest;
  if (
    parsed.version !== 1 ||
    !parsed.hash ||
    !parsed.packageVersion ||
    !parsed.target ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error("Invalid SEA keychain runtime manifest");
  }
  return parsed;
}

async function isCacheCurrent(markerPath: string, expected: SeaKeyringManifest): Promise<boolean> {
  if (!existsSync(markerPath)) return false;
  try {
    const current = JSON.parse(await readFile(markerPath, "utf8")) as SeaKeyringManifest;
    return current.hash === expected.hash && current.target === expected.target;
  } catch {
    return false;
  }
}

function assertSafeRuntimePath(filePath: string): void {
  const normalized = normalize(filePath);
  if (
    normalized.startsWith(`..${sep}`) ||
    normalized === ".." ||
    !normalized.startsWith(`node_modules${sep}@napi-rs${sep}`)
  ) {
    throw new Error(`Invalid SEA keychain asset path: ${filePath}`);
  }
}

function cacheBaseDirectory(): string {
  const home = homedir();
  if (platform() === "darwin" && home) {
    return join(home, "Library", "Caches", "zcode", "sea-assets");
  }
  if (platform() === "win32") {
    return join(
      process.env.LOCALAPPDATA ?? join(home || tmpdir(), "AppData", "Local"),
      "zcode",
      "Cache",
      "sea-assets",
    );
  }
  return join(
    process.env.XDG_CACHE_HOME ?? join(home || tmpdir(), ".cache"),
    "zcode",
    "sea-assets",
  );
}
