// XCODE: 默认仅静态读取 .app；--synthetic 才启动无窗口 fixture，可能触发 OS 钥匙串授权。
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const desktopRoot = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    app: { type: "string" },
    channel: { type: "string", default: "production" },
    synthetic: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(
    "node packages/desktop/test/runAiscooDesktopIdentityElectron.mjs --app /path/Aiscoo.app --channel production [--synthetic]\n" +
      "Default: exact Info.plist checks and read-only OS handler snapshot.\n" +
      "--synthetic: two external Electron fixture processes; may prompt for OS keychain access.\n" +
      "Never registers handlers, opens windows/URLs, launches the supplied app, or reads historical credentials.",
  );
  process.exit(0);
}
assert.equal(process.platform, "darwin", "macOS bundle smoke runner required");
assert.ok(values.app, "Pass --app explicitly");
const expected = {
  production: { appId: "dev.aiscoo.app", name: "Aiscoo", scheme: "aiscoo" },
  development: { appId: "dev.aiscoo.app.dev", name: "Aiscoo Dev", scheme: "aiscoo-dev" },
  preview: { appId: "dev.aiscoo.app.preview", name: "Aiscoo Preview", scheme: "aiscoo-preview" },
}[values.channel];
assert.ok(expected, "Invalid channel");
const appPath = await realpath(values.app);
assert.ok(appPath.endsWith(".app"));
const { stdout: plistJson } = await execFile("/usr/bin/plutil", [
  "-convert",
  "json",
  "-o",
  "-",
  join(appPath, "Contents/Info.plist"),
]);
const plist = JSON.parse(plistJson);
const schemes = (plist.CFBundleURLTypes || []).flatMap((entry) => entry.CFBundleURLSchemes || []);
assert.equal(plist.CFBundleIdentifier, expected.appId);
assert.equal(plist.CFBundleName, expected.name);
assert.equal(plist.CFBundleDisplayName, expected.name);
assert.deepEqual(schemes, [expected.scheme], "Bundle must declare exactly its own scheme");

// NSWorkspace 的查询 API 只读当前默认映射；缺少渠道不记作共存通过。
const { stdout: handlersJson } = await execFile("/usr/bin/osascript", [
  "-l",
  "JavaScript",
  "-e",
  `ObjC.import("AppKit");
const workspace = $.NSWorkspace.sharedWorkspace;
JSON.stringify(["zcode", "aiscoo", "aiscoo-dev", "aiscoo-preview"].map(scheme => {
  const url = $.NSURL.URLWithString($(scheme + "://oauth/callback"));
  const target = workspace.URLForApplicationToOpenURL(url);
  const path = ObjC.unwrap(target.path) || null;
  const bundleID = path ? ObjC.unwrap($.NSBundle.bundleWithURL(target).bundleIdentifier) : null;
  return { scheme, path, bundleID };
}));`,
]);
const handlers = JSON.parse(handlersJson);
const expectedHandlers = {
  zcode: "dev.zcode.app",
  aiscoo: "dev.aiscoo.app",
  "aiscoo-dev": "dev.aiscoo.app.dev",
  "aiscoo-preview": "dev.aiscoo.app.preview",
};
for (const handler of handlers) {
  assert.ok(
    !handler.bundleID || handler.bundleID === expectedHandlers[handler.scheme],
    `Unexpected default OS handler for ${handler.scheme}`,
  );
}
const report = {
  bundle: {
    status: "pass",
    appPath,
    channel: values.channel,
    appId: plist.CFBundleIdentifier,
    schemes,
  },
  osHandlers: {
    scope: "read-only default mapping; cold/hot startup and installation order not exercised",
    handlers,
  },
  safeStorage: {
    status: "not-run",
    scope: "requires explicit --synthetic; not historical credential migration",
  },
};

if (values.synthetic) {
  const electronPackage = require("electron/package.json");
  assert.equal(electronPackage.version, "44.7.0");
  const electron = await realpath(require("electron"));
  assert.ok(
    electron.startsWith(resolve(desktopRoot, "../../node_modules") + "/"),
    "Use this workspace's prepared Electron",
  );
  const outputRoot = join(desktopRoot, "out/aiscoo-identity-smoke");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "run-"));
  const id = randomUUID();
  for (const name of ["appData", "userData", "sessionData", "logs", "crashDumps", "tmp"]) {
    await mkdir(join(root, name));
  }
  await writeFile(
    join(root, "fixture.json"),
    JSON.stringify({
      name: `Aiscoo Identity Synthetic ${id}`,
      plaintext: `aiscoo-synthetic:${id}`,
    }),
    { flag: "wx", mode: 0o600 },
  );
  // runner 持有本轮目录并串行等待两个进程退出，避免并发写入同一合成状态。
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: join(root, "tmp"),
    LANG: "en_US.UTF-8",
    AISCOO_IDENTITY_SMOKE_ROOT: root,
  };
  const results = [];
  for (const phase of ["encrypt", "decrypt"]) {
    await execFile(
      electron,
      [
        join(import.meta.dirname, "aiscooDesktopIdentityElectron.mjs"),
        `--user-data-dir=${join(root, "userData")}`,
      ],
      {
        cwd: desktopRoot,
        env: { ...env, AISCOO_IDENTITY_SMOKE_PHASE: phase },
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
    );
    results.push(JSON.parse(await readFile(join(root, `${phase}.json`), "utf8")));
  }
  assert.notEqual(results[0].pid, results[1].pid);
  assert.equal(results[0].plaintextSha256, results[1].plaintextSha256);
  assert.equal(results[0].userData, results[1].userData);
  report.safeStorage = {
    status: "pass",
    scope:
      "two external synthetic fixture processes only; does not prove packaged bundle identity or old keychain access",
    root,
    results,
  };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
}
console.log(JSON.stringify(report, null, 2));
