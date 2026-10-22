// XCODE: 开发启动链 dev-desktop-env → pnpm dev:runtime → dev.mjs 不转发命令行，
// 隔离验收需要 --open-workspace 等应用参数，因此通过环境变量显式传递给 Electron。
export const DEV_ELECTRON_APP_ARGS_ENV = "ZCODE_DESKTOP_DEV_APP_ARGS";
const ALLOWED_APP_ARGS = ["--open-workspace"];

/** 解析 JSON 字符串数组；只允许已知应用参数，拒绝 Chromium/Node 开关，避免改变调试与安全语义。 */
export function resolveDevElectronAppArgs(env) {
  const raw = env[DEV_ELECTRON_APP_ARGS_ENV]?.trim();
  if (!raw) return [];
  let args;
  try {
    args = JSON.parse(raw);
  } catch {
    throw new Error(`${DEV_ELECTRON_APP_ARGS_ENV} must be a JSON array of strings`);
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error(`${DEV_ELECTRON_APP_ARGS_ENV} must be a JSON array of strings`);
  }
  for (const arg of args) {
    if (
      arg.startsWith("-") &&
      !ALLOWED_APP_ARGS.some((name) => arg === name || arg.startsWith(`${name}=`))
    ) {
      throw new Error(`Unsupported dev Electron argument: ${arg}`);
    }
  }
  return args;
}
