import { mkdtemp, readFile, readlink, rm, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEV_ELECTRON_APP_BUNDLE_ID,
  DEV_ELECTRON_APP_NAME,
  DEV_ELECTRON_PROTOCOL_SCHEME,
  DEV_ELECTRON_BUNDLE_FORMAT,
  patchDevElectronInfoPlist,
  prepareDevElectronAppBundle,
} from "../scripts/devElectronAppBundle.mjs";

const tempRoots: string[] = [];
const signApp = vi.fn(async (_appPath: string) => {});

const rendererUrl = "http://127.0.0.1:5174";
const appSourcePath = fileURLToPath(new URL("../../..", import.meta.url));

afterEach(async () => {
  signApp.mockClear();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("dev Electron app bundle", () => {
  it("adds a product identity and isolated development URL scheme to the raw Electron plist", () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Electron</string>
\t<key>CFBundleIdentifier</key>
\t<string>com.github.Electron</string>
\t<key>CFBundleName</key>
\t<string>Electron</string>
\t<key>CFBundleIconFile</key>
\t<string>electron.icns</string>
</dict>
</plist>
`;

    const patched = patchDevElectronInfoPlist(source, rendererUrl);

    // XCODE: 开发 bundle 与正式、Preview、上游分别声明独立系统身份，不抢占 zcode。
    expect(DEV_ELECTRON_APP_NAME).toBe("Aiscoo Dev");
    expect(DEV_ELECTRON_APP_BUNDLE_ID).toBe("dev.aiscoo.app.dev");
    expect(DEV_ELECTRON_PROTOCOL_SCHEME).toBe("aiscoo-dev");

    expect(patched).toContain(`<string>${DEV_ELECTRON_APP_NAME}</string>`);
    expect(patched).toContain(`<string>${DEV_ELECTRON_APP_BUNDLE_ID}</string>`);
    expect(patched).toContain("<key>CFBundleURLTypes</key>");
    expect(patched).toContain(`<string>${DEV_ELECTRON_PROTOCOL_SCHEME}</string>`);
    expect((patched.match(/<key>CFBundleURLTypes<\/key>/gu) ?? []).length).toBe(1);
  });

  it("makes the macOS dev launcher use the prepared bundle executable", async () => {
    const devScript = await readFile(new URL("../scripts/dev.mjs", import.meta.url), "utf8");

    expect(devScript).toContain('process.platform === "darwin" && existsSync(electronBinary)');
    expect(devScript).toContain("prepareDevElectronAppBundle");
    expect(devScript).toContain("electronCommand = devBundle.executablePath");
  });

  // macOS bundle preparation creates a directory symlink; Windows CI may lack that privilege.
  it.skipIf(process.platform === "win32")(
    "copies the runtime and patches only the Dev bundle plist",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "zcode-dev-bundle-test-"));
      tempRoots.push(root);
      const sourceApp = join(root, "source", "Electron.app");
      const sourceContents = join(sourceApp, "Contents");
      await mkdir(join(sourceContents, "Resources"), { recursive: true });
      await writeFile(
        join(sourceContents, "Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.github.Electron</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>\n`,
        "utf8",
      );
      const outputRoot = join(root, "runtime");

      const result = await prepareDevElectronAppBundle({
        signApp,
        appSourcePath,
        rendererUrl,
        electronAppPath: sourceApp,
        runtimeRoot: outputRoot,
        electronVersion: "41.0.3",
        arch: "arm64",
      });

      expect(result.appPath).toBe(`${outputRoot}/41.0.3-arm64/${DEV_ELECTRON_APP_NAME}.app`);
      expect(result.executablePath).toBe(
        `${outputRoot}/41.0.3-arm64/${DEV_ELECTRON_APP_NAME}.app/Contents/MacOS/Electron`,
      );
      const plist = await readFile(join(result.appPath, "Contents", "Info.plist"), "utf8");
      // XCODE: 只检查合成 Dev 副本，不允许残留上游 scheme。
      expect(plist).toContain("dev.aiscoo.app.dev");
      expect(plist).toContain("<string>aiscoo-dev</string>");
      expect(plist).not.toContain("<string>zcode</string>");
      expect(plist).toContain("<key>CFBundleIconFile</key>");
      expect(plist).toContain("<string>xcode.icns</string>");
      expect(await readFile(join(result.appPath, "Contents", "Resources", "xcode.icns"))).toEqual(
        await readFile(new URL("../build/icon.icns", import.meta.url)),
      );
      expect(await readlink(join(result.appPath, "Contents", "Resources", "app"))).toBe(
        appSourcePath,
      );
    },
  );

  // Windows 普通用户无符号链接权限（需开发者模式），fs.symlink EPERM；覆盖由 CI Linux 承担。
  it.skipIf(process.platform === "win32")(
    "keeps framework symlinks relative so sandboxed helpers stay inside the bundle",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "zcode-dev-bundle-symlink-test-"));
      tempRoots.push(root);
      const sourceApp = join(root, "source", "Electron.app");
      const sourceContents = join(sourceApp, "Contents");
      const framework = join(sourceContents, "Frameworks", "Electron Framework.framework");
      const versionA = join(framework, "Versions", "A", "Resources");
      await mkdir(join(sourceContents, "MacOS"), { recursive: true });
      await mkdir(versionA, { recursive: true });
      await mkdir(join(sourceContents, "Resources"), { recursive: true });
      await writeFile(
        join(sourceContents, "Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.github.Electron</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>\n`,
        "utf8",
      );
      await writeFile(join(sourceContents, "MacOS", "Electron"), "source-v1", "utf8");
      await writeFile(join(versionA, "icudtl.dat"), "icu", "utf8");
      await symlink("A", join(framework, "Versions", "Current"));
      await symlink("Versions/Current/Resources", join(framework, "Resources"));

      const result = await prepareDevElectronAppBundle({
        signApp,
        appSourcePath,
        rendererUrl,
        electronAppPath: sourceApp,
        runtimeRoot: join(root, "runtime"),
        electronVersion: "41.0.3",
        arch: "arm64",
      });

      const copiedFramework = join(
        result.appPath,
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
      );
      expect(await readlink(join(copiedFramework, "Versions", "Current"))).toBe("A");
      expect(await readlink(join(copiedFramework, "Resources"))).toBe("Versions/Current/Resources");
      expect(await readFile(join(copiedFramework, "Resources", "icudtl.dat"), "utf8")).toBe("icu");
    },
  );

  it.skipIf(process.platform === "win32")(
    "rebuilds a cached bundle whose stamp predates the current layout format",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "zcode-dev-bundle-format-test-"));
      tempRoots.push(root);
      const sourceApp = join(root, "source", "Electron.app");
      const sourceContents = join(sourceApp, "Contents");
      const sourceMacOS = join(sourceContents, "MacOS");
      await mkdir(sourceMacOS, { recursive: true });
      await mkdir(join(sourceContents, "Resources"), { recursive: true });
      await writeFile(
        join(sourceContents, "Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.github.Electron</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>\n`,
        "utf8",
      );
      await writeFile(join(sourceMacOS, "Electron"), "source-v1", "utf8");
      const outputRoot = join(root, "runtime");

      const first = await prepareDevElectronAppBundle({
        signApp,
        appSourcePath,
        rendererUrl,
        electronAppPath: sourceApp,
        runtimeRoot: outputRoot,
        electronVersion: "41.0.3",
        arch: "arm64",
      });
      const stampPath = join(outputRoot, "41.0.3-arm64", ".zcode-dev-electron-source.json");
      const stamp = JSON.parse(await readFile(stampPath, "utf8"));
      expect(stamp.format).toBe(DEV_ELECTRON_BUNDLE_FORMAT);
      // 模拟旧版脚本留下的缓存：没有 format 字段，源二进制指纹却仍然匹配。
      await writeFile(
        stampPath,
        JSON.stringify({ size: stamp.size, mtimeMs: stamp.mtimeMs }),
        "utf8",
      );
      await writeFile(join(first.appPath, "Contents", "MacOS", "Electron"), "stale-copy", "utf8");

      await prepareDevElectronAppBundle({
        signApp,
        appSourcePath,
        rendererUrl,
        electronAppPath: sourceApp,
        runtimeRoot: outputRoot,
        electronVersion: "41.0.3",
        arch: "arm64",
      });

      expect(await readFile(join(first.appPath, "Contents", "MacOS", "Electron"), "utf8")).toBe(
        "source-v1",
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "rebuilds the ignored bundle when the source Electron launcher changes",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "zcode-dev-bundle-refresh-test-"));
      tempRoots.push(root);
      const sourceApp = join(root, "source", "Electron.app");
      const sourceContents = join(sourceApp, "Contents");
      const sourceMacOS = join(sourceContents, "MacOS");
      await mkdir(sourceMacOS, { recursive: true });
      await mkdir(join(sourceContents, "Resources"), { recursive: true });
      await writeFile(
        join(sourceContents, "Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.github.Electron</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>\n`,
        "utf8",
      );
      await writeFile(join(sourceMacOS, "Electron"), "source-v1", "utf8");
      const outputRoot = join(root, "runtime");

      const first = await prepareDevElectronAppBundle({
        signApp,
        appSourcePath,
        rendererUrl,
        electronAppPath: sourceApp,
        runtimeRoot: outputRoot,
        electronVersion: "41.0.3",
        arch: "arm64",
      });
      await writeFile(join(sourceMacOS, "Electron"), "source-v2", "utf8");

      await prepareDevElectronAppBundle({
        signApp,
        appSourcePath,
        rendererUrl,
        electronAppPath: sourceApp,
        runtimeRoot: outputRoot,
        electronVersion: "41.0.3",
        arch: "arm64",
      });

      expect(await readFile(join(first.appPath, "Contents", "MacOS", "Electron"), "utf8")).toBe(
        "source-v2",
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "reuses the ignored bundle when the source Electron launcher is unchanged",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "zcode-dev-bundle-reuse-test-"));
      tempRoots.push(root);
      const sourceApp = join(root, "source", "Electron.app");
      const sourceContents = join(sourceApp, "Contents");
      const sourceMacOS = join(sourceContents, "MacOS");
      await mkdir(sourceMacOS, { recursive: true });
      await mkdir(join(sourceContents, "Resources"), { recursive: true });
      await writeFile(
        join(sourceContents, "Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.github.Electron</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>\n`,
        "utf8",
      );
      await writeFile(join(sourceMacOS, "Electron"), "source-v1", "utf8");
      const outputRoot = join(root, "runtime");

      const first = await prepareDevElectronAppBundle({
        signApp,
        appSourcePath,
        rendererUrl,
        electronAppPath: sourceApp,
        runtimeRoot: outputRoot,
        electronVersion: "41.0.3",
        arch: "arm64",
      });
      // 重建会先 rm 整个 bundle 目录；用一个标记文件证明第二次确实走了缓存命中。
      const marker = join(first.appPath, "Contents", "cache-witness");
      await writeFile(marker, "kept", "utf8");

      await prepareDevElectronAppBundle({
        signApp,
        appSourcePath,
        rendererUrl,
        electronAppPath: sourceApp,
        runtimeRoot: outputRoot,
        electronVersion: "41.0.3",
        arch: "arm64",
      });

      expect(await readFile(marker, "utf8")).toBe("kept");
    },
  );
});

async function signingFixture() {
  const root = await mkdtemp(join(tmpdir(), "zcode-dev-signing-"));
  tempRoots.push(root);
  const electronAppPath = join(root, "Electron.app");
  await mkdir(join(electronAppPath, "Contents", "MacOS"), { recursive: true });
  await mkdir(join(electronAppPath, "Contents", "Resources"), { recursive: true });
  await writeFile(join(electronAppPath, "Contents", "MacOS", "Electron"), "fixture binary");
  await writeFile(
    join(electronAppPath, "Contents", "Info.plist"),
    `<plist><dict>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.github.Electron</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>`,
  );
  return {
    appSourcePath,
    rendererUrl,
    electronAppPath,
    runtimeRoot: join(root, "runtime"),
    electronVersion: "44.7.0",
    arch: "arm64",
  };
}

it.skipIf(process.platform === "win32")(
  "开发副本全部品牌资源就绪后签名，缓存命中不重复签名",
  async () => {
    const input = await signingFixture();
    const sign = vi.fn(async (path: string) => {
      const plist = await readFile(join(path, "Contents", "Info.plist"), "utf8");
      expect(plist).toContain(DEV_ELECTRON_APP_BUNDLE_ID);
      expect(plist).toContain(rendererUrl);
      expect(await readlink(join(path, "Contents", "Resources", "app"))).toBe(appSourcePath);
      expect(await readFile(join(path, "Contents", "Resources", "xcode.icns"))).toEqual(
        await readFile(new URL("../build/icon.icns", import.meta.url)),
      );
    });
    const first = await prepareDevElectronAppBundle({ ...input, signApp: sign });
    await prepareDevElectronAppBundle({ ...input, signApp: sign });
    expect(sign).toHaveBeenCalledExactlyOnceWith(first.appPath);
  },
);

it.skipIf(process.platform === "win32")(
  "缓存品牌或入口变化后重新签名，失败时撤销旧指纹",
  async () => {
    const input = await signingFixture();
    const sign = vi.fn(async () => {});
    const { appPath } = await prepareDevElectronAppBundle({ ...input, signApp: sign });
    await writeFile(join(appPath, "Contents", "Resources", "xcode.icns"), "old icon");
    await prepareDevElectronAppBundle({ ...input, signApp: sign });
    expect(sign).toHaveBeenCalledTimes(2);
    await prepareDevElectronAppBundle({
      ...input,
      rendererUrl: "http://127.0.0.1:5175",
      signApp: sign,
    });
    expect(sign).toHaveBeenCalledTimes(3);
    const entryPath = join(appPath, "Contents", "Resources", "app");
    await rm(entryPath);
    await symlink(join(input.runtimeRoot, "old-source"), entryPath, "dir");
    await expect(
      prepareDevElectronAppBundle({
        ...input,
        signApp: async () => {
          throw new Error("refresh signer failed");
        },
      }),
    ).rejects.toThrow("refresh signer failed");
    await expect(
      readFile(join(input.runtimeRoot, "44.7.0-arm64", ".zcode-dev-electron-source.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await prepareDevElectronAppBundle({ ...input, signApp: sign });
    expect(sign).toHaveBeenCalledTimes(4);
  },
);

it.skipIf(process.platform === "win32")("签名失败不发布缓存指纹；下次重新准备可恢复", async () => {
  const input = await signingFixture();
  await expect(
    prepareDevElectronAppBundle({
      ...input,
      signApp: async () => {
        throw new Error("signer failed");
      },
    }),
  ).rejects.toThrow("signer failed");
  const stamp = join(input.runtimeRoot, "44.7.0-arm64", ".zcode-dev-electron-source.json");
  await expect(readFile(stamp, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  const recovered = vi.fn(async () => {});
  await prepareDevElectronAppBundle({ ...input, signApp: recovered });
  expect(recovered).toHaveBeenCalledOnce();
  expect(JSON.parse(await readFile(stamp, "utf8")).format).toBe(DEV_ELECTRON_BUNDLE_FORMAT);
});
