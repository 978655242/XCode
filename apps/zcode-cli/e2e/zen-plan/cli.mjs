// CLI 驱动：使用真实构建产物 dist/zcode.cjs。每个“设备”拥有独立数据根和独立钥匙串条目。
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import xterm from "@xterm/headless";

const { Terminal } = xterm;
const here = fileURLToPath(new URL(".", import.meta.url));
export const CLI_BUNDLE = resolve(here, "../../packages/cli/dist/zcode.cjs");
const REPO_ROOT = resolve(here, "../../../..");
const COMMAND_TIMEOUT_MS = 90_000;

export async function createDevice(root, name, origin) {
  const deviceRoot = join(root, "devices", name);
  const workspace = join(deviceRoot, "workspace");
  const shim = join(deviceRoot, "bin");
  await mkdir(workspace, { recursive: true });
  await mkdir(shim, { recursive: true });
  // TUI 会调用平台浏览器命令；测试中以记录 URL 的替身代替，避免弹出用户真实浏览器。
  const openedUrlsFile = join(deviceRoot, "opened-urls.log");
  for (const command of ["open", "xdg-open"]) {
    await writeFile(join(shim, command), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${openedUrlsFile}'\n`, { mode: 0o755 });
  }
  // 内置 Provider 配置的读取会在文件旁创建锁目录；复制到设备根，测试不触碰仓库文件。
  const builtinConfig = join(deviceRoot, "zcode-builtin.json");
  await copyFile(join(REPO_ROOT, "config/provider/zcode-builtin.json"), builtinConfig);
  return {
    name, root: deviceRoot, workspace, openedUrlsFile,
    async openedUrls() {
      try {
        return (await readFile(openedUrlsFile, "utf8")).split("\n").filter(Boolean);
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
    async waitForOpenedUrl(timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const url = (await this.openedUrls()).findLast((opened) => opened.includes("client_id=xwork-cli"));
        if (url) return url;
        await sleep(100);
      }
      throw new Error("TUI did not ask the platform to open the authorize URL");
    },
    env: {
      ...process.env,
      PATH: `${shim}${delimiter}${process.env.PATH}`,
      AISCOO_ADMIN_BASE_URL: origin,
      ZCODE_DATA_BASE_DIR: deviceRoot,
      ZCODE_STORAGE_DIR: join(deviceRoot, ".zcode"),
      ZCODE_SESSION_DB_PATH: join(deviceRoot, ".zcode", "cli", "db", "db.sqlite"),
      ZCODE_LOG_DIR: join(deviceRoot, ".zcode", "cli", "log"),
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinConfig,
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(deviceRoot, "personal-provider.json"),
      // 不读取真实用户凭据；官方账号回归用独立文件证明共存。
      NO_COLOR: "1",
    },
    credentialDirectory: join(deviceRoot, ".zcode", "cli", "zen"),
  };
}

/** 运行一个非交互命令，按行实时观察 stderr（用于读取 JSON authorize 事件）。 */
export function runCli(device, args, { onStderrLine, signal } = {}) {
  const child = spawn(process.execPath, [CLI_BUNDLE, ...args], { cwd: device.workspace, env: device.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let buffered = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop();
    for (const line of lines) onStderrLine?.(line);
  });
  signal?.addEventListener("abort", () => child.kill("SIGINT"), { once: true });
  const timer = setTimeout(() => child.kill("SIGTERM"), COMMAND_TIMEOUT_MS);
  const exited = new Promise((resolveExit) => child.on("exit", (code, exitSignal) => { clearTimeout(timer); resolveExit({ code, signal: exitSignal, stdout, stderr }); }));
  return { child, exited };
}

/** `login zen --no-browser --json`：返回授权 URL 与最终结果 promise。 */
export function startJsonLogin(device) {
  let resolveUrl;
  let rejectUrl;
  const authorizeUrl = new Promise((resolvePromise, rejectPromise) => { resolveUrl = resolvePromise; rejectUrl = rejectPromise; });
  const run = runCli(device, ["login", "zen", "--no-browser", "--json"], {
    onStderrLine(line) {
      try {
        const event = JSON.parse(line);
        if (event.event === "authorize" && event.provider === "zen") resolveUrl(event.url);
      } catch {}
    },
  });
  run.exited.then((result) => rejectUrl(new Error(`login exited before authorize URL: ${result.code} ${redact(result.stderr)}`)));
  return { ...run, authorizeUrl };
}

export function redact(text) {
  return String(text)
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[relay]")
    .replace(/eyJ[A-Za-z0-9_.-]+/g, "[jwt]");
}

/** 断言输出不含任何会话凭据材料。 */
export function assertNoSecrets(label, text, secrets = []) {
  for (const pattern of [/sk-[A-Za-z0-9_-]{8,}/, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /refresh_token/i, /access_token/i]) {
    if (pattern.test(text)) throw new Error(`${label} leaked credential material (${pattern})`);
  }
  for (const secret of secrets) if (secret && text.includes(secret)) throw new Error(`${label} leaked a known secret`);
}

/** 真实 PTY TUI 会话：输出经 xterm headless 仿真，按“当前屏幕”而非字节流断言。 */
export function startTui(device, { cols = 120, rows = 40, args = [] } = {}) {
  const term = pty.spawn(process.execPath, [CLI_BUNDLE, ...args], { name: "xterm-256color", cols, rows, cwd: device.workspace, env: { ...device.env, TERM: "xterm-256color" } });
  const emulator = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 2000 });
  let log = "";
  let exit;
  const exited = new Promise((resolveExit) => term.onExit((value) => { exit = value; resolveExit(value); }));
  term.onData((data) => { log += data; emulator.write(data); });
  const screen = () => {
    const buffer = emulator.buffer.active;
    const lines = [];
    for (let index = buffer.viewportY; index < buffer.viewportY + rows; index += 1) lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
    return lines.join("\n");
  };
  // 授权 URL 可能因换行被拆开；在完整滚动缓冲中拼接寻找。
  const history = () => {
    const buffer = emulator.buffer.active;
    let text = "";
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index);
      text += (line?.translateToString(true) ?? "") + (line?.isWrapped || buffer.getLine(index + 1)?.isWrapped ? "" : "\n");
    }
    return text;
  };
  const flush = () => new Promise((resolveFlush) => emulator.write("", resolveFlush));
  return {
    term, exited,
    screen, history,
    raw: () => log,
    /** TUI 自行折行显示长 URL；拼接从 URL 起点到 S256 结尾之间的行。 */
    async authorizeUrl(timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await flush();
        const lines = history().split("\n").map((line) => line.trim());
        const start = lines.findIndex((line) => /^https?:\/\/\S*\/api\/xcode\/v1\/auth\/authorize\?/.test(line));
        if (start >= 0) {
          let url = "";
          for (const line of lines.slice(start)) {
            if (!line) continue;
            if (/^After authorization|^授权完成/.test(line)) break;
            url += line;
            if (/code_challenge_method=S256$/.test(url)) return url;
          }
        }
        await sleep(100);
      }
      throw new Error(`authorize URL not shown\n${redact(screen())}`);
    },
    write: (data) => term.write(data),
    async type(text) {
      for (const char of text) { term.write(char); await sleep(20); }
    },
    async key(name) {
      term.write({ enter: "\r", escape: "\x1b", down: "\x1b[B", up: "\x1b[A", ctrlC: "\x03", tab: "\t" }[name]);
      await sleep(150);
    },
    async waitFor(pattern, timeoutMs = 30_000, { inHistory = false } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await flush();
        const text = inHistory ? history() : screen();
        const match = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
        if (match) return text;
        if (exit) throw new Error(`TUI exited (${exit.exitCode}) while waiting for ${pattern}\n${redact(screen())}`);
        await sleep(100);
      }
      await flush();
      throw new Error(`timed out waiting for ${pattern}\n--- screen ---\n${redact(screen())}`);
    },
    async close() {
      if (!exit) {
        term.write("\x03");
        await Promise.race([exited, sleep(2000)]);
        if (!exit) term.write("\x03");
        await Promise.race([exited, sleep(3000)]);
        if (!exit) term.kill();
        await Promise.race([exited, sleep(3000)]);
      }
      emulator.dispose();
    },
  };
}

export const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export async function writeDeviceFile(device, name, content) {
  await writeFile(join(device.root, name), content, { mode: 0o600 });
}
