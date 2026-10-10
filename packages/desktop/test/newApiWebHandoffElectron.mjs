import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, WebContentsView, webContents } from "electron";
import { build } from "esbuild";
import { assertOrdinaryPlanIsolation } from "./newApiOrdinaryGuestAssertions.mjs";

import {
  setNativePlanWebviewOwner,
  authorizeNativePlanWebHandoff,
  registerNativePlanWebviewIpc,
  attachNativePlanWebview,
  canAttachNativePlanWebview,
} from "../src/main/nativePlanWebviewManager.ts";
import { createBrowserWindow } from "../src/main/desktopWindowChrome.ts";
process.env.VITE_ZCODE_E2E_STORE_BRIDGE = "1";

// XCODE: Main ESM 在模块求值结束后才触发 ready，异步 smoke 不阻塞入口模块。
async function run() {
  const dataDirectory = await mkdtemp(join(tmpdir(), "xcode-handoff-electron-"));
  app.setPath("userData", dataDirectory);
  let cssRequests = 0;
  let foreignRequests = 0;
  let privateRequests = 0;
  const foreign = createServer((_request, response) => {
    foreignRequests++;
    response.end("foreign");
  });
  const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const originFor = (server) => {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return `http://127.0.0.1:${address.port}`;
  };
  await listen(foreign);
  const foreignOrigin = originFor(foreign);
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/xcode/plans" && url.searchParams.has("handoff")) {
      privateRequests++;
      response.writeHead(303, {
        Location: "/xcode/plans",
        "Set-Cookie": "xcode_plan=readonly; HttpOnly; SameSite=Strict; Path=/api/xcode/v1/web",
      });
      response.end();
    } else if (url.pathname === "/xcode/plans") {
      privateRequests++;
      response.setHeader("Content-Type", "text/html");
      response.end(
        `<html><head><link rel="stylesheet" href="/assets/plan.css"></head><body>Assigned plan<img src="${foreignOrigin}/collect?handoff=short-code"></body></html>`,
      );
    } else if (url.pathname === "/api/xcode/v1/web/view") {
      privateRequests++;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ plan: "Assigned plan" }));
    } else if (url.pathname === "/assets/plan.css") {
      cssRequests++;
      response.setHeader("Content-Type", "text/css");
      response.end("body { color: rgb(1, 2, 3); }");
    } else if (url.pathname === "/redirect-private") {
      response.writeHead(302, { Location: "/xcode/plans?handoff=ordinary-redirect" });
      response.end();
    } else if (["/", "/custom", "/coding-plan"].includes(url.pathname)) {
      response.setHeader("Content-Type", "text/html");
      response.end("<html><body>Ordinary browsing</body></html>");
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  server.on("upgrade", (request, socket) => {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (path === "/xcode/plans" || path.startsWith("/api/xcode/v1/web/")) privateRequests++;
    socket.end(
      "HTTP/1.1 303 See Other\r\nLocation: /xcode/plans\r\nSet-Cookie: xcode_plan=readonly; HttpOnly; SameSite=Strict; Path=/api/xcode/v1/web\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  await listen(server);
  const origin = originFor(server);
  const deadline = setTimeout(() => {
    console.error("Native handoff Electron regression timed out");
    app.exit(1);
  }, 40_000);
  let win;
  let ordinaryWindow;
  let exitCode = 0;
  try {
    await app.whenReady();
    registerNativePlanWebviewIpc();
    process.env.ELECTRON_RENDERER_URL = origin;
    process.env.ZCODE_ENDPOINT_ORIGIN = origin;
    ordinaryWindow = createBrowserWindow({
      iconPath: "",
      preloadPath: fileURLToPath(
        new URL("./newApiWebHandoffElectron.preload.cjs", import.meta.url),
      ),
      logger: console,
    });
    // XCODE: 源码 Main 没有产物 .cjs；只为真实官方 preload 编译临时产物，不替换其 bridge 行为。
    const officialPreloadPath = join(dataDirectory, "official-plan-preload.cjs");
    const officialPreload = await build({
      entryPoints: [fileURLToPath(new URL("../src/preload/codingPlanWebview.ts", import.meta.url))],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      define: {
        "process.env": JSON.stringify({
          ZCODE_ENDPOINT_ORIGIN: origin,
          VITE_ZCODE_E2E_STORE_BRIDGE: "1",
        }),
      },
    });
    await writeFile(officialPreloadPath, officialPreload.outputFiles[0].text);
    ordinaryWindow.webContents.on("will-attach-webview", (_event, preferences) => {
      if (
        preferences.preload ===
        fileURLToPath(new URL("../out/preload/codingPlanWebview.cjs", import.meta.url))
      )
        preferences.preload = officialPreloadPath;
    });
    ordinaryWindow.hide();
    if (ordinaryWindow.webContents.isLoading())
      await new Promise((resolve) => ordinaryWindow.webContents.once("did-finish-load", resolve));
    const beforeHostFetch = privateRequests;
    const hostFetchRejected = await ordinaryWindow.webContents.executeJavaScript(
      `fetch(${JSON.stringify(`${origin}/xcode/plans?handoff=host-default`)}).then(() => false, () => true)`,
    );
    const hostCookieCount = (
      await ordinaryWindow.webContents.session.cookies.get({
        url: `${origin}/api/xcode/v1/web/view`,
      })
    ).length;
    assert.deepEqual(
      {
        rejected: hostFetchRejected,
        privateRequests: privateRequests - beforeHostFetch,
        cookieCount: hostCookieCount,
      },
      { rejected: true, privateRequests: 0, cookieCount: 0 },
      "host/default Session must not redeem a private ticket before any guest exists",
    );
    const createWebviewGuest = async (partition, src = "about:blank") => {
      const id = await ordinaryWindow.webContents
        .executeJavaScript(`new Promise((resolve, reject) => {
      const view = document.createElement('webview');
      view.style.cssText = 'width:500px;height:300px';
      if (${JSON.stringify(partition)}) view.setAttribute('partition', ${JSON.stringify(partition)});
      view.src = ${JSON.stringify(src)};
      view.addEventListener('did-finish-load', () => resolve(view.getWebContentsId()), { once: true });
      view.addEventListener('did-fail-load', () => reject(new Error('webview guest failed')), { once: true });
      document.body.append(view);
    })`);
      return webContents.fromId(id);
    };
    await assertOrdinaryPlanIsolation(
      ordinaryWindow,
      origin,
      createWebviewGuest,
      () => privateRequests,
    );

    const nativeRequest = {
      url: `${origin}/xcode/plans?handoff=attached-native`,
      ownerGeneration: 10,
    };
    await setNativePlanWebviewOwner(ordinaryWindow.id, { origin, ownerGeneration: 10 });
    assert.equal(authorizeNativePlanWebHandoff(ordinaryWindow.id, nativeRequest), true);
    const nativePrepared = await ordinaryWindow.webContents.executeJavaScript(
      `window.nativeHandoffTest.prepare(${JSON.stringify(nativeRequest)})`,
    );
    const nativeAttached = await createWebviewGuest(nativePrepared.partition, nativeRequest.url);
    assert.match(
      await nativeAttached.executeJavaScript("document.body.textContent"),
      /Assigned plan/,
    );
    assert.deepEqual(
      await nativeAttached.executeJavaScript(
        "[typeof window.zcodeBridge, typeof window.zcode, typeof require, typeof process]",
      ),
      ["undefined", "undefined", "undefined", "undefined"],
    );
    const attachedSession = nativeAttached.session;
    assert.ok(
      (await attachedSession.cookies.get({ url: `${origin}/api/xcode/v1/web/view` })).some(
        (cookie) => cookie.name === "xcode_plan",
      ),
    );
    assert.deepEqual(
      await nativeAttached.executeJavaScript(
        "fetch('/api/xcode/v1/web/view').then(response => response.json())",
      ),
      { plan: "Assigned plan" },
    );
    const beforeOtherTicket = privateRequests;
    assert.equal(
      await nativeAttached.executeJavaScript(
        "fetch('/xcode/plans?handoff=other-owner').then(() => false, () => true)",
      ),
      true,
    );
    assert.equal(
      await nativeAttached.executeJavaScript(
        "fetch('/xcode/%70lans?handoff=other-owner').then(() => false, () => true)",
      ),
      true,
    );
    assert.equal(
      privateRequests,
      beforeOtherTicket,
      "Native XHR cannot replace the current owner's Cookie with another ticket",
    );
    const rogueView = new WebContentsView({
      webPreferences: {
        partition: nativePrepared.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const beforeRogue = privateRequests;
    try {
      await assert.rejects(
        rogueView.webContents.loadURL(nativeRequest.url),
        "knowing an admitted partition must not admit an untracked guest",
      );
      assert.equal(privateRequests, beforeRogue);
    } finally {
      rogueView.webContents.close({ waitForBeforeUnload: false });
    }
    await setNativePlanWebviewOwner(ordinaryWindow.id, null);
    assert.equal(nativeAttached.isDestroyed(), true);
    assert.equal((await attachedSession.cookies.get({})).length, 0);

    win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: fileURLToPath(new URL("./newApiWebHandoffElectron.preload.cjs", import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await win.loadURL("data:text/html,<html><body>Isolated handoff harness</body></html>");
    const requestFor = (ownerGeneration) => ({
      url: `${origin}/xcode/plans?handoff=short-code-${ownerGeneration}`,
      ownerGeneration,
    });
    const prepare = (ownerGeneration) =>
      win.webContents.executeJavaScript(
        `window.nativeHandoffTest.prepare(${JSON.stringify(requestFor(ownerGeneration))})`,
      );
    await setNativePlanWebviewOwner(win.id, { origin, ownerGeneration: 1 });
    assert.equal(authorizeNativePlanWebHandoff(win.id, requestFor(1)), true);
    const a = await prepare(1);
    const guestView = new WebContentsView({
      webPreferences: {
        partition: a.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.contentView.addChildView(guestView);
    guestView.setBounds({ x: 0, y: 0, width: 500, height: 300 });
    const guest = guestView.webContents;
    const partitionSession = guest.session;
    attachNativePlanWebview(win.id, a.partition, requestFor(1).url, guest, console);
    await guest.loadURL(requestFor(1).url);
    assert.ok(cssRequests > 0, "the first same-origin stylesheet must load");
    assert.equal(
      await guest.executeJavaScript("getComputedStyle(document.body).color"),
      "rgb(1, 2, 3)",
    );
    assert.equal(foreignRequests, 0, "a foreign resource must not receive the short handoff");
    assert.ok(
      (await partitionSession.cookies.get({ url: `${origin}/api/xcode/v1/web/view` })).some(
        (cookie) => cookie.name === "xcode_plan" && cookie.httpOnly,
      ),
    );

    const clearStorage = partitionSession.clearStorageData.bind(partitionSession);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    // Delay the real Session cleanup; do not replace its result or storage behavior.
    partitionSession.clearStorageData = async (options) => {
      await gate;
      return clearStorage(options);
    };
    const oldCleanup = setNativePlanWebviewOwner(win.id, null);
    await setNativePlanWebviewOwner(win.id, { origin, ownerGeneration: 2 });
    release();
    await oldCleanup;
    partitionSession.clearStorageData = clearStorage;
    assert.equal(authorizeNativePlanWebHandoff(win.id, requestFor(2)), true);
    await assert.rejects(
      win.webContents.executeJavaScript(
        `window.nativeHandoffTest.prepare(${JSON.stringify({ ...requestFor(1), ownerGeneration: 2 })})`,
      ),
      /XCODE_STALE_WEB_HANDOFF/,
    );
    const b = await prepare(2);
    assert.ok(
      canAttachNativePlanWebview(win.id, b.partition, requestFor(2).url),
      "late A cleanup must not erase B's policy",
    );
    assert.notEqual(a.partition, b.partition);
    assert.equal(
      (await partitionSession.cookies.get({})).length,
      0,
      "A's real cookies must be cleared",
    );
    await assert.rejects(prepare(1), /XCODE_STALE_WEB_HANDOFF/);
    const officialUrl = `${origin}/coding-plan?embedded=app`;
    const officialGuest = await createWebviewGuest("persist:official-plan-regression", officialUrl);
    assert.equal(
      await officialGuest.executeJavaScript("typeof window.zcodeBridge?.notifyPurchaseComplete"),
      "function",
      "ordinary official purchasing must keep its actual completion bridge",
    );
    assert.match(
      await officialGuest.executeJavaScript("document.body.textContent"),
      /Ordinary browsing/,
    );
    console.log(
      JSON.stringify({
        ordinaryLateRequestsDenied: true,
        ordinaryInitialAttachDenied: true,
        unrelatedBrowsingUnaffected: true,
        sameOriginCss: true,
        foreignResourceDenied: true,
        nullToNewOwner: true,
        oldPartitionCookiesCleared: true,
        relabeledOldUrlDenied: true,
      }),
    );
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    clearTimeout(deadline);
    if (ordinaryWindow && !ordinaryWindow.isDestroyed()) {
      await setNativePlanWebviewOwner(ordinaryWindow.id, null);
    }
    if (win && !win.isDestroyed()) {
      await setNativePlanWebviewOwner(win.id, null);
    }
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => foreign.close(resolve)),
    ]);
    await rm(dataDirectory, { recursive: true, force: true });
    app.exit(exitCode);
  }
}
void run().catch((error) => {
  console.error("Native handoff bootstrap failed", error);
  app.exit(1);
});
