import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { targetParts } from "./sea-targets.mjs";

export const seaKeyringAssetPrefix = "zcode-keyring-runtime/";
export const seaKeyringManifestAssetKey = `${seaKeyringAssetPrefix}manifest.json`;

const keyringPackageName = "@napi-rs/keyring";

// SEA 内置的 Node 运行时在 Linux 上是 glibc 构建，因此选 gnu 绑定；Windows 为 MSVC。
export const keyringNativePackageForTarget = (target) => {
  const { arch, releasePlatform } = targetParts(target);
  if (releasePlatform === "darwin") return `${keyringPackageName}-darwin-${arch}`;
  if (releasePlatform === "linux") return `${keyringPackageName}-linux-${arch}-gnu`;
  if (releasePlatform === "win") return `${keyringPackageName}-win32-${arch}-msvc`;
  throw new Error(`Unsupported SEA keyring target ${target}`);
};

/**
 * XCODE: Zen 安全存储依赖 @napi-rs/keyring 的平台原生绑定；bundle 将其外置，SEA 运行时
 * 无法从仓库 node_modules 解析，所以与 Playwright 一样作为内容哈希资源随包分发并在首次使用时解包。
 */
export const collectSeaKeyringAssets = async ({ root, stagingDirectory, target }) => {
  const adaptersPackageJson = resolve(root, "packages", "adapters", "package.json");
  const require = createRequire(adaptersPackageJson);
  const loaderRoot = dirname(require.resolve(`${keyringPackageName}/package.json`));
  const nativeName = keyringNativePackageForTarget(target);
  const nativeRoot = dirname(
    createRequire(join(loaderRoot, "package.json")).resolve(`${nativeName}/package.json`),
  );
  const loaderPackage = JSON.parse(await readFile(join(loaderRoot, "package.json"), "utf8"));
  const nativePackage = JSON.parse(await readFile(join(nativeRoot, "package.json"), "utf8"));
  if (nativePackage.version !== loaderPackage.version) {
    throw new Error(
      `${nativeName}@${nativePackage.version} does not match ${keyringPackageName}@${loaderPackage.version}`,
    );
  }

  await rm(stagingDirectory, { force: true, recursive: true });
  const assets = {};
  const files = [];
  for (const [packageName, packageRoot] of [
    [keyringPackageName, loaderRoot],
    [nativeName, nativeRoot],
  ]) {
    for await (const sourcePath of walkFiles(packageRoot)) {
      const relativePath = toPosixPath(relative(packageRoot, sourcePath));
      if (relativePath.endsWith(".d.ts") || relativePath.endsWith(".md")) continue;
      const assetPath = `node_modules/${packageName}/${relativePath}`;
      const bytes = await readFile(sourcePath);
      assets[`${seaKeyringAssetPrefix}${assetPath}`] = sourcePath;
      files.push({
        mode: ((await stat(sourcePath)).mode & 0o111) !== 0 ? 0o755 : 0o644,
        path: assetPath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  if (!files.some((file) => file.path.endsWith(".node"))) {
    throw new Error(
      `Missing native keychain binding for ${target}. Run \`pnpm install\` before \`pnpm sea\`.`,
    );
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  const hash = createHash("sha256")
    .update(JSON.stringify(files.map(({ path, sha256 }) => [path, sha256])))
    .digest("hex");
  const manifest = { files, hash, packageVersion: loaderPackage.version, target, version: 1 };
  const manifestPath = resolve(stagingDirectory, "keyring-manifest.json");
  await mkdir(stagingDirectory, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  assets[seaKeyringManifestAssetKey] = manifestPath;
  return { assets, manifest };
};

async function* walkFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* walkFiles(fullPath);
    else if (entry.isFile()) yield fullPath;
  }
}

const toPosixPath = (value) => value.split(sep).join("/");
