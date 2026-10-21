import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { supportedTargets } from "../scripts/build-sea.mjs";
import {
  collectSeaKeyringAssets,
  keyringNativePackageForTarget,
  seaKeyringManifestAssetKey,
} from "../scripts/sea-keyring-assets.mjs";

// 回归：SEA 单文件包曾不携带系统钥匙串原生模块，复制到仓库外运行时 `login zen` 报
// "Cannot find package '@napi-rs/keyring'"。每个目标必须只带自己的原生绑定。
test("includes only the target's native keychain binding in SEA assets", async () => {
  const root = join(import.meta.dirname, "../../..");
  const expected = {
    "darwin-arm64": "@napi-rs/keyring-darwin-arm64",
    "darwin-x64": "@napi-rs/keyring-darwin-x64",
    "linux-arm64": "@napi-rs/keyring-linux-arm64-gnu",
    "linux-x64": "@napi-rs/keyring-linux-x64-gnu",
    "win-arm64": "@napi-rs/keyring-win32-arm64-msvc",
    "win-x64": "@napi-rs/keyring-win32-x64-msvc",
  };
  for (const target of supportedTargets) {
    assert.equal(keyringNativePackageForTarget(target), expected[target], target);
    const directory = await mkdtemp(join(tmpdir(), "zcode-sea-keyring-"));
    try {
      const { assets, manifest } = await collectSeaKeyringAssets({
        root,
        stagingDirectory: directory,
        target,
      });
      const paths = manifest.files.map((file) => file.path);
      assert.equal(typeof assets[seaKeyringManifestAssetKey], "string");
      assert.ok(paths.includes("node_modules/@napi-rs/keyring/index.js"), target);
      assert.ok(paths.includes("node_modules/@napi-rs/keyring/package.json"), target);
      const natives = paths.filter((path) => path.endsWith(".node"));
      assert.equal(natives.length, 1, `${target} ships exactly one native binding`);
      assert.ok(
        natives[0].startsWith(`node_modules/${expected[target]}/`),
        `${target}: ${natives[0]}`,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
});
