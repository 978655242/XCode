import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import {
  desktopDevelopmentKeychainName,
  desktopProductIdentities,
} from "../scripts/desktop-product-identity.mjs";
import { installFinderOpenFolderWorkflow } from "../src/main/desktopFinderOpenFolderWorkflow.js";
import {
  createLinuxDeepLinkDesktopEntry,
  registerLinuxDeepLinkProtocol,
} from "../src/main/desktopLinuxDeepLinkRegistration.js";
import {
  getWindowsOpenFolderMenuName,
  buildWindowsOpenFolderRegistryOperations,
} from "../src/main/desktopWindowsOpenFolderContextMenu.js";
import { indicatorCopy } from "../src/main/windowsCuaOperationIndicatorContent.js";
import { resolveCuaPermissionPanelMessages } from "../src/renderer/cuaPermissionPanelMessages.js";
import {
  HELPER_APP_NAME,
  HELPER_DISPLAY_NAME,
  HELPER_BUNDLE_ID,
  DEV_CUA_HELPER_BUNDLE_ID,
} from "@zcode/zcode-cua/broker/helperConstants";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "aiscoo-native-brand-"));
  roots.push(root);
  return root;
}

describe("Aiscoo native display and legacy identities", () => {
  it.each([
    { legacy: desktopDevelopmentKeychainName, display: "Aiscoo Dev" },
    { legacy: desktopProductIdentities.production.macKeychainName, display: "Aiscoo" },
    { legacy: desktopProductIdentities.preview.macKeychainName, display: "Aiscoo Preview" },
  ])(
    "keeps existing macOS ciphertext readable when displaying $display",
    async ({ legacy, display }) => {
      const source = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
      const early = source.match(/^app\.setName\([^\n]+\);/mu)?.[0];
      const ready = source.match(
        /app\.whenReady\(\)\.then\(async \(\) => \{\s*(?:\/\/[^\n]*\n\s*)*(app\.setName\([^\n]+\);)/u,
      )?.[1];
      expect(early).toBeDefined();
      expect(ready).toBeDefined();
      const keys = new Map<string, Buffer>();
      const keyFor = (name: string) => {
        let key = keys.get(name);
        if (!key) {
          key = randomBytes(32);
          keys.set(name, key);
        }
        return key;
      };
      const iv = randomBytes(12);
      const encrypt = createCipheriv("aes-256-gcm", keyFor(legacy), iv);
      const original = Buffer.concat([encrypt.update("existing-private-key"), encrypt.final()]);
      const tag = encrypt.getAuthTag();
      const app = {
        name: legacy,
        setName(name: string) {
          this.name = name;
        },
      };
      const context = {
        app,
        process: { platform: "darwin" },
        runtimeKeychainApplicationName: legacy,
        runtimeApplicationName: display,
      };
      // Electron 41 在 ready 前固定服务名；之后改展示名不能替换解密旧密文的钥匙串。
      runInNewContext(early!, context);
      const configuredKey = keyFor(app.name);
      runInNewContext(ready!, context);
      expect(app.name).toBe(display);
      const decrypt = createDecipheriv("aes-256-gcm", configuredKey, iv);
      decrypt.setAuthTag(tag);
      expect(Buffer.concat([decrypt.update(original), decrypt.final()]).toString()).toBe(
        "existing-private-key",
      );
    },
  );

  it("loads the bundled identity outside the checkout without reading source-relative JSON", async () => {
    const root = await tempRoot();
    const outfile = join(root, "identity.mjs");
    await build({
      entryPoints: [new URL("../scripts/desktop-product-identity.mjs", import.meta.url).pathname],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      logLevel: "silent",
    });
    const source = await readFile(outfile, "utf8");
    expect(source).not.toContain("readFile");
    expect(source).not.toContain('new URL("../../shared/src');
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const m=await import('./identity.mjs'); process.stdout.write(JSON.stringify(m.resolveDesktopProductIdentity({ZCODE_ENV:'production'})));",
      ],
      { cwd: root },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      productName: "Aiscoo",
      windowsExecutableName: "XWork",
      appId: "dev.zcode.app",
    });
  });

  it("keeps the actual Windows executable names while macOS bundles use the product name", async () => {
    const require = createRequire(import.meta.url);
    const { AppInfo } = require("app-builder-lib/out/appInfo.js");
    vi.stubEnv("ZCODE_TARGET_OS", "win32");
    const { default: config } = await import("../electron-builder.config.js");
    for (const [flavor, identity] of Object.entries(desktopProductIdentities)) {
      const info = {
        metadata: { name: "@zcode/desktop", version: "1.2.3" },
        config: { productName: identity.productName },
      };
      const windows = new AppInfo(info, undefined, {
        ...config.win,
        executableName: identity.windowsExecutableName,
      });
      const mac = new AppInfo(info, undefined, config.mac);
      expect(windows.productName).toBe(flavor === "preview" ? "Aiscoo Preview" : "Aiscoo");
      expect(windows.productFilename).toBe(flavor === "preview" ? "XWork Preview" : "XWork");
      expect(mac.productFilename).toBe(identity.productName);
      expect(identity.appId).toBe(flavor === "preview" ? "dev.zcode.app.preview" : "dev.zcode.app");
      expect(identity.linuxExecutableName).toBe(flavor === "preview" ? "zcode-preview" : "zcode");
    }
    expect(config.win.executableName).toMatch(/^XWork(?: Preview)?$/);
    expect(config.extraMetadata.description).toBe("Aiscoo Desktop App");
    expect(config.extraMetadata.author.name).toBe("Aiscoo");
  });

  it("migrates only owned legacy Finder workflows and leaves unrelated services intact", async () => {
    const homeDir = await tempRoot();
    const servicesDir = join(homeDir, "Library", "Services");
    for (const [name, bundleId] of [
      ["Open in XWork.workflow", "dev.zcode.app.finder-open-workflow"],
      ["Open in ZCode.workflow", "dev.zcode.app.finder-open-workflow"],
      ["Open in XCode.workflow", "user.custom.workflow"],
    ]) {
      const contents = join(servicesDir, name, "Contents");
      await mkdir(contents, { recursive: true });
      await writeFile(
        join(contents, "Info.plist"),
        `<plist><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`,
      );
    }
    const refresh = vi.fn();
    const options = {
      platform: "darwin" as const,
      locale: "en-US" as const,
      homeDir,
      logger: { info() {}, warn() {} },
      refreshServicesIndex: refresh,
    };
    installFinderOpenFolderWorkflow(options);
    const current = await readFile(
      join(servicesDir, "Open in Aiscoo.workflow", "Contents", "Info.plist"),
      "utf8",
    );
    expect(current).toContain("Open in Aiscoo");
    expect(current).toContain("dev.zcode.app.finder-open-workflow");
    await expect(
      readFile(join(servicesDir, "Open in XWork.workflow", "Contents", "Info.plist")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(servicesDir, "Open in ZCode.workflow", "Contents", "Info.plist")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await readFile(join(servicesDir, "Open in XCode.workflow", "Contents", "Info.plist"), "utf8"),
    ).toContain("user.custom.workflow");
    installFinderOpenFolderWorkflow(options);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(["XWork", "XCode", "ZCode", "Aiscoo"])(
    "recognizes %s Linux ownership without rewriting executable paths",
    async (legacy) => {
      const root = await tempRoot();
      const homeDir = join(root, "home");
      const applications = join(root, "data", "applications");
      const system = join(root, "system");
      await mkdir(applications, { recursive: true });
      await mkdir(system, { recursive: true });
      await writeFile(
        join(applications, "zcode.desktop"),
        `[Desktop Entry]\nComment=${legacy} Desktop App\n`,
      );
      await writeFile(join(system, "zcode.desktop"), "[Desktop Entry]\nName=system\n");
      registerLinuxDeepLinkProtocol({
        executablePath: "/opt/XWork/zcode",
        homeDir,
        env: { XDG_DATA_HOME: join(root, "data") },
        systemApplicationDirs: [system],
        logger: { info() {}, warn() {} },
        runCommand: () => ({ status: 0, signal: null, error: undefined, stdout: "", stderr: "" }),
      });
      await expect(readFile(join(applications, "zcode.desktop"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const entry = createLinuxDeepLinkDesktopEntry({ executablePath: "/opt/XWork/zcode" });
      expect(entry).toContain("Name=Aiscoo");
      expect(entry).toContain("Comment=Aiscoo Desktop App");
      expect(entry).toContain('Exec="/opt/XWork/zcode" %U');
      expect(entry).toContain("MimeType=x-scheme-handler/zcode;");
    },
  );

  it("uses brand copy for Windows menus, operation indicator and Helper display", () => {
    expect(getWindowsOpenFolderMenuName("en-US")).toBe("Open in Aiscoo");
    expect(getWindowsOpenFolderMenuName("zh-CN")).toBe("在Aiscoo中打开");
    const operations = buildWindowsOpenFolderRegistryOperations({
      executablePath: "C:\\XWork\\XWork.exe",
      locale: "en-US",
    });
    expect(operations[0].args[1]).toContain("ZCode.OpenInZCode");
    expect(operations.at(-1)?.args.join(" ")).toContain("C:\\XWork\\XWork.exe");
    expect(indicatorCopy("en-US").text).toBe("Aiscoo is controlling your computer");
    expect(HELPER_APP_NAME).toBe("Aiscoo Computer Use.app");
    expect(HELPER_DISPLAY_NAME).toBe("Aiscoo Computer Use");
    expect(resolveCuaPermissionPanelMessages("en-US", "accessibility").documentTitle).toBe(
      "Aiscoo Computer Use Permissions",
    );
    expect(resolveCuaPermissionPanelMessages("zh-CN", "screen_recording").documentTitle).toBe(
      "Aiscoo Computer Use 权限",
    );
    expect(HELPER_BUNDLE_ID).toBe("dev.zcode.cua-helper");
    expect(DEV_CUA_HELPER_BUNDLE_ID).toBe("dev.zcode.cua-helper.dev");
  });
});
