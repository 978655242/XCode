import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { chmod, cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { replaceAppAsarFromStaging } from "../../packages/desktop/scripts/app-asar-repack.mjs";
import {
  desktopDevelopmentKeychainName,
  desktopProductIdentities,
  resolveDesktopArtifactSuffix,
  resolveDesktopProductIdentity,
} from "../../packages/desktop/scripts/desktop-product-identity.mjs";
import {
  DEV_ELECTRON_APP_BUNDLE_ID,
  DEV_ELECTRON_APP_NAME,
  DEV_ELECTRON_BUNDLE_FORMAT,
  DEV_ELECTRON_PROTOCOL_SCHEME,
  patchDevElectronInfoPlist,
} from "../../packages/desktop/scripts/devElectronAppBundle.mjs";

const requireFromDesktop = createRequire(
  new URL("../../packages/desktop/package.json", import.meta.url),
);
const { getAiscooDesktopIdentity } = await import(
  requireFromDesktop.resolve("@zcode/shared/aiscoo-desktop-identity")
);
const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../../", import.meta.url);

const electronPlist = `<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.github.Electron</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>`;

function protocolDeclaration(name, scheme) {
  return `<dict><key>CFBundleURLName</key><string>${name}</string>
<key>CFBundleURLSchemes</key><array><string>${scheme}</string></array></dict>`;
}

function withProtocols(declarations) {
  return electronPlist.replace(
    "</dict></plist>",
    `<key>CFBundleURLTypes</key><array>${declarations.join("")}</array></dict></plist>`,
  );
}

test("Aiscoo packaging projects the shared profiles while retaining flavor and keychain contracts", () => {
  for (const flavor of ["production", "preview"]) {
    const identity = desktopProductIdentities[flavor];
    const profile = getAiscooDesktopIdentity(flavor);
    for (const [key, value] of Object.entries(profile)) {
      assert.equal(identity[key], value, `${flavor}.${key}`);
    }
    assert.equal(identity.flavor, flavor);
    assert.equal(identity.cuaHelperInstallVariant, flavor === "preview" ? "preview" : null);
    assert.ok(Object.isFrozen(identity));
  }
  assert.equal(desktopProductIdentities.production.macKeychainName, "XWork");
  assert.equal(desktopProductIdentities.preview.macKeychainName, "XWork Preview");
  assert.equal(desktopDevelopmentKeychainName, "XWork Dev");
  assert.equal(
    resolveDesktopProductIdentity({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }),
    desktopProductIdentities.preview,
  );
  assert.equal(resolveDesktopArtifactSuffix({ ZCODE_ENV: "production" }), "");
  assert.equal(resolveDesktopArtifactSuffix({ ZCODE_ENV: "test" }), "_TEST");
});

test("Dev bundle uses the development profile and invalidates the legacy bundle cache", () => {
  const identity = getAiscooDesktopIdentity("development");
  assert.equal(DEV_ELECTRON_APP_NAME, identity.productName);
  assert.equal(DEV_ELECTRON_APP_BUNDLE_ID, identity.appId);
  assert.equal(DEV_ELECTRON_PROTOCOL_SCHEME, identity.scheme);
  assert.ok(DEV_ELECTRON_BUNDLE_FORMAT > 4);
  const patched = patchDevElectronInfoPlist(electronPlist, "http://localhost:5174");
  assert.match(
    patched,
    /<key>CFBundleIdentifier<\/key>\s*<string>dev\.aiscoo\.app\.dev<\/string>/u,
  );
  assert.match(patched, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>aiscoo-dev<\/string>/u);
  assert.equal(patchDevElectronInfoPlist(patched, "http://localhost:5174"), patched);
});

test("Dev plist replaces old and duplicate protocol declarations without retaining zcode", () => {
  const rendererUrl = "http://localhost:5174/?label=A&B";
  for (const original of [
    withProtocols([protocolDeclaration("ZCode", "zcode")]),
    withProtocols([
      protocolDeclaration("ZCode", "zcode"),
      protocolDeclaration("Aiscoo", "aiscoo"),
      protocolDeclaration("Aiscoo Preview", "aiscoo-preview"),
      protocolDeclaration("Aiscoo Dev", "aiscoo-dev"),
    ]),
    withProtocols([]),
    electronPlist.replace("</dict></plist>", "<key>CFBundleURLTypes</key><array/></dict></plist>"),
  ]) {
    const patched = patchDevElectronInfoPlist(original, rendererUrl);
    assert.equal((patched.match(/<key>CFBundleURLTypes<\/key>/gu) ?? []).length, 1);
    const schemes = [
      ...patched.matchAll(/<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/gu),
    ].flatMap(([, values]) =>
      [...values.matchAll(/<string>([^<]+)<\/string>/gu)].map(([, value]) => value),
    );
    assert.deepEqual(schemes, ["aiscoo-dev"]);
    assert.match(patched, /label=A&amp;B/u);
    assert.equal(patchDevElectronInfoPlist(patched, rendererUrl), patched);
  }
});

test("macOS PTY helper is executable after archive repack and final hook", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX executable permissions required");
  const root = await mkdtemp(join(tmpdir(), "aiscoo-pty-packaging-"));
  try {
    const sourceDir = join(root, "source");
    const resourcesDir = join(root, "Aiscoo.app/Contents/Resources");
    await mkdir(resourcesDir, { recursive: true });
    const helperRelative = "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper";
    await mkdir(dirname(join(sourceDir, helperRelative)), { recursive: true });
    // XCODE: 模拟重打包后丢失执行位，验证修复能恢复实际进程执行能力。
    await writeFile(join(sourceDir, helperRelative), "#!/bin/sh\nexit 0\n", { mode: 0o644 });
    const archive = join(resourcesDir, "app.asar");
    const asarCli = join(
      dirname(requireFromDesktop.resolve("@electron/asar/package.json")),
      "bin/asar.js",
    );
    const assets = await import("../aiscoo-desktop-electron-builder.config.mjs");
    let originalFinished = false;
    const wrapped = assets.createAiscooAfterPack(async () => {
      await replaceAppAsarFromStaging({
        sourceDir,
        appAsarPath: archive,
        targetPlatformKey: "darwin-arm64",
        runAsarCommand: (args) => execFileSync(process.execPath, [asarCli, ...args]),
      });
      assert.equal((await stat(join(`${archive}.unpacked`, helperRelative))).mode & 0o111, 0);
      originalFinished = true;
    }, "darwin-arm64");
    await wrapped({
      appOutDir: root,
      electronPlatformName: "darwin",
      packager: { appInfo: { productFilename: "Aiscoo" } },
    });
    assert.equal(originalFinished, true);
    const helper = join(`${archive}.unpacked`, helperRelative);
    assert.equal((await stat(helper)).mode & 0o777, 0o755);
    await execFileAsync(helper, []);
    await assets.ensurePackagedNodePtyHelperExecutable({
      resourcesDir: root,
      platformKey: "linux-x64",
    });
    await assert.rejects(
      assets.ensurePackagedNodePtyHelperExecutable({
        resourcesDir: root,
        platformKey: "darwin-x64",
      }),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Aiscoo afterPack preserves base configuration and propagates original failures", async () => {
  const base = (await import("../../packages/desktop/electron-builder.config.js")).default;
  const { default: aiscoo, createAiscooAfterPack } =
    await import("../aiscoo-desktop-electron-builder.config.mjs");
  assert.notEqual(aiscoo.afterPack, base.afterPack);
  assert.equal(aiscoo.afterSign, base.afterSign);
  // XCODE: 锁定实际版本的 Builder 顺序，确保 afterPack 完成后才进入签名阶段。
  const builderSource = await readFile(
    requireFromDesktop.resolve("app-builder-lib/out/platformPackager.js"),
    "utf8",
  );
  const emit = builderSource.indexOf("await this.info.emitAfterPack(packContext)");
  const sign = builderSource.indexOf("await this.doSignAfterPack(", emit);
  assert.ok(emit >= 0 && sign > emit);
  const failure = new Error("original hook failed");
  const context = { electronPlatformName: "darwin" };
  await assert.rejects(
    createAiscooAfterPack(async () => {
      throw failure;
    }, "darwin-arm64")(context),
    failure,
  );
  let calls = 0;
  await createAiscooAfterPack(async () => {
    calls += 1;
  }, "linux-x64")({ electronPlatformName: "linux" });
  assert.equal(calls, 1);
});

test("macOS native PTY starts with the repaired packaged helper", async (t) => {
  if (process.platform !== "darwin") return t.skip("requires macOS native PTY");
  const root = await mkdtemp(join(tmpdir(), "aiscoo-native-pty-"));
  try {
    const packageRoot = dirname(requireFromDesktop.resolve("node-pty/package.json"));
    const packagedRoot = join(root, "app.asar/node_modules/node-pty");
    const unpackedRoot = join(root, "app.asar.unpacked/node_modules/node-pty");
    await mkdir(dirname(packagedRoot), { recursive: true });
    await mkdir(dirname(unpackedRoot), { recursive: true });
    await cp(packageRoot, packagedRoot, { recursive: true });
    const platformKey = `darwin-${process.arch}`;
    await cp(
      join(packageRoot, "prebuilds", platformKey),
      join(unpackedRoot, "prebuilds", platformKey),
      { recursive: true },
    );
    const helper = join(unpackedRoot, "prebuilds", platformKey, "spawn-helper");
    // XCODE: 对临时副本复现缺失执行位，避免修改依赖或其他工作树。
    await chmod(helper, 0o644);
    const { ensurePackagedNodePtyHelperExecutable } =
      await import("../aiscoo-desktop-electron-builder.config.mjs");
    await ensurePackagedNodePtyHelperExecutable({ resourcesDir: root, platformKey });
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "-e",
        `const pty = require(process.argv[1]); const p = pty.spawn('/bin/sh', ['-c', 'printf PTY_OK']); let output = ''; p.onData(data => output += data); p.onExit(({exitCode}) => { process.stdout.write(output); process.exitCode = exitCode; });`,
        packagedRoot,
      ],
      { timeout: 10000 },
    );
    assert.match(stdout, /PTY_OK/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [label, environment, channel] of [
  ["production", { ZCODE_ENV: "production" }, "production"],
  ["test preview", { ZCODE_ENV: "test" }, "preview"],
  ["production preview", { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }, "preview"],
]) {
  test(`electron-builder ${label} uses matching app, protocol, executable and desktop identities`, async () => {
    // XCODE: 在独立进程导入真实配置，覆盖环境选择与 Builder 的 desktop 生成逻辑，不执行打包或签名 hook。
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import config from "./packages/desktop/electron-builder.config.js";
        import { createRequire } from "node:module";
        const require = createRequire(new URL("./packages/desktop/package.json", import.meta.url));
        const { AppInfo } = require("app-builder-lib/out/appInfo.js");
        const { LinuxTargetHelper } = require("app-builder-lib/out/targets/LinuxTargetHelper.js");
        const info = { metadata: { name: "@zcode/desktop", version: "1.2.3", ...config.extraMetadata }, config };
        const appInfo = new AppInfo(info, undefined, config.linux);
        const helper = new LinuxTargetHelper({
          config, info, appInfo, executableName: config.linux.executableName,
          platformSpecificBuildOptions: config.linux, fileAssociations: [],
        });
        const desktopEntry = await helper.computeDesktopEntry(config.linux);
        process.stdout.write(JSON.stringify({
          appId: config.appId, productName: config.productName, protocols: config.protocols,
          windowsExecutableName: config.win.executableName, linuxExecutableName: config.linux.executableName,
          packages: [config.deb.packageName, config.rpm.packageName, config.pacman.packageName],
          desktopName: config.extraMetadata.desktopName,
          desktopFileName: helper.getDesktopFileName() + ".desktop", desktopEntry,
        }));
      `,
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          ZCODE_ENV: "production",
          ZCODE_PREVIEW_IDENTITY: "0",
          ZCODE_ENABLE_MAC_SIGN: "0",
          ZCODE_ENABLE_WINDOWS_SIGN: "0",
          ZCODE_TARGET_OS: "linux",
          ZCODE_TARGET_ARCH: "x64",
          ...environment,
        },
        maxBuffer: 1024 * 1024,
      },
    );
    const config = JSON.parse(stdout.trimEnd().split("\n").at(-1));
    const identity = getAiscooDesktopIdentity(channel);
    assert.equal(config.appId, identity.appId);
    assert.equal(config.productName, identity.productName);
    assert.deepEqual(config.protocols, [
      { name: identity.productName, schemes: [identity.scheme] },
    ]);
    assert.equal(config.windowsExecutableName, identity.windowsExecutableName);
    assert.equal(config.linuxExecutableName, identity.linuxExecutableName);
    assert.deepEqual(config.packages, Array(3).fill(identity.linuxPackageName));
    assert.equal(config.desktopName, identity.desktopFileName);
    assert.equal(config.desktopFileName, identity.desktopFileName);
    assert.ok(config.desktopEntry.includes(`Name=${identity.productName}\n`));
    assert.ok(config.desktopEntry.includes(`Icon=${identity.linuxExecutableName}\n`));
    assert.ok(
      config.desktopEntry.includes(
        `StartupWMClass=${identity.desktopFileName.replace(/\.desktop$/u, "")}\n`,
      ),
    );
    assert.ok(config.desktopEntry.includes(`MimeType=x-scheme-handler/${identity.scheme};\n`));
    assert.ok(config.desktopEntry.includes(`/${identity.linuxExecutableName}`));
    assert.ok(!config.desktopEntry.includes("x-scheme-handler/zcode"));
  });
}
