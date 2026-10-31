import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { prepareDevElectronAppBundle } from "./devElectronAppBundle.mjs";

const ELECTRON_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>Electron</string>
  <key>CFBundleIdentifier</key><string>com.github.Electron</string>
  <key>CFBundleName</key><string>Electron</string>
  <key>CFBundleIconFile</key><string>electron.icns</string>
</dict>
</plist>`;

test("prepareDevElectronAppBundle links the package root as the Electron app entry", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "xcode-dev-electron-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const electronAppPath = join(tempRoot, "Electron.app");
  const appSourcePath = join(tempRoot, "desktop");
  await mkdir(join(electronAppPath, "Contents", "MacOS"), { recursive: true });
  await mkdir(join(electronAppPath, "Contents", "Resources"), { recursive: true });
  await mkdir(appSourcePath, { recursive: true });
  await writeFile(join(electronAppPath, "Contents", "Info.plist"), ELECTRON_INFO_PLIST);
  await writeFile(join(electronAppPath, "Contents", "MacOS", "Electron"), "electron");

  let signatureCalls = 0;
  const bundle = await prepareDevElectronAppBundle({
    appSourcePath,
    electronAppPath,
    runtimeRoot: join(tempRoot, "runtime"),
    electronVersion: "test",
    arch: "arm64",
    rendererUrl: "http://localhost:5174",
    // XCODE: 合成 app 没有 Mach-O，Linux 也没有 codesign；经既有签名端口核验资源先就绪，不改变生产签名路径。
    async signApp(appPath) {
      signatureCalls++;
      assert.equal(
        resolve(await readlink(join(appPath, "Contents", "Resources", "app"))),
        resolve(appSourcePath),
      );
      assert.deepEqual(
        await readFile(join(appPath, "Contents", "Resources", "xcode.icns")),
        await readFile(new URL("../build/icon.icns", import.meta.url)),
      );
      assert.match(
        await readFile(join(appPath, "Contents", "Info.plist"), "utf8"),
        /<key>ELECTRON_RENDERER_URL<\/key>\s*<string>http:\/\/localhost:5174<\/string>/u,
      );
    },
  });
  assert.equal(signatureCalls, 1);

  const appEntryPath = join(bundle.appPath, "Contents", "Resources", "app");
  assert.equal(resolve(await readlink(appEntryPath)), resolve(appSourcePath));

  const infoPlist = await readFile(join(bundle.appPath, "Contents", "Info.plist"), "utf8");
  assert.match(infoPlist, /<key>ZCODE_LOCAL_DEV_BUNDLE<\/key>\s*<string>1<\/string>/u);
  assert.match(
    infoPlist,
    /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>aiscoo-dev<\/string>/u,
  );
  assert.doesNotMatch(infoPlist, /<string>zcode<\/string>/u);
  // XCODE: plist 展示新品牌；加密钥匙串身份由 Main 的 ready 前名称独立保持。
  assert.match(infoPlist, /<key>CFBundleDisplayName<\/key>\s*<string>Aiscoo Dev<\/string>/u);
  assert.match(infoPlist, /<key>CFBundleName<\/key>\s*<string>Aiscoo Dev<\/string>/u);
  assert.match(
    infoPlist,
    // XCODE: Dev bundle 的系统身份与共享 development profile 保持一致。
    /<key>CFBundleIdentifier<\/key>\s*<string>dev\.aiscoo\.app\.dev<\/string>/u,
  );
  assert.match(
    infoPlist,
    /<key>ELECTRON_RENDERER_URL<\/key>\s*<string>http:\/\/localhost:5174<\/string>/u,
  );
});
