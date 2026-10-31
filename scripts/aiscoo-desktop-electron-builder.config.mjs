import { chmod, stat } from "node:fs/promises";
import { resolve } from "node:path";
import baseConfig from "../packages/desktop/electron-builder.config.js";
import { getTargetPlatform } from "../packages/desktop/scripts/target-platform.mjs";

// asar 重打包可能丢失 macOS helper 的执行位，必须在签名前恢复以避免 PTY 启动失败。
export async function ensurePackagedNodePtyHelperExecutable({ resourcesDir, platformKey }) {
  if (!platformKey.startsWith("darwin-")) return;
  const helperPath = resolve(
    resourcesDir,
    "app.asar.unpacked/node_modules/node-pty/prebuilds",
    platformKey,
    "spawn-helper",
  );
  const metadata = await stat(helperPath);
  if (!metadata.isFile()) throw new Error(`node-pty helper 不是普通文件: ${helperPath}`);
  await chmod(helperPath, (metadata.mode & 0o7777) | 0o111);
}

export function createAiscooAfterPack(afterPack, platformKey = getTargetPlatform().key) {
  return async (context) => {
    await afterPack(context);
    if (context.electronPlatformName !== "darwin") return;
    const appName = `${context.packager.appInfo.productFilename}.app`;
    await ensurePackagedNodePtyHelperExecutable({
      resourcesDir: resolve(context.appOutDir, appName, "Contents", "Resources"),
      platformKey,
    });
  };
}

export default { ...baseConfig, afterPack: createAiscooAfterPack(baseConfig.afterPack) };
