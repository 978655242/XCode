import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const requireDesktop = createRequire(
  new URL("../../packages/desktop/package.json", import.meta.url),
);
const { build } = requireDesktop("esbuild");
const { getAiscooDesktopIdentity } =
  await import("../../packages/shared/src/aiscoo-desktop-identity/runtime.js");
const tempRoot = await mkdtemp(join(tmpdir(), "aiscoo-deep-link-identity-"));
after(() => rm(tempRoot, { recursive: true, force: true }));
const logger = { info() {}, warn() {} };
const channels = ["production", "development", "preview"];
const modules = new Map();

async function loadMain(channel) {
  const key = channel ?? "upstream";
  if (modules.has(key)) return modules.get(key);
  const outfile = join(tempRoot, `${key}.mjs`);
  await build({
    stdin: {
      contents: [
        'export * from "./desktopDeepLinkUrl.ts";',
        'export * from "./desktopFinderOpenFolderWorkflow.ts";',
        'export * from "./desktopLinuxDeepLinkRegistration.ts";',
      ].join("\n"),
      resolveDir: join(root, "packages/desktop/src/main"),
      sourcefile: "aiscoo-native-identity-fixture.ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    define: channel ? { __AISCOO_DESKTOP_CHANNEL__: JSON.stringify(channel) } : {},
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  modules.set(key, module);
  return module;
}

for (const channel of [null, ...channels]) {
  test(`${channel ?? "upstream"} extracts only its scheme across argv and single-instance delivery`, async () => {
    const main = await loadMain(channel);
    const scheme = channel ? getAiscooDesktopIdentity(channel).scheme : "zcode";
    const callback = `${scheme}://oauth/callback?provider=new-api&state=${"s".repeat(32)}&code=${"c".repeat(43)}`;
    assert.equal(main.extractDeepLinkUrlFromArgs(["app", callback]), callback);
    assert.equal(
      main.extractDeepLinkUrlFromArgs([encodeURIComponent(encodeURIComponent(callback))]),
      callback,
    );
    const [prefix, state] = callback.split("&state=");
    assert.equal(main.extractDeepLinkUrlFromArgs([`${prefix}&sta`, `te=${state}`]), callback);
    const data = main.createDeepLinkSingleInstanceData([
      callback,
      "--open-workspace",
      "/tmp/example",
    ]);
    assert.equal(main.extractDeepLinkUrlFromSingleInstanceData(data), callback);
    assert.equal(main.extractOpenWorkspacePathFromSingleInstanceData(data), "/tmp/example");
    assert.equal(main.isOAuthCallbackUrl(new URL(callback)), true);
    assert.equal(
      main.isPaymentCallbackUrl(
        new URL(`${scheme}://payment/callback?provider=p&channel=c&status=ok`),
      ),
      true,
    );
    assert.equal(
      main.extractWorkspaceOpenPath(new URL(`${scheme}://workspace/open?path=%2Ftmp%2Fexample`)),
      "/tmp/example",
    );
    assert.equal(
      main.extractShareImportCode(new URL(`${scheme}://share/import?code=safe-code`)),
      "safe-code",
    );
    assert.equal(
      main.extractShareImportCode(new URL(`${scheme}://share/import?code=bad%20code`)),
      null,
    );
    assert.equal(main.isOAuthCallbackUrl(new URL(`${scheme}:/oauth/callback`)), true);
    for (const other of ["zcode", "aiscoo", "aiscoo-dev", "aiscoo-preview"]) {
      if (other === scheme) continue;
      assert.equal(
        main.extractDeepLinkUrlFromArgs([callback.replace(`${scheme}:`, `${other}:`)]),
        null,
      );
      assert.equal(main.isPaymentCallbackUrl(new URL(`${other}://payment/callback`)), false);
      assert.equal(
        main.extractWorkspaceOpenPath(new URL(`${other}://workspace/open?path=%2Ftmp`)),
        null,
      );
      assert.equal(main.extractShareImportCode(new URL(`${other}://share/import?code=safe`)), null);
    }
  });
}

for (const channel of channels) {
  test(`${channel} Finder service preserves every legacy and other-channel workflow`, async () => {
    const main = await loadMain(channel);
    const profile = getAiscooDesktopIdentity(channel);
    const homeDir = join(tempRoot, `finder-${channel}`);
    const servicesDir = join(homeDir, "Library", "Services");
    const preserved = [];
    for (const [name, bundleId] of [
      ["Open in ZCode.workflow", "dev.zcode.app.finder-open-workflow"],
      ["Open in XWork.workflow", "dev.zcode.app.finder-open-workflow"],
      ["Open in XCode.workflow", "dev.zcode.app.finder-open-workflow"],
      ...channels
        .filter((item) => item !== channel)
        .map((item) => {
          const identity = getAiscooDesktopIdentity(item);
          return [
            `Open in ${identity.productName}.workflow`,
            `${identity.appId}.finder-open-workflow`,
          ];
        }),
    ]) {
      const path = join(servicesDir, name, "Contents", "Info.plist");
      const content = `<plist><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`;
      await mkdir(join(servicesDir, name, "Contents"), { recursive: true });
      await writeFile(path, content);
      preserved.push([path, content]);
    }
    let refreshed = 0;
    const options = {
      platform: "darwin",
      locale: "en-US",
      homeDir,
      logger,
      refreshServicesIndex: () => refreshed++,
    };
    main.installFinderOpenFolderWorkflow(options);
    const contents = join(servicesDir, `Open in ${profile.productName}.workflow`, "Contents");
    assert.match(
      await readFile(join(contents, "Info.plist"), "utf8"),
      new RegExp(`${profile.appId.replaceAll(".", "\\.")}.finder-open-workflow`),
    );
    const workflow = await readFile(join(contents, "document.wflow"), "utf8");
    assert.ok(workflow.includes(`${profile.scheme}://workspace/open?path=`));
    assert.equal(await readFile(join(contents, "Resources", "document.wflow"), "utf8"), workflow);
    for (const [path, content] of preserved) assert.equal(await readFile(path, "utf8"), content);
    main.installFinderOpenFolderWorkflow(options);
    assert.equal(refreshed, 1);
    main.installFinderOpenFolderWorkflow({ ...options, locale: "zh-CN" });
    assert.ok(
      (await readFile(join(contents, "Info.plist"), "utf8")).includes(
        `在${profile.productName}中打开`,
      ),
    );
    assert.equal(refreshed, 2);
  });

  test(`${channel} Linux registration and AppImage icon leave ZCode and sibling channels intact`, async () => {
    const main = await loadMain(channel);
    const profile = getAiscooDesktopIdentity(channel);
    const dir = join(tempRoot, `linux-${channel}`);
    const dataDir = join(dir, "data");
    const applications = join(dataDir, "applications");
    const icons = join(dataDir, "icons", "hicolor", "512x512", "apps");
    const system = join(dir, "system");
    await mkdir(applications, { recursive: true });
    await mkdir(icons, { recursive: true });
    await mkdir(system, { recursive: true });
    const preserved = [];
    for (const name of [
      "zcode",
      ...channels
        .filter((item) => item !== channel)
        .map((item) => getAiscooDesktopIdentity(item).linuxExecutableName),
    ]) {
      for (const [path, content] of [
        [
          join(applications, `${name}.desktop`),
          `[Desktop Entry]\nComment=ZCode Desktop App\nName=${name}\n`,
        ],
        [join(icons, `${name}.png`), `original-${name}`],
      ]) {
        await writeFile(path, content);
        preserved.push([path, content]);
      }
    }
    await writeFile(join(system, "zcode.desktop"), "[Desktop Entry]\nName=system ZCode\n");
    const iconSourcePath = join(dir, "source.png");
    await writeFile(iconSourcePath, "aiscoo-icon");
    const commands = [];
    const options = {
      executablePath: `/opt/${profile.productName}/${profile.linuxExecutableName}`,
      homeDir: join(dir, "home"),
      env: { XDG_DATA_HOME: dataDir, APPIMAGE: `/tmp/${profile.productName}.AppImage` },
      argv: ["app", "--no-sandbox", "--remote-debugging-port=9222"],
      iconSourcePath,
      systemApplicationDirs: [system],
      logger,
      runCommand(command, args) {
        commands.push([command, args]);
        return { status: 0 };
      },
    };
    main.registerLinuxDeepLinkProtocol(options);
    const desktopPath = join(applications, profile.desktopFileName);
    const entry = await readFile(desktopPath, "utf8");
    assert.ok(entry.includes(`Name=${profile.productName}\n`));
    assert.ok(entry.includes(`X-Aiscoo-AppId=${profile.appId}\n`));
    assert.ok(entry.includes(`MimeType=x-scheme-handler/${profile.scheme};`));
    assert.ok(entry.includes(`Icon=${profile.linuxExecutableName}\n`));
    assert.ok(entry.includes(`Exec="${options.env.APPIMAGE}" "--no-sandbox" %U`));
    assert.ok(!entry.includes("remote-debugging"));
    assert.equal(
      await readFile(join(icons, `${profile.linuxExecutableName}.png`), "utf8"),
      "aiscoo-icon",
    );
    assert.ok(
      commands.some(
        ([command, args]) =>
          command === "xdg-mime" &&
          JSON.stringify(args) ===
            JSON.stringify([
              "default",
              profile.desktopFileName,
              `x-scheme-handler/${profile.scheme}`,
            ]),
      ),
    );
    assert.ok(
      !commands.some(
        ([, args]) => args.includes("zcode.desktop") || args.includes("x-scheme-handler/zcode"),
      ),
    );
    for (const [path, content] of preserved) assert.equal(await readFile(path, "utf8"), content);

    await writeFile(join(system, profile.desktopFileName), "[Desktop Entry]\nName=system Aiscoo\n");
    main.registerLinuxDeepLinkProtocol(options);
    await assert.rejects(readFile(desktopPath), { code: "ENOENT" });
    const unowned = `[Desktop Entry]\nComment=Aiscoo Desktop App\nX-Aiscoo-AppId=dev.aiscoo.app.unrelated\n`;
    await writeFile(desktopPath, unowned);
    main.registerLinuxDeepLinkProtocol(options);
    assert.equal(await readFile(desktopPath, "utf8"), unowned);
    for (const [path, content] of preserved) assert.equal(await readFile(path, "utf8"), content);
  });
}

test("unconfigured Finder and Linux retain upstream legacy cleanup and scheme", async () => {
  const main = await loadMain(null);
  const dir = join(tempRoot, "upstream-cleanup");
  const homeDir = join(dir, "home");
  const legacyContents = join(homeDir, "Library", "Services", "Open in ZCode.workflow", "Contents");
  await mkdir(legacyContents, { recursive: true });
  await writeFile(
    join(legacyContents, "Info.plist"),
    "<key>CFBundleIdentifier</key><string>dev.zcode.app.finder-open-workflow</string>",
  );
  main.installFinderOpenFolderWorkflow({
    platform: "darwin",
    locale: "en-US",
    homeDir,
    logger,
    refreshServicesIndex() {},
  });
  await assert.rejects(readFile(join(legacyContents, "Info.plist")), { code: "ENOENT" });
  const contents = join(homeDir, "Library", "Services", "Open in Aiscoo.workflow", "Contents");
  assert.ok(
    (await readFile(join(contents, "Info.plist"), "utf8")).includes(
      "dev.zcode.app.finder-open-workflow",
    ),
  );
  assert.ok(
    (await readFile(join(contents, "document.wflow"), "utf8")).includes("zcode://workspace/open"),
  );
  const dataDir = join(dir, "data");
  const applications = join(dataDir, "applications");
  const system = join(dir, "system");
  await mkdir(applications, { recursive: true });
  await mkdir(system, { recursive: true });
  await writeFile(
    join(applications, "zcode.desktop"),
    "[Desktop Entry]\nComment=ZCode Desktop App\n",
  );
  await writeFile(join(system, "zcode.desktop"), "[Desktop Entry]\nName=ZCode\n");
  const commands = [];
  main.registerLinuxDeepLinkProtocol({
    executablePath: "/opt/zcode/zcode",
    homeDir,
    env: { XDG_DATA_HOME: dataDir },
    systemApplicationDirs: [system],
    logger,
    runCommand(command, args) {
      commands.push([command, args]);
      return { status: 0 };
    },
  });
  await assert.rejects(readFile(join(applications, "zcode.desktop")), { code: "ENOENT" });
  assert.ok(
    commands.some(
      ([command, args]) =>
        command === "xdg-mime" &&
        args.includes("zcode.desktop") &&
        args.includes("x-scheme-handler/zcode"),
    ),
  );
});
