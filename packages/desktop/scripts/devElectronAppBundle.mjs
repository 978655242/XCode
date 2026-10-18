import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, posix } from "node:path";

export const DEV_ELECTRON_PROTOCOL_SCHEME = "zcode";
// XCODE: 仅迁移开发应用展示名，协议、bundle ID 与缓存根目录保持不变。
export const DEV_ELECTRON_APP_NAME = "XWork Dev";
export const DEV_ELECTRON_APP_BUNDLE_ID = "dev.zcode.app.development";
// 副本布局版本，见 prepareDevElectronAppBundle 中的指纹说明。
export const DEV_ELECTRON_BUNDLE_FORMAT = 3;

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

function replacePlistString(plist, key, value) {
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`, "u");
  if (!pattern.test(plist)) {
    throw new Error(`Dev Electron Info.plist is missing ${key}`);
  }
  return plist.replace(
    pattern,
    (_match, prefix, suffix) => `${prefix}${escapeXml(value)}${suffix}`,
  );
}

function appendProtocolDeclaration(plist) {
  if (plist.includes(`<string>${DEV_ELECTRON_PROTOCOL_SCHEME}</string>`)) {
    // XCODE: 已注册 scheme 的缓存副本也更新协议展示名，保留原 URL scheme。
    return replacePlistString(plist, "CFBundleURLName", DEV_ELECTRON_APP_NAME);
  }

  const closingDictIndex = plist.lastIndexOf("</dict>");
  if (closingDictIndex < 0) {
    throw new Error("Dev Electron Info.plist is missing its root dict");
  }

  const protocolDeclaration = `\n\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>${DEV_ELECTRON_APP_NAME}</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${DEV_ELECTRON_PROTOCOL_SCHEME}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n`;
  return `${plist.slice(0, closingDictIndex)}${protocolDeclaration}${plist.slice(closingDictIndex)}`;
}

function setPlistEnvironmentValue(plist, key, value) {
  const environmentPattern = /(<key>LSEnvironment<\/key>\s*<dict>)([\s\S]*?)(<\/dict>)/u;
  const entryPattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`, "u");
  if (environmentPattern.test(plist)) {
    return plist.replace(environmentPattern, (_match, opener, entries, closer) => {
      const updatedEntries = entryPattern.test(entries)
        ? entries.replace(
            entryPattern,
            (_entry, prefix, suffix) => `${prefix}${escapeXml(value)}${suffix}`,
          )
        : `${entries}\n\t\t<key>${key}</key>\n\t\t<string>${escapeXml(value)}</string>`;
      return `${opener}${updatedEntries}${closer}`;
    });
  }

  const closingDictIndex = plist.lastIndexOf("</dict>");
  if (closingDictIndex < 0) {
    throw new Error("Dev Electron Info.plist is missing its root dict");
  }
  const environment = `\n\t<key>LSEnvironment</key>\n\t<dict>\n\t\t<key>${key}</key>\n\t\t<string>${escapeXml(value)}</string>\n\t</dict>\n`;
  return `${plist.slice(0, closingDictIndex)}${environment}${plist.slice(closingDictIndex)}`;
}

/**
 * 为 macOS 本地 Dev runtime 写入产品身份和 zcode URL scheme。
 * raw Electron 的 Info.plist 没有 CFBundleURLTypes，系统只能把 zcode 交给
 * com.github.Electron；这里仅修改启动副本，避免污染 node_modules 中的 Electron。
 */
export function patchDevElectronInfoPlist(plist, rendererUrl) {
  let patched = replacePlistString(plist, "CFBundleDisplayName", DEV_ELECTRON_APP_NAME);
  patched = replacePlistString(patched, "CFBundleIdentifier", DEV_ELECTRON_APP_BUNDLE_ID);
  patched = replacePlistString(patched, "CFBundleName", DEV_ELECTRON_APP_NAME);
  // XCODE: 开发 .app 也使用产品图标，不沿用 raw Electron 的图标声明。
  patched = replacePlistString(patched, "CFBundleIconFile", "xcode.icns");
  patched = appendProtocolDeclaration(patched);
  // XCODE: LaunchServices 冷启动不会继承 dev.mjs 的环境；本地 bundle 显式携带 Vite 地址。
  patched = setPlistEnvironmentValue(patched, "ZCODE_LOCAL_DEV_BUNDLE", "1");
  return setPlistEnvironmentValue(patched, "ELECTRON_RENDERER_URL", rendererUrl);
}

export function resolveDevElectronAppBundlePath({ runtimeRoot, electronVersion, arch }) {
  return posix.join(runtimeRoot, `${electronVersion}-${arch}`, `${DEV_ELECTRON_APP_NAME}.app`);
}

export async function prepareDevElectronAppBundle({
  appSourcePath,
  electronAppPath,
  runtimeRoot,
  electronVersion,
  arch,
  rendererUrl,
}) {
  const appPath = resolveDevElectronAppBundlePath({ runtimeRoot, electronVersion, arch });
  const infoPlistPath = posix.join(appPath, "Contents", "Info.plist");
  const sourceExecutablePath = posix.join(electronAppPath, "Contents", "MacOS", "Electron");
  const existingExecutablePath = posix.join(appPath, "Contents", "MacOS", "Electron");
  const appEntryPath = posix.join(appPath, "Contents", "Resources", "app");
  // 源二进制的身份指纹，写在 .app 外面：放进 Contents 会污染 bundle 结构。
  const sourceStampPath = posix.join(dirname(appPath), ".zcode-dev-electron-source.json");
  // 修复原因：这里原本把两个 Electron 可执行文件（各 ~100MB+）整份读进内存做 equals，
  // 每次 dev 启动都要付一次全量读盘。源二进制由 npm 包解压产出，记录它的 size+mtime
  // 即可判定是否需要重拷，语义等价而开销是常数级。
  //
  // 不直接比较「源与副本」的 mtime：cp 即使开 preserveTimestamps 也会把 mtime
  // 四舍五入到毫秒，源的亚毫秒精度必然丢失，两边永远不相等 —— 那等于没有缓存。
  //
  // format 字段记录副本的布局版本：布局修复（例如符号链接策略变更）时递增，
  // 让已存在的旧副本在源二进制没变的情况下也能被判定为需要重拷。
  const sourceStats = await stat(sourceExecutablePath).catch(() => undefined);
  const sourceStamp = sourceStats
    ? JSON.stringify({
        format: DEV_ELECTRON_BUNDLE_FORMAT,
        size: sourceStats.size,
        mtimeMs: sourceStats.mtimeMs,
      })
    : undefined;
  let needsCopy = true;
  try {
    const existingInfoPlist = await readFile(infoPlistPath, "utf8");
    await access(existingExecutablePath);
    const existingStamp = await readFile(sourceStampPath, "utf8");
    needsCopy =
      !existingInfoPlist.includes(`<string>${DEV_ELECTRON_APP_BUNDLE_ID}</string>`) ||
      !existingInfoPlist.includes(`<string>${DEV_ELECTRON_PROTOCOL_SCHEME}</string>`) ||
      sourceStamp === undefined ||
      existingStamp !== sourceStamp;
  } catch {
    // 目录不存在、来源不是本工具生成的 bundle，下面走一次完整复制。
  }

  if (needsCopy) {
    // 只删除本次生成的 ignored runtime 目录，绝不触碰 node_modules 或用户数据。
    await rm(appPath, { recursive: true, force: true });
    await rm(sourceStampPath, { force: true });
    await mkdir(dirname(appPath), { recursive: true });
    // verbatimSymlinks 必须开：Electron Framework.framework 内部靠相对符号链接
    // （Resources -> Versions/Current/Resources、Current -> A）组织。fs.cp 默认会把
    // 相对链接改写成指向 node_modules 的绝对路径，主进程仍能读到，但 GPU / network
    // 等 macOS 沙箱子进程只允许读本 bundle 目录，顺链接出去会被拦，表现为
    // "icudtl.dat not found in bundle" 然后 "GPU process isn't usable. Goodbye."。
    await cp(electronAppPath, appPath, { recursive: true, verbatimSymlinks: true });
    // 指纹最后写：中途失败时下次仍会判定为需要重拷，不会留下半成品缓存。
    if (sourceStamp !== undefined) await writeFile(sourceStampPath, sourceStamp, "utf8");
  }

  // XCODE: 缓存命中也同步展示名与产品图标，不依赖 Electron 二进制变化来刷新 Info.plist。
  await copyFile(
    posix.join(import.meta.dirname, "../build/icon.icns"),
    posix.join(appPath, "Contents", "Resources", "xcode.icns"),
  );
  const currentInfoPlist = await readFile(infoPlistPath, "utf8");
  const patchedInfoPlist = patchDevElectronInfoPlist(currentInfoPlist, rendererUrl);
  if (patchedInfoPlist !== currentInfoPlist) {
    await writeFile(infoPlistPath, patchedInfoPlist, "utf8");
  }
  // XCODE: LaunchServices 启动 .app 时不会附带开发命令的 "." 参数；没有 Resources/app
  // Electron 会执行 default_app.asar 并显示欢迎页。用链接复用源码根目录，让协议回调
  // 与 `Electron .` 启动走同一入口；每次启动重建，避免旧 runtime 缓存继续指向默认壳。
  await rm(appEntryPath, { recursive: true, force: true });
  await symlink(appSourcePath, appEntryPath, "dir");

  return {
    appPath,
    executablePath: posix.join(appPath, "Contents", "MacOS", "Electron"),
  };
}
