// Isolated real-component regression: no application main process, protocol registration,
// account credentials, external OAuth or user profile is used.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const requireRoot = createRequire(new URL("../../../package.json", import.meta.url));
const requireDesktop = createRequire(new URL("../package.json", import.meta.url));
const requireServices = createRequire(new URL("../../services/package.json", import.meta.url));
const { build } = requireServices("esbuild");
const { chromium, _electron: electron } = requireDesktop("playwright-core");
const { createServer } = await import(requireDesktop.resolve("vite"));
const { default: tailwindcss } = await import(requireDesktop.resolve("@tailwindcss/vite"));
const temporary = await mkdtemp(join(tmpdir(), "aiscoo-login-ui-"));
const evidence = resolve(root, "packages/desktop/out/aiscoo-login-brand");
let server;
let browser;
let electronApp;

try {
  const renderer = await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import { ServiceProvider } from "./packages/ui/src/hooks/useServices.tsx";
import { PlatformProvider } from "./packages/ui/src/hooks/usePlatform.tsx";
import { StoreProvider } from "./packages/ui/src/store/StoreProvider.tsx";
import { AiscooIntlProvider, AiscooLoginHeader } from "./packages/ui/src/xwork/brand/index.ts";
import { ZCodeIntlProvider } from "./packages/ui/src/i18n/IntlProvider.tsx";
import { WelcomeScreen } from "./packages/ui/src/WelcomeScreen.tsx";
import { createAiscooAccountLoginServices, createAiscooAccountLoginPlatform } from "./packages/ui/src/aiscoo/account-login/index.ts";
import { applyTheme } from "./packages/ui/src/useTheme.ts";
const params = new URLSearchParams(location.search);
const locale = params.get("locale") || "zh-CN";
const theme = params.get("theme") || "zai-light";
const upstream = params.get("upstream") === "1";
const providerMode = params.get("providers") || "native";
const events = [];
let fail = false;
window.loginFixture = { events, failNext: () => { fail = true; } };
localStorage.setItem("zcode-theme", theme);
applyTheme(theme);
const oauthService = {
  getProviders: async () => {
    const official = [{ id: "zai", displayName: "Z.ai", enabled: true, order: 0 }, { id: "bigmodel", displayName: "BigModel", enabled: true, order: 1 }];
    const native = { id: "new-api", displayName: "New API", enabled: true, order: 2 };
    return providerMode === "empty" ? [] : providerMode === "official" ? official : providerMode === "mixed" ? [...official, native] : providerMode === "disabled" ? [{ ...native, enabled: false }] : [native];
  },
  getActiveProvider: async () => null,
  startOAuth: async (provider) => {
    events.push(["start", provider]);
    if (fail) { fail = false; throw new Error("synthetic failure"); }
    return { authorizeUrl: "https://example.invalid/synthetic", state: "synthetic", provider, purpose: "primary-account" };
  },
  cancelPending: async (provider) => { events.push(["cancel", provider]); },
};
const services = { oauthService, providerSettingsService: {}, modelSelectionService: {}, settingService: {} };
const broadcastService = { send: async () => {}, onMessage: () => ({ dispose() {} }) };
const platform = {
  executeDesktopCommand: async () => {},
  registerOAuthState: () => {},
  openExternal: () => { events.push(["open-synthetic"]); },
};
const Intl = upstream ? ZCodeIntlProvider : AiscooIntlProvider;
createRoot(document.getElementById("root")).render(
  <ServiceProvider services={upstream ? services : createAiscooAccountLoginServices(services)}><PlatformProvider platform={upstream ? platform : createAiscooAccountLoginPlatform(platform)}>
    <StoreProvider broadcastService={broadcastService}><Intl initialLocale={locale}>
      <WelcomeScreen onComplete={() => events.push(["complete"])}
        {...(upstream ? {} : { header: <AiscooLoginHeader />, hideApiKeyLogin: true })} />
    </Intl></StoreProvider>
  </PlatformProvider></ServiceProvider>
);
`,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    tsconfig: resolve(root, "packages/ui/tsconfig.json"),
    alias: {
      "@": resolve(root, "packages/ui/src"),
      react: dirname(requireRoot.resolve("react/package.json")),
      "react-dom": dirname(requireRoot.resolve("react-dom/package.json")),
    },
    loader: { ".svg": "dataurl", ".png": "dataurl", ".css": "empty" },
    define: { "process.env.NODE_ENV": JSON.stringify("test"), "import.meta.env": "{}" },
  });
  await writeFile(join(temporary, "renderer.js"), renderer.outputFiles[0].text);
  await writeFile(
    join(temporary, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="/@fs${root}/packages/ui/src/styles.css"><link rel="stylesheet" href="/@fs${root}/packages/ui/src/xwork/brand/brand.css"></head><body><div id="root"></div><script type="module" src="/renderer.js"></script></body></html>`,
  );
  server = await createServer({
    configFile: false,
    root: temporary,
    plugins: [tailwindcss()],
    server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary] } },
  });
  await server.listen();
  await mkdir(evidence, { recursive: true });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const blockOutside = (route) =>
    route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort();

  async function checkPage(page, { locale, theme, width, engine }) {
    const productLogin = locale === "zh-CN" ? "登录" : "Sign in";
    const apiKey = locale === "zh-CN" ? "使用 API key" : "Use API key";
    const cancel = locale === "zh-CN" ? "取消" : "Cancel";
    const retry = locale === "zh-CN" ? "重新登录" : "Retry login";
    const errors = [];
    const onError = (error) => errors.push(error.message);
    const onResponse = (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    };
    page.on("pageerror", onError);
    page.on("response", onResponse);
    await page.goto(`${origin}/?locale=${locale}&theme=${theme}`, { waitUntil: "networkidle" });
    const button = page.getByRole("button", { name: productLogin, exact: true });
    try {
      await button.waitFor({ timeout: 10000 });
    } catch (error) {
      throw new Error(
        `登录夹具未渲染: ${JSON.stringify({ locale, theme, width, errors, text: await page.locator("body").innerText() })}`,
        { cause: error },
      );
    } finally {
      page.off("pageerror", onError);
      page.off("response", onResponse);
    }
    assert.equal(await page.getByRole("button", { name: apiKey, exact: true }).count(), 0);
    assert.equal(await page.getByText(/New API/).count(), 0);
    const logo = page.getByRole("img", { name: "Aiscoo" });
    assert.equal(await logo.count(), 1);
    const animatedLogo = logo.locator('[data-aiscoo-brand="wordmark-animated"]');
    assert.equal(await animatedLogo.isVisible(), true);
    assert.equal(
      await page.evaluate(() =>
        Boolean(
          getComputedStyle(document.documentElement).getPropertyValue("--color-background").trim(),
        ),
      ),
      true,
      "application stylesheet must be loaded",
    );
    const tone = await animatedLogo.evaluate((element) => ({
      light: getComputedStyle(element.querySelector(".aiscoo-brand-tone-light")).display,
      dark: getComputedStyle(element.querySelector(".aiscoo-brand-tone-dark")).display,
    }));
    assert.deepEqual(
      tone,
      theme === "zai-dark" ? { light: "none", dark: "block" } : { light: "block", dark: "none" },
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const buttonBox = await button.boundingBox();
    assert.ok(buttonBox && buttonBox.x >= 0 && buttonBox.x + buttonBox.width <= width + 1);
    if ((width === 390 && engine === "chrome") || engine === "electron") {
      await page.screenshot({ path: join(evidence, `${engine}-${width}-${locale}-${theme}.png`) });
    }
    await button.click();
    await page.getByRole("button", { name: cancel, exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.loginFixture.events.filter((e) => e[0] === "cancel")),
      [["cancel", "new-api"]],
    );
    await page.evaluate(() => window.loginFixture.failNext());
    await button.click();
    await page.getByRole("button", { name: retry, exact: true }).click();
    await page.getByRole("button", { name: cancel, exact: true }).waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.loginFixture.events.filter((e) => e[0] === "start")),
      [
        ["start", "new-api"],
        ["start", "new-api"],
        ["start", "new-api"],
      ],
    );
    assert.equal(
      await page.evaluate(() => window.loginFixture.events.some((e) => e[0] === "complete")),
      false,
    );
  }

  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const width of [320, 390, 1280]) {
    for (const locale of ["zh-CN", "en-US"]) {
      for (const theme of ["zai-light", "zai-dark"]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, locale });
        await context.route("**/*", blockOutside);
        try {
          await checkPage(await context.newPage(), { locale, theme, width, engine: "chrome" });
        } finally {
          await context.close();
        }
      }
    }
  }
  for (const providerMode of ["empty", "official", "mixed", "disabled"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route("**/*", blockOutside);
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/?locale=zh-CN&providers=${providerMode}`, {
        waitUntil: "networkidle",
      });
      assert.equal(await page.getByRole("button", { name: /Z\.ai|BigModel/u }).count(), 0);
      if (providerMode === "mixed") {
        await page.getByRole("button", { name: "登录", exact: true }).click();
        await page.getByRole("button", { name: "取消", exact: true }).waitFor();
        assert.deepEqual(
          await page.evaluate(() =>
            window.loginFixture.events.filter((event) => event[0] === "start"),
          ),
          [["start", "new-api"]],
        );
      } else {
        assert.equal(await page.getByRole("button", { name: "登录", exact: true }).count(), 0);
        const error = page.getByTestId("oauth-error");
        await error.waitFor();
        assert.match(await error.innerText(), /Aiscoo/u);
        assert.doesNotMatch(await error.innerText(), /https?:|example\.|New API/u);
        assert.deepEqual(await page.evaluate(() => window.loginFixture.events), []);
      }
    } finally {
      await context.close();
    }
  }
  const defaultContext = await browser.newContext();
  await defaultContext.route("**/*", blockOutside);
  try {
    const page = await defaultContext.newPage();
    await page.goto(`${origin}/?locale=zh-CN&upstream=1`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "登录 New API", exact: true }).waitFor();
    await page.getByRole("button", { name: "使用 API key", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "API Key", exact: true }).count(), 1);
  } finally {
    await defaultContext.close();
  }

  const profile = join(temporary, "electron-profile");
  await mkdir(profile);
  const electronMain = join(temporary, "main.cjs");
  await writeFile(
    electronMain,
    `
const { app, BrowserWindow } = require("electron");
app.setPath("userData", ${JSON.stringify(profile)});
app.setPath("sessionData", ${JSON.stringify(profile)});
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1280, height: 844, show: false });
  window.loadURL(${JSON.stringify(origin)});
});
`,
  );
  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  electronApp = await electron.launch({
    executablePath: requireDesktop("electron"),
    args: [electronMain],
    env: electronEnv,
  });
  const electronPage = await electronApp.firstWindow();
  await electronPage.context().route("**/*", blockOutside);
  await checkPage(electronPage, {
    locale: "zh-CN",
    theme: "zai-light",
    width: 1280,
    engine: "electron",
  });
  await checkPage(electronPage, {
    locale: "en-US",
    theme: "zai-dark",
    width: 1280,
    engine: "electron",
  });
  console.log(
    "PASS: 12 Chrome viewport/theme/locale cases, 4 provider admission cases, upstream API key form, 2 isolated Electron cases; synthetic OAuth only",
  );
} finally {
  await electronApp?.close();
  await browser?.close();
  await server?.close();
  await rm(temporary, { recursive: true, force: true });
}
