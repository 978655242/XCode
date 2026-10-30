import { spawn } from "node:child_process";
import { createServer, connect } from "node:net";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRootDefault = resolve(import.meta.dirname, "../..");

function portValue(value, name) {
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) {
    throw new Error(`${name} 必须是有效端口`);
  }
  return Number(value);
}

function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NEW_API_BASE_URL 必须是有效 origin");
  }
  const authority = value.match(/^https?:\/\/([^/?#]+)\/?$/i)?.[1];
  const hostname = authority?.replace(/:\d+$/, "").toLowerCase();
  if (
    !authority ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(hostname ?? ""))
  ) {
    throw new Error("NEW_API_BASE_URL 必须为精确 origin，HTTP 仅允许本机回环");
  }
  return url.origin;
}

export function resolveLocalWebConfig(env = process.env, repoRoot = repoRootDefault) {
  const webPort = portValue(env.AISCOO_LOCAL_WEB_PORT ?? "5174", "AISCOO_LOCAL_WEB_PORT");
  const serverPort = portValue(
    env.AISCOO_LOCAL_WEB_SERVER_PORT ?? "3030",
    "AISCOO_LOCAL_WEB_SERVER_PORT",
  );
  if (webPort === serverPort) throw new Error("Web 与 Server 端口不能相同");
  const backendOrigin = normalizeOrigin(env.NEW_API_BASE_URL ?? "http://127.0.0.1:3001");
  const webOrigin = `http://127.0.0.1:${webPort}`;
  return {
    repoRoot,
    serverPort,
    webPort,
    webOrigin,
    env: {
      ...env,
      AISCOO_LOCAL_WEB: "1",
      VITE_AISCOO_LOCAL_WEB: "1",
      AISCOO_LOCAL_WEB_SERVER_PORT: String(serverPort),
      AISCOO_LOCAL_WEB_ORIGINS: `${webOrigin},http://localhost:${webPort}`,
      NEW_API_BASE_URL: backendOrigin,
      PORT: String(serverPort),
      ZCODE_SERVER_HOST: "127.0.0.1",
      ZCODE_SERVER_AUTH_TOKEN: "",
    },
  };
}

async function checkPort(port) {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") reject(new Error(`端口 ${port} 已被占用`));
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
}

async function launchServices(config) {
  // tsup 的 onSuccess 子进程失败后 watcher 仍运行；使用仅本次启动知晓的回环通道回报失败。
  const secret = randomBytes(32).toString("hex");
  const failureServer = createServer();
  await new Promise((resolvePromise, reject) => {
    failureServer.once("error", reject);
    failureServer.listen(0, "127.0.0.1", resolvePromise);
  });
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const launcherPath = fileURLToPath(import.meta.url);
  const shellQuote = (value) =>
    process.platform === "win32"
      ? `"${value.replaceAll('"', '""')}"`
      : `'${value.replaceAll("'", "'\\''")}'`;
  const onSuccess = `${shellQuote(process.execPath)} ${shellQuote(launcherPath)} --run-server`;
  const tasks = [
    ["--filter", "@zcode/server", "exec", "tsup", "--watch", "--onSuccess", onSuccess],
    [
      "--filter",
      "@zcode/web",
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      String(config.webPort),
      "--strictPort",
    ],
  ];
  const windows = process.platform === "win32";
  // pnpm 退出时 tsup 启动的 Node 服务可能成为孤儿；独立进程组保留后代的归属。
  const children = tasks.map((args) =>
    spawn(pnpm, args, {
      cwd: config.repoRoot,
      env: {
        ...config.env,
        AISCOO_LOCAL_WEB_SUPERVISE_SERVER: "1",
        AISCOO_LOCAL_WEB_FAILURE_PORT: String(failureServer.address().port),
        AISCOO_LOCAL_WEB_FAILURE_SECRET: secret,
      },
      stdio: "inherit",
      shell: windows,
      detached: !windows,
    }),
  );
  return new Promise((resolvePromise, reject) => {
    let stopping = false;
    let remaining = children.length;
    let failure;
    let forceTimer;
    const signalGroup = (child, signal) => {
      if (!child.pid) return;
      try {
        if (windows) child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") failure ??= error;
      }
    };
    const finish = () => {
      if (remaining !== 0 || forceTimer) return;
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      failureServer.close();
      if (failure) reject(failure);
      else resolvePromise();
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      for (const child of children) signalGroup(child, "SIGTERM");
      // 修复原因：pnpm 已退出不代表同组服务已退出，必须保留宽限期后再清理后代。
      forceTimer = setTimeout(() => {
        for (const child of children) signalGroup(child, "SIGKILL");
        forceTimer = undefined;
        finish();
      }, 2000);
    };
    const interrupt = () => stop();
    failureServer.on("connection", (socket) => {
      let data = "";
      socket.setTimeout(1000, () => socket.destroy());
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        data += chunk;
        if (data.length > 128) socket.destroy();
      });
      socket.on("error", () => {});
      socket.on("end", () => {
        if (data === secret && !stopping) {
          failure ??= new Error("本机 Web Server 进程异常退出");
          stop();
        }
      });
    });
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    for (const child of children) {
      child.once("error", (error) => {
        failure ??= error;
        stop();
      });
      child.once("exit", (code, signal) => {
        if (!stopping && (code !== 0 || signal))
          failure ??= new Error(`本机 Web 服务退出 (${signal || code})`);
        if (!stopping) stop();
      });
      child.once("close", () => {
        remaining--;
        finish();
      });
    }
    console.log(`Aiscoo 本机 Web: ${config.webOrigin}`);
  });
}

export async function runLocalWeb(options = {}) {
  const config = resolveLocalWebConfig(
    options.env ?? process.env,
    options.repoRoot ?? repoRootDefault,
  );
  const check =
    options.checkPorts ??
    (async (ports) => {
      for (const port of ports) await checkPort(port);
    });
  await check([config.serverPort, config.webPort]);
  return (options.launch ?? launchServices)(config);
}

async function runServer() {
  const args = process.argv.slice(3);
  const child = spawn(process.execPath, args.length ? args : ["dist/entry-http.js"], {
    stdio: "inherit",
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
    child.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const result = await new Promise((resolvePromise) => {
    child.once("error", () => resolvePromise(1));
    child.once("exit", (code, signal) =>
      resolvePromise(signal === "SIGTERM" || signal === "SIGINT" ? 0 : signal ? 1 : (code ?? 1)),
    );
  });
  if (!stopping && result !== 0) {
    const port = Number(process.env.AISCOO_LOCAL_WEB_FAILURE_PORT);
    const secret = process.env.AISCOO_LOCAL_WEB_FAILURE_SECRET;
    if (Number.isInteger(port) && port > 0 && port <= 65535 && secret) {
      const socket = connect({ host: "127.0.0.1", port });
      socket.setTimeout(1000, () => socket.destroy());
      socket.on("error", () => {});
      socket.end(secret);
    }
  }
  process.exitCode = result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--run-server") {
    void runServer();
  } else {
    runLocalWeb().catch((error) => {
      console.error(`[aiscoo-web] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
  }
}
