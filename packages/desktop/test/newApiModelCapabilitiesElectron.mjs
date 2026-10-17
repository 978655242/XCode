import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { build } from "esbuild";
import { createCapabilityHost } from "./newApiModelCapabilitiesHost.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const requireRoot = createRequire(new URL("../../../package.json", import.meta.url));
const requireDesktop = createRequire(new URL("../package.json", import.meta.url));
const nativeId = "account:new-api-openai-chat-completions";
const modelTrigger = '[data-testid="chat-model-select-trigger"]';
const thoughtTrigger = '[data-testid="chat-thought-level-select-trigger"]';
const thoughtItems = '[data-testid^="chat-thought-level-select-item-"]';

async function run() {
  const temporary = await mkdtemp(join(tmpdir(), "xwork-model-capabilities-electron-"));
  app.setPath("userData", join(temporary, "profile"));
  let win, vite, host;
  let exitCode = 0;
  let stage = "fixture setup";
  const deadline = setTimeout(() => app.exit(1), 90_000);
  try {
    host = await createCapabilityHost(ipcMain, () => win);
    await writeFile(
      join(temporary, "preload.cjs"),
      `const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("capabilityHost",{view:input=>ipcRenderer.invoke("capability-view",input),settings:()=>ipcRenderer.invoke("capability-settings"),metrics:()=>ipcRenderer.invoke("capability-metrics"),stage:values=>ipcRenderer.invoke("capability-stage",values),refresh:()=>ipcRenderer.invoke("capability-refresh"),onChange:listener=>{ipcRenderer.on("capability-changed",listener);return()=>ipcRenderer.removeListener("capability-changed",listener)}});`,
    );
    const renderer = await build({
      stdin: {
        resolveDir: root,
        loader: "tsx",
        contents: `
import React,{useState,useLayoutEffect} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {V4ComposerModelControls} from "./packages/ui/src/v4/composer/V4ComposerToolbar.tsx";
import {useDraftConfigControl} from "./packages/ui/src/v4/composer/useDraftConfigControl.ts";
import {createComposerSubmissionConfig} from "./packages/ui/src/v4/composer/composerSubmissionConfig.ts";
import {ZCodeIntlProvider} from "./packages/ui/src/i18n/IntlProvider.tsx";
import {ServiceProvider} from "./packages/ui/src/hooks/useServices.tsx";
import {PlatformProvider} from "./packages/ui/src/hooks/usePlatform.tsx";
import {StoreProvider,useZCodeStore} from "./packages/ui/src/store/StoreProvider.tsx";
import {TabStoreProvider} from "./packages/ui/src/store/TabStoreProvider.tsx";
import {TooltipProvider} from "./packages/ui/src/components/ui/tooltip.tsx";
import {Button} from "./packages/ui/src/components/ui/button.tsx";
import {ArrowUpIcon} from "lucide-react";
import {useComposerToolbarFit} from "./packages/ui/src/prompt-editor/useComposerToolbarFit.ts";
import {connectProviderSettingsSnapshot} from "./packages/ui/src/lib/providerSettingsSnapshot.ts";
import {applyTheme} from "./packages/ui/src/useTheme.ts";
const listeners=new Set();
const modelSelectionService={getView:input=>window.capabilityHost.view(input),refresh:()=>window.capabilityHost.refresh(),onDidChange:listener=>{listeners.add(listener);return{dispose:()=>listeners.delete(listener)}}};
window.capabilityHost.onChange(async()=>{const view=await modelSelectionService.getView();for(const listener of listeners)listener(view)});
const broadcast={onMessage:()=>({dispose(){}}),send:async()=>{}};
const services={settingService:{get:async()=>({})},broadcastService:broadcast,modelSelectionService,usageStatsService:{getEntitlementSnapshot:async()=>null},providerSettingsService:{getView:()=>window.capabilityHost.settings(),onDidChange:()=>({dispose(){}})}};
await connectProviderSettingsSnapshot(services.providerSettingsService).ready;
window.submissions=[];
function Scene(){
  const setUser=useZCodeStore(state=>state.setUser);
  const toolbarRef=useComposerToolbarFit();
  useLayoutEffect(()=>setUser({id:"fixture",nickname:"Fixture",provider:"new-api"}),[setUser]);
  const control=useDraftConfigControl({workspacePath:"/isolated-capability-fixture",sessionId:null,agentStartupAllowed:false,modelSelectionService});
  const read=control.modelSelectionRead;
  const view=read.state.status==="ready"?read.state.view:null;
  const [picker,setPicker]=useState(null);
  const submission=createComposerSubmissionConfig(control.draftConfig,view);
  window.state={stored:control.composerDraft.modelSelection,effective:control.draftConfig.modelSelection,status:read.state.status,issue:view?.selectionIssue,canSubmit:submission!==null,providers:view?.providers};
  window.restore=selection=>flushSync(()=>control.replaceComposerDraft({text:"synthetic input",mode:"build",planEnabled:false,modelSelection:selection}));
  window.peek=()=>modelSelectionService.getView({selection:control.composerDraft.modelSelection??null});
  return <section className="@container/composer rounded-2xl border bg-card p-3" id="composer-surface">
    <div className="min-h-16 text-ui-base text-foreground-subtle" contentEditable suppressContentEditableWarning data-testid="v4-composer-input">Synthetic isolated input</div>
    <div ref={toolbarRef} className="group/toolbar flex items-end gap-3">
      <div className="flex min-w-0 flex-1 items-center" data-composer-leading-actions><div className="flex shrink-0 items-center gap-1" data-composer-leading-content /></div>
      <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5" data-composer-trailing-actions>
      <V4ComposerModelControls workspacePath="/isolated-capability-fixture" sessionId={null} phase={null} draftMode draftConfig={control.draftConfig} modelSelectionView={view} modelSelectionState={read.state} modelSelectionReload={read.reload} usage={null} disabled={false} activeConfigPicker={picker} onConfigPickerOpenChange={(next,open)=>setPicker(open?next:null)} onSelectModel={control.handleDraftSelectModel} onSelectThought={control.handleDraftSelectThought} onSwitchMode={control.handleDraftSwitchMode}/>
      <Button size="icon-md" aria-label="Submit" data-testid="fixture-submit" disabled={!submission} onClick={()=>{const frozen=createComposerSubmissionConfig(control.draftConfig,view);if(frozen)window.submissions.push(frozen)}}><ArrowUpIcon className="size-4"/></Button>
      </div>
    </div>
    <Button data-testid="fixture-refresh" variant="ghost" onClick={()=>modelSelectionService.refresh()}>Refresh catalog</Button>
  </section>;
}
const renderer=createRoot(document.getElementById("root"));
window.appearance=(theme,locale)=>{applyTheme(theme);flushSync(()=>renderer.render(<ServiceProvider services={services}><PlatformProvider platform={{}}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><Scene/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></PlatformProvider></ServiceProvider>))};
window.appearance("light","zh-CN");
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
      plugins: [
        {
          name: "unused-upgrade-entry",
          setup(builder) {
            builder.onLoad({ filter: /CodingPlanUpgradeDialogProvider\.tsx$/ }, () => ({
              contents:
                'export const useCodingPlanUpgradeDialog=()=>({openCodingPlanUpgrade(){throw new Error("Unexpected purchase action")}});export const useOptionalCodingPlanUpgradeDialog=()=>null;',
              loader: "js",
            }));
          },
        },
      ],
      loader: { ".svg": "dataurl", ".png": "dataurl", ".css": "empty" },
      define: { "process.env.NODE_ENV": JSON.stringify("test"), "import.meta.env": "{}" },
    });
    await writeFile(join(temporary, "renderer.js"), renderer.outputFiles[0].text);
    await writeFile(
      join(temporary, "index.html"),
      `<!doctype html><html data-zcode-browser-theme-surface><head><link rel="stylesheet" href="/@fs${root}/packages/ui/src/styles.css"></head><body><div id="root" style="padding:20px"></div><script type="module" src="/renderer.js"></script></body></html>`,
    );
    const { createServer } = await import(requireDesktop.resolve("vite"));
    const { default: tailwindcss } = await import(requireDesktop.resolve("@tailwindcss/vite"));
    vite = await createServer({
      configFile: false,
      root: temporary,
      plugins: [tailwindcss()],
      server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary] } },
    });
    await vite.listen();
    await app.whenReady();
    win = new BrowserWindow({
      show: true,
      width: 1000,
      height: 520,
      webPreferences: {
        preload: join(temporary, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error(event.message);
    });
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}`);
    const observe = (expression) => win.webContents.executeJavaScript(expression);
    const waitFor = (expression) =>
      observe(
        `new Promise((resolve,reject)=>{const timer=setTimeout(()=>{observer.disconnect();reject(new Error("UI condition failed: "+${JSON.stringify(expression)}+" state="+JSON.stringify(window.state)))},7000);const check=()=>{if(${expression}){clearTimeout(timer);observer.disconnect();resolve(true)}};const observer=new MutationObserver(check);observer.observe(document.body,{subtree:true,childList:true,attributes:true});check()})`,
      );
    const click = async (expression) => {
      await observe(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))).then(()=>Promise.all(document.body.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))))",
      );
      const point = await observe(
        `(()=>{const element=${expression};if(!element)throw new Error("Missing UI element: "+${JSON.stringify(expression)});const r=element.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      );
      win.webContents.sendInputEvent({ type: "mouseMove", ...point });
      win.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...point,
      });
      win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    };
    const state = () => observe("window.state");
    const settleMenus = () =>
      waitFor(
        'document.body.style.pointerEvents!=="none" && document.querySelector("[role=listbox],[role=menu]")===null',
      );
    const chooseModel = async (label, group = nativeId) => {
      await settleMenus();
      await click(`document.querySelector(${JSON.stringify(modelTrigger)})`);
      await waitFor('document.querySelector("[data-testid^=chat-model-select-group]")!==null');
      const groupExpression = `[...document.querySelectorAll("[data-model-provider-key]")].find(element=>element.getAttribute("data-model-provider-key")==${JSON.stringify(group)} || element.textContent.includes(${JSON.stringify(group === nativeId ? "XWork·Plan" : "Fixture custom")}))`;
      const hasItems = await observe(
        `[...document.querySelectorAll("[data-testid^=chat-model-select-item]")].some(element=>element.textContent.includes(${JSON.stringify(label)}))`,
      );
      if (!hasItems) await click(groupExpression);
      await waitFor(
        `[...document.querySelectorAll("[data-testid^=chat-model-select-item]")].some(element=>element.textContent.includes(${JSON.stringify(label)}))`,
      );
      await click(
        `[...document.querySelectorAll("[data-testid^=chat-model-select-item]")].find(element=>element.textContent.includes(${JSON.stringify(label)}))`,
      );
      await waitFor(
        `window.state.status==="ready" && window.state.stored?.modelId===${JSON.stringify(label === "Capability A" ? "capability-a" : label === "Capability B" ? "capability-b" : label === "Capability single" ? "capability-single" : "custom-model")}`,
      );
      await settleMenus();
    };
    const openThought = async () => {
      await settleMenus();
      await click(`document.querySelector(${JSON.stringify(thoughtTrigger)})`);
      await waitFor(`document.querySelector(${JSON.stringify(thoughtItems)})!==null`);
    };
    const levels = () =>
      observe(
        `[...document.querySelectorAll(${JSON.stringify(thoughtItems)})].map(element=>element.getAttribute("data-testid").slice("chat-thought-level-select-item-".length))`,
      );
    const chooseLevel = async (level) => {
      await openThought();
      await click(
        `document.querySelector('[data-testid="chat-thought-level-select-item-${level}"]')`,
      );
      await waitFor(
        `window.state.status==="ready" && window.state.stored?.options?.reasoningLevel===${JSON.stringify(level)}`,
      );
      await settleMenus();
    };
    await waitFor('window.state?.status==="ready"');
    stage = "catalog diagnostics stay in settings, not in the model picker";
    assert.deepEqual(
      (await observe("window.capabilityHost.settings()")).catalogIssues.map(
        (issue) => issue.displayName,
      ),
      ["Missing metadata", "Bad CEL"],
    );
    await click(`document.querySelector(${JSON.stringify(modelTrigger)})`);
    await waitFor('document.querySelector("[data-testid^=chat-model-select-group]")!==null');
    assert.equal(
      await observe(
        'document.querySelector("[role=menu]").textContent.includes("Missing metadata") || document.querySelector("[role=menu]").textContent.includes("Bad CEL")',
      ),
      false,
      "Unselectable catalog entries must not appear in the model picker",
    );
    assert.equal(
      await observe('document.querySelector("[data-model-footer-action=manage-models]")!==null'),
      true,
    );
    await observe(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))).then(()=>Promise.all(document.body.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))))",
    );
    await writeFile(
      join(tmpdir(), "xwork-model-picker-selectable.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await settleMenus();
    stage = "original menus and highest new-model choices";
    assert.deepEqual(
      (await state()).providers.map((provider) => provider.providerId),
      [nativeId, "custom"],
    );
    await chooseModel("Capability B");
    assert.equal((await state()).stored.options.reasoningLevel, "high");
    await chooseModel("Capability A");
    assert.equal((await state()).stored.options.reasoningLevel, "max");
    await openThought();
    assert.deepEqual(await levels(), ["disabled", "low", "high", "max"]);
    await click('document.querySelector("[data-testid=chat-thought-level-select-item-low]")');
    await waitFor('window.state.stored?.options?.reasoningLevel==="low" && window.state.canSubmit');
    await settleMenus();
    await click('document.querySelector("[data-testid=fixture-submit]")');
    await waitFor("window.submissions.length===1");
    await chooseLevel("high");
    assert.equal(
      await observe("window.submissions[0].modelSelection.options.reasoningLevel"),
      "low",
    );
    await chooseLevel("max");
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "T", modifiers: ["control"] });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "T", modifiers: ["control"] });
    await waitFor('window.state.stored?.options?.reasoningLevel==="disabled"');
    stage = "single and custom providers";
    await chooseModel("Capability single");
    assert.equal(
      await observe(
        `document.querySelector(${JSON.stringify(thoughtTrigger)}).getAttribute("data-thought-level-fixed")`,
      ),
      "true",
    );
    await chooseModel("custom-model", "custom");
    await openThought();
    assert.deepEqual(await levels(), ["neutral", "custom-deep"]);
    await click('document.querySelector("[data-testid=chat-thought-level-select-item-neutral]")');
    await chooseModel("Capability A");
    await chooseLevel("low");
    stage = "view-only versus actual Host refresh";
    const before = await observe("window.capabilityHost.metrics()");
    await observe('window.capabilityHost.stage(["disabled","high","max"])');
    const peek = await observe("window.peek()");
    assert.equal(peek.selectionIssue, undefined);
    assert.equal(
      (await observe("window.capabilityHost.metrics()")).catalogReads,
      before.catalogReads,
    );
    await click('document.querySelector("[data-testid=fixture-refresh]")');
    await waitFor(
      'window.state.issue==="reasoning-level-not-supported" && !window.state.canSubmit',
    );
    assert.equal((await state()).stored.options.reasoningLevel, "low");
    assert.equal(
      (await observe("window.capabilityHost.metrics()")).catalogReads,
      before.catalogReads + 1,
    );
    await click('document.querySelector("[data-testid=fixture-submit]")');
    assert.equal(await observe("window.submissions.length"), 1);
    await chooseLevel("high");
    await waitFor("window.state.canSubmit");
    stage = "historical invalid and empty choices";
    for (const level of ["off", "nothink", null]) {
      const selection = {
        providerId: nativeId,
        modelId: "capability-a",
        ...(level === null ? {} : { options: { reasoningLevel: level } }),
      };
      await observe(`window.restore(${JSON.stringify(selection)})`);
      await waitFor('window.state.status==="ready" && !window.state.canSubmit');
      assert.deepEqual((await state()).stored, selection);
    }
    await chooseLevel("high");
    stage = "original styled light/dark Chinese/English and narrow layout";
    const evidence = resolve(
      root,
      ".superpowers/sdd/2026-10-12-new-api-model-capability-optimization",
    );
    for (const [theme, locale, width] of [
      ["light", "zh-CN", 1000],
      ["dark", "en-US", 1000],
      ["light", "en-US", 360],
      ["dark", "zh-CN", 360],
    ]) {
      win.setContentSize(width, 440);
      await observe(`window.appearance(${JSON.stringify(theme)},${JSON.stringify(locale)})`);
      await waitFor('window.state.status==="ready" && window.state.canSubmit');
      await waitFor(
        `document.querySelector(${JSON.stringify(modelTrigger)})?.textContent.includes("Capability A") && document.querySelector(${JSON.stringify(thoughtTrigger)})?.disabled===false`,
      );
      win.webContents.sendInputEvent({ type: "mouseMove", x: 10, y: 10 });
      await waitFor('document.querySelector("[role=tooltip]")===null');
      await observe(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))).then(()=>Promise.all(document.body.getAnimations({subtree:true}).filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))))",
      );
      const geometry = await observe(
        `(()=>{const model=document.querySelector(${JSON.stringify(modelTrigger)}),thought=document.querySelector(${JSON.stringify(thoughtTrigger)});const a=model.getBoundingClientRect(),b=thought.getBoundingClientRect();return{model:{x:a.x,right:a.right,width:a.width},thought:{x:b.x,right:b.right,width:b.width},font:getComputedStyle(thought).fontSize,theme:document.documentElement.className}})()`,
      );
      assert.ok(geometry.model.x >= 0 && geometry.thought.right <= width);
      assert.ok(geometry.model.right <= geometry.thought.x + 1);
      assert.ok(
        geometry.model.width > 0 && geometry.thought.width > 0 && parseFloat(geometry.font) > 0,
      );
      await writeFile(
        join(evidence, `composer-capabilities-${theme}-${locale}-${width}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    console.log(
      "Original Composer capability controls, refresh, history gates, custom isolation and styled viewport scenarios passed",
    );
  } catch (error) {
    exitCode = 1;
    console.error(stage, error);
    if (win)
      console.error(
        await win.webContents.executeJavaScript(
          'JSON.stringify({pointerEvents:document.body.style.pointerEvents,menus:[...document.querySelectorAll("[role=menu],[role=listbox]")].map(element=>({role:element.getAttribute("role"),state:element.getAttribute("data-state")})),body:document.body.innerText})',
        ),
      );
  } finally {
    clearTimeout(deadline);
    host?.dispose();
    await vite?.close();
    await rm(temporary, { recursive: true, force: true });
    win?.destroy();
    app.exit(exitCode);
  }
}
void run();
