import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveLocalWebConfig, runLocalWeb } from "./dev-web.mjs";

test("local Web uses explicit loopback endpoints and aiscoo-admin", () => {
  const config = resolveLocalWebConfig({}, "/project");
  assert.equal(config.serverPort, 3030);
  assert.equal(config.webPort, 5174);
  assert.equal(config.webOrigin, "http://127.0.0.1:5174");
  assert.equal(config.env.NEW_API_BASE_URL, "http://127.0.0.1:3001");
  assert.equal(config.env.AISCOO_LOCAL_WEB, "1");
  assert.equal(config.env.VITE_AISCOO_LOCAL_WEB, "1");
  assert.equal(config.env.ZCODE_SERVER_HOST, "127.0.0.1");
  assert.equal(config.env.AISCOO_LOCAL_WEB_ORIGINS, `${config.webOrigin},http://localhost:5174`);
  assert.equal(config.env.ZCODE_SERVER_AUTH_TOKEN, "");
});

test("explicit ports and origin are honored without changing the user data root", () => {
  const config = resolveLocalWebConfig(
    {
      AISCOO_LOCAL_WEB_PORT: "5281",
      AISCOO_LOCAL_WEB_SERVER_PORT: "3291",
      NEW_API_BASE_URL: "https://example.com",
      ZCODE_DATA_BASE_DIR: "/test/data",
    },
    "/project",
  );
  assert.equal(config.webOrigin, "http://127.0.0.1:5281");
  assert.equal(config.env.PORT, "3291");
  assert.equal(config.env.AISCOO_LOCAL_WEB_SERVER_PORT, "3291");
  assert.equal(config.env.AISCOO_LOCAL_WEB_ORIGINS, "http://127.0.0.1:5281,http://localhost:5281");
  assert.equal(config.env.NEW_API_BASE_URL, "https://example.com");
  assert.equal(config.env.ZCODE_DATA_BASE_DIR, "/test/data");
});

test("invalid origins and ports fail closed before spawning", () => {
  for (const env of [
    { NEW_API_BASE_URL: "" },
    { NEW_API_BASE_URL: "http://192.168.1.1:3001" },
    { NEW_API_BASE_URL: "http://127.0.0.1:3001/path" },
    { AISCOO_LOCAL_WEB_PORT: "0" },
    { AISCOO_LOCAL_WEB_PORT: "80" },
    { AISCOO_LOCAL_WEB_PORT: "65536" },
    { AISCOO_LOCAL_WEB_PORT: "5174x" },
    { AISCOO_LOCAL_WEB_PORT: "3030" },
  ]) {
    assert.throws(() => resolveLocalWebConfig(env, "/project"));
  }
});

test("port 80 is rejected with a clear error that matches the Server's URL normalization", async () => {
  assert.throws(
    () => resolveLocalWebConfig({ AISCOO_LOCAL_WEB_PORT: "80" }, "/project"),
    /AISCOO_LOCAL_WEB_PORT 不支持 HTTP 默认端口 80/,
  );
  // Server 侧：URL 规范化会丢弃 :80，因此带 :80 的页面 origin 永远不能匹配，必须明确拒绝而非静默接受。
  assert.equal(new URL("http://127.0.0.1:80").origin, "http://127.0.0.1");
  // 启动器在占用检查与任何子进程启动之前就拒绝，不会进入 launch。
  let launched = false;
  await assert.rejects(
    runLocalWeb({
      env: { AISCOO_LOCAL_WEB_PORT: "80" },
      repoRoot: "/project",
      checkPorts: async () => assert.fail("must not probe ports"),
      launch: async () => {
        launched = true;
      },
    }),
    /端口 80/,
  );
  assert.equal(launched, false);
});

test("a real occupied port is rejected without starting either process", async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const occupied = server.address().port;
    const freePort = await unusedPort();
    let launched = false;
    await assert.rejects(
      runLocalWeb({
        env: {
          AISCOO_LOCAL_WEB_PORT: String(occupied),
          AISCOO_LOCAL_WEB_SERVER_PORT: String(freePort),
        },
        repoRoot: "/project",
        launch: () => {
          launched = true;
        },
      }),
      new RegExp(`端口 ${occupied} 已被占用`),
    );
    assert.equal(launched, false);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

const launcher = fileURLToPath(new URL("./dev-web.mjs", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitFor(action, message, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await action()) return;
    await sleep(50);
  }
  throw new Error(message);
}

async function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function exerciseCleanup(t, mode) {
  const dir = await mkdtemp(join(tmpdir(), "aiscoo-web-process-test-"));
  const servicePath = join(dir, "service.mjs");
  const pnpmPath = join(dir, "pnpm");
  const readyPath = (name) => join(dir, `${name}.pid`);
  // A pnpm-like parent starts a service that can outlive its parent, as tsup does.
  await writeFile(
    servicePath,
    `
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], String(process.pid));
if (process.argv[3] === "ignore") process.on("SIGTERM", () => {});
if (process.argv[3] === "service-fail") setTimeout(() => process.exit(23), 500);
if (process.argv[3] === "service-zero") setTimeout(() => process.exit(0), 500);
if (process.argv[3] === "service-signal") setTimeout(() => process.kill(process.pid, "SIGTERM"), 500);
setInterval(() => {}, 1000);
`,
  );
  await writeFile(
    pnpmPath,
    `#!${process.execPath}
const { spawn } = require("node:child_process");
const server = process.argv.includes("@zcode/server");
const serviceArgs = [${JSON.stringify(servicePath)}, ${JSON.stringify(dir)} + (server ? "/server.pid" : "/web.pid"), server ? ${JSON.stringify(mode)} : "normal"];
const supervised = server && ${JSON.stringify(mode)}.startsWith("service-") && process.env.AISCOO_LOCAL_WEB_SUPERVISE_SERVER === "1";
const child = spawn(process.execPath, supervised ? [${JSON.stringify(launcher)}, "--run-server", ...serviceArgs] : serviceArgs, { stdio: "inherit" });
if (supervised) child.on("exit", () => {});
if (server && ${JSON.stringify(mode)} === "fail") setTimeout(() => process.exit(12), 350);
else setInterval(() => {}, 1000);
`,
    { mode: 0o755 },
  );
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const webPort = await unusedPort();
  let serverPort = await unusedPort();
  while (serverPort === webPort) serverPort = await unusedPort();
  const launcherProcess = spawn(process.execPath, [launcher], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      AISCOO_LOCAL_WEB_PORT: String(webPort),
      AISCOO_LOCAL_WEB_SERVER_PORT: String(serverPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  launcherProcess.stdout.on("data", (chunk) => {
    output += chunk;
  });
  launcherProcess.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const closed = new Promise((resolve) =>
    launcherProcess.once("close", (code, signal) => resolve({ code, signal })),
  );
  const pids = [];
  try {
    await waitFor(async () => {
      try {
        const entries = await Promise.all([
          readFile(readyPath("server"), "utf8"),
          readFile(readyPath("web"), "utf8"),
        ]);
        pids.splice(0, pids.length, ...entries.map(Number));
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    }, `services did not start: ${output}`);
    if (mode !== "fail" && !mode.startsWith("service-")) launcherProcess.kill("SIGINT");
    let timeout;
    const result = await Promise.race([
      closed,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`launcher did not exit: ${output}`)), 8000);
        timeout.unref();
      }),
    ]).finally(() => clearTimeout(timeout));
    assert.equal(result.code, mode === "fail" || mode.startsWith("service-") ? 1 : 0, output);
    await waitFor(
      async () => (await Promise.all(pids.map(pidIsAlive))).every((alive) => !alive),
      "service descendants remained alive",
    );
    assert.equal(await pidIsAlive(unrelated.pid), true, "unrelated process was terminated");
  } finally {
    launcherProcess.kill("SIGKILL");
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") console.error("Failed to clean test child", error);
      }
    }
    unrelated.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
}

for (const mode of [
  "interrupt",
  "fail",
  "ignore",
  "service-fail",
  "service-zero",
  "service-signal",
]) {
  test(
    `cleans owned process trees on ${mode}`,
    { skip: process.platform === "win32", timeout: 15000 },
    (t) => exerciseCleanup(t, mode),
  );
}

test("port conflicts stop before launching services", async () => {
  let launched = false;
  await assert.rejects(
    runLocalWeb({
      env: {},
      repoRoot: "/project",
      checkPorts: async () => {
        throw new Error("端口 5174 已被占用");
      },
      launch: () => {
        launched = true;
      },
    }),
    /端口 5174 已被占用/,
  );
  assert.equal(launched, false);
});
