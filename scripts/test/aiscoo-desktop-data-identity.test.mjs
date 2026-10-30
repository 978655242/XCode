import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import ts from "typescript";

const entry = new URL(
  "../../packages/desktop/src/aiscoo-desktop-identity/index.ts",
  import.meta.url,
);

async function loadRuntime(channel) {
  const result = await build({
    entryPoints: [entry.pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    define: channel ? { __AISCOO_DESKTOP_CHANNEL__: JSON.stringify(channel) } : {},
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

test("Aiscoo selects channel data roots without reading legacy settings", async () => {
  for (const [channel, dataName] of [
    ["production", "Aiscoo"],
    ["development", "Aiscoo Dev"],
    ["preview", "Aiscoo Preview"],
  ]) {
    const { bootstrapAiscooDesktopData } = await loadRuntime(channel);
    let root;
    let settingsFile;
    const env = {};
    const result = bootstrapAiscooDesktopData(
      (file) => {
        settingsFile = file;
        return null;
      },
      {
        env,
        appDataPath: "/isolated/app-data",
        setDataBaseDir: (path) => {
          root = path;
        },
      },
    );
    assert.equal(result, null);
    assert.equal(root, join("/isolated/app-data", dataName));
    assert.equal(settingsFile, join(root, ".zcode", "v2", "setting.json"));
    assert.equal(env.ZCODE_SETTINGS_FILE_PATH, settingsFile);
    assert.equal(env.HOME, undefined);
  }
});

test("explicit data roots and existing custom settings remain owned by original bootstrap", async () => {
  const { bootstrapAiscooDesktopData } = await loadRuntime("production");
  const env = { ZCODE_DATA_BASE_DIR: "/explicit/data", HOME: "/real/home" };
  let root;
  const result = bootstrapAiscooDesktopData(
    (file) => {
      assert.equal(file, "/explicit/data/.zcode/v2/setting.json");
      root = "/custom/from-settings";
      return root;
    },
    {
      env,
      appDataPath: "/unused",
      setDataBaseDir: (value) => {
        root = value;
      },
    },
  );
  assert.equal(result, "/custom/from-settings");
  assert.equal(root, "/custom/from-settings");
  assert.equal(env.HOME, "/real/home");
});

test("unconfigured upstream bootstrap receives no Aiscoo side effects", async () => {
  const { bootstrapAiscooDesktopData } = await loadRuntime();
  const env = { HOME: "/real/home" };
  let calls = 0;
  assert.equal(
    bootstrapAiscooDesktopData(
      (...args) => {
        assert.deepEqual(args, []);
        calls++;
        return "/upstream";
      },
      {
        env,
        appDataPath: "/unused",
        setDataBaseDir: () => assert.fail("Unexpected Aiscoo mutation"),
      },
    ),
    "/upstream",
  );
  assert.equal(calls, 1);
  assert.deepEqual(env, { HOME: "/real/home" });
});

test("Aiscoo child storage paths are isolated and preserve explicit overrides", async () => {
  const { buildAiscooDesktopStorageEnv } = await loadRuntime("production");
  assert.deepEqual(buildAiscooDesktopStorageEnv("/isolated/data", {}), {
    ZCODE_STORAGE_DIR: "/isolated/data/.zcode",
    ZCODE_SESSION_DB_PATH: "/isolated/data/.zcode/cli/db/db.sqlite",
    ZCODE_LOG_DIR: "/isolated/data/.zcode/cli/log",
  });
  assert.deepEqual(
    buildAiscooDesktopStorageEnv("/isolated/data", { ZCODE_LOG_DIR: "/explicit/log" }),
    {
      ZCODE_STORAGE_DIR: "/isolated/data/.zcode",
      ZCODE_SESSION_DB_PATH: "/isolated/data/.zcode/cli/db/db.sqlite",
      ZCODE_LOG_DIR: "/explicit/log",
    },
  );
  assert.deepEqual((await loadRuntime()).buildAiscooDesktopStorageEnv("/upstream", {}), {});
});

test("Main cold startup warms only the selected channel workspace and retains the default HOME fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "aiscoo-startup-settings-"));
  const previousHome = process.env.HOME;
  const previousSettings = process.env.ZCODE_SETTINGS_FILE_PATH;
  try {
    const home = join(root, "old-home");
    const legacySettings = join(home, ".zcode", "v2", "setting.json");
    const selectedSettings = join(root, "channel", "setting.json");
    const legacyWorkspace = join(root, "workspace-a");
    const selectedWorkspace = join(root, "workspace-b");
    for (const directory of [
      join(home, ".zcode", "v2"),
      join(root, "channel"),
      legacyWorkspace,
      selectedWorkspace,
    ]) {
      await mkdir(directory, { recursive: true });
    }
    for (const [file, workspacePath] of [
      [legacySettings, legacyWorkspace],
      [selectedSettings, selectedWorkspace],
    ]) {
      await writeFile(
        file,
        JSON.stringify({
          lastActiveWorkspace: { kind: "local", workspacePath, workspacePurpose: "project" },
        }),
      );
    }
    process.env.HOME = home;

    // XCODE: 取实际 Main 的配置表达式并调用真实启动 owner，只替换外层 Electron 启动，避免测试复制路径选择逻辑。
    const source = await readFile(
      new URL("../../packages/desktop/src/main/index.ts", import.meta.url),
      "utf8",
    );
    const parsed = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = parsed.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find((item) => ts.isIdentifier(item.name) && item.name.text === "settingsFile");
    assert.ok(declaration?.initializer, "Main must explicitly select its startup settings file");
    const compiled = await build({
      stdin: {
        contents: `import { join } from "node:path"; import { homedir } from "node:os"; import { resolveStartupWindowBootstrap } from "./startupWorkspace.ts"; export const settingsFile = ${declaration.initializer.getText(parsed)}; export { resolveStartupWindowBootstrap };`,
        resolveDir: new URL("../../packages/desktop/src/main", import.meta.url).pathname,
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
    });
    const compiledUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
    for (const [override, workspacePath] of [
      [selectedSettings, selectedWorkspace],
      [undefined, legacyWorkspace],
    ]) {
      if (override === undefined) delete process.env.ZCODE_SETTINGS_FILE_PATH;
      else process.env.ZCODE_SETTINGS_FILE_PATH = override;
      const runtime = await import(
        `${compiledUrl}#startup-${override === undefined ? "default" : "channel"}`
      );
      const result = await runtime.resolveStartupWindowBootstrap({
        settingsFile: runtime.settingsFile,
        conversationWorkspaceDir: join(root, "conversation"),
      });
      assert.deepEqual(result.agentWarmupTargets, [{ workspacePath }]);
    }
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousSettings === undefined) delete process.env.ZCODE_SETTINGS_FILE_PATH;
    else process.env.ZCODE_SETTINGS_FILE_PATH = previousSettings;
    await rm(root, { recursive: true, force: true });
  }
});

test("early Chromium settings use the same isolated file instead of legacy HOME", async () => {
  const root = await mkdtemp(join(tmpdir(), "aiscoo-hardware-settings-"));
  const previousHome = process.env.HOME;
  const previousSettings = process.env.ZCODE_SETTINGS_FILE_PATH;
  try {
    const oldFile = join(root, "old-home", ".zcode", "v2", "setting.json");
    const newFile = join(root, "aiscoo", "setting.json");
    await mkdir(join(root, "old-home", ".zcode", "v2"), { recursive: true });
    await mkdir(join(root, "aiscoo"));
    await writeFile(oldFile, JSON.stringify({ desktopChromiumHardwareAccelerationEnabled: true }));
    await writeFile(newFile, JSON.stringify({ desktopChromiumHardwareAccelerationEnabled: false }));
    process.env.HOME = join(root, "old-home");
    process.env.ZCODE_SETTINGS_FILE_PATH = newFile;
    const result = await build({
      stdin: {
        contents:
          'import "./desktopEarlyChromiumHardwareAccelerationBootstrap.ts"; export { calls } from "electron";',
        resolveDir: new URL("../../packages/desktop/src/main", import.meta.url).pathname,
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      plugins: [
        {
          name: "isolated-electron-app",
          setup(builder) {
            builder.onResolve({ filter: /^electron$/ }, () => ({
              path: "electron",
              namespace: "fixture",
            }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents:
                "export let calls=0; export const app={disableHardwareAcceleration(){calls++;}};",
              loader: "js",
            }));
          },
        },
      ],
    });
    const runtime = await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#isolated-hardware`
    );
    assert.equal(runtime.calls, 1, "Aiscoo disabled setting must win over legacy enabled setting");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousSettings === undefined) delete process.env.ZCODE_SETTINGS_FILE_PATH;
    else process.env.ZCODE_SETTINGS_FILE_PATH = previousSettings;
    await rm(root, { recursive: true, force: true });
  }
});
