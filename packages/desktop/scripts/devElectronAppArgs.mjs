// XCODE: 开发启动链 dev-desktop-env → pnpm dev:runtime → dev.mjs 不转发命令行，
// 隔离验收需要 --open-workspace 等应用参数，因此通过环境变量显式传递给 Electron。
export const DEV_ELECTRON_APP_ARGS_ENV = "ZCODE_DESKTOP_DEV_APP_ARGS";
const OPEN_WORKSPACE_ARG = "--open-workspace";

/**
 * 解析 JSON 字符串数组，只接受完整的 `--open-workspace=<路径>` 或 `--open-workspace`, `<路径>`。
 * 其余元素一律拒绝：Chromium/Node 开关会改变调试与安全语义；未配对的值（如 zcode:// 深链）
 * 会被 Main 从 process.argv 当作深链处理，绕过白名单。
 */
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
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (
      arg.startsWith(`${OPEN_WORKSPACE_ARG}=`) &&
      isPath(arg.slice(OPEN_WORKSPACE_ARG.length + 1))
    ) {
      continue;
    }
    if (arg === OPEN_WORKSPACE_ARG && isPath(args[index + 1])) {
      index += 1;
      continue;
    }
    throw new Error(`Unsupported dev Electron argument: ${arg}`);
  }
  return args;
}

// Main 的深链提取会扫描每个 argv 及其多轮解码结果，路径值中出现 zcode: 同样会被当作深链。
function isPath(value) {
  return Boolean(value) && !value.startsWith("-") && !/zcode:/i.test(decodeRepeatedly(value));
}

function decodeRepeatedly(value) {
  let decoded = value;
  // 与深链提取一致展开有限轮次，防止 %7Acode%3A 之类的编码绕过。
  for (let round = 0; round < 3; round += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}
