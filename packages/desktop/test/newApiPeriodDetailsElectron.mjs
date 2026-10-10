import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const requireServices = createRequire(new URL("../../services/package.json", import.meta.url));
const { build } = requireServices("esbuild");
const requireRoot = createRequire(new URL("../../../package.json", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
// XCODE: 不在 Electron ESM 入口顶层等待 ready，避免启动互锁。
async function run() {
  const temporary = await mkdtemp(join(tmpdir(), "xwork-period-details-"));
  app.setPath("userData", temporary);
  let win;
  let exitCode = 0;
  const deadline = setTimeout(() => {
    console.error("Native period details regression timed out");
    app.exit(1);
  }, 40_000);
  try {
    const bundle = await build({
      stdin: {
        resolveDir: root,
        loader: "tsx",
        contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { ChatCodingPlanUsageRemainingPanel } from "./packages/ui/src/chat-input-toolbar/CodingPlanContextUsage.tsx";
      import { ZCodeIntlProvider, useZCodeIntl } from "./packages/ui/src/i18n/IntlProvider.tsx";
      import { ServiceProvider } from "./packages/ui/src/hooks/useServices.tsx";
      import { mapNewApiEntitlement } from "./packages/services/src/new-api/newApiUsageMapper.ts";
      import { CodingPlanUsageBarChart } from "./packages/ui/src/settings/usage-stats/CodingPlanUsageBarChart.tsx";
      const providerId = "account:new-api-anthropic-messages";
      const accountAccess = { type: "new-api-account", accountType: "new-api", mode: "private-subscription", entitled: true };
      const entitlement = {
        schema_version: 1, server_time: 1800000000000, status: "active", authorization_revision: "42",
        subscription: { id: "7", plan_id: "3", plan_title: "Private", source: "admin", usage_scope: "xcode", start_time: null, end_time: null },
        quota: { scope: "xcode-subscription", unit: "quota", unlimited: false, total: "100", used: "25", remaining: "75", used_percentage: 25,
          reset_period: "monthly", reset_custom_seconds: "0", last_reset_time: Date.parse("2026-10-01T16:00:00Z"), next_reset_time: Date.parse("2026-11-01T16:00:00Z"), reset_time_zone: "server-local", reset_utc_offset_seconds: 28800 },
        funding_policy: { subscription_only: true, wallet_fallback: false, other_subscription_fallback: false }, self_service_reset: false, purchase_mode: "manual_admin"
      };
      window.periodCalls = [];
      const forbidden = (method) => async () => { window.periodCalls.push(method); throw new Error("Native must not call official " + method); };
      const services = { usageStatsService: {
        getCodingPlanResetStatus: forbidden("status"), getCodingPlanResetOpportunity: forbidden("opportunity"),
        useCodingPlanReset: forbidden("reset"), markCodingPlanResetHistoryRead: forbidden("history")
      } };
      const config = { availableProviders: [{ providerId, accountAccess, label: "New API" }],
        entitlements: [{ providerId, accountAccess, snapshot: mapNewApiEntitlement(entitlement, providerId), loading: false, error: null }],
        modelProvidersLoading: false, selectedProviderId: providerId };
      function Panel() {
        const { intl, locale } = useZCodeIntl();
        return <ChatCodingPlanUsageRemainingPanel config={config} intl={intl} locale={locale} />;
      }
      const renderer = createRoot(document.getElementById("root"));
      window.renderUsageChart = (granularity, xTime) => flushSync(() => renderer.render(
        <ZCodeIntlProvider initialLocale="en-US"><CodingPlanUsageBarChart granularity={granularity}
          xTime={xTime} series={[{name:"Native fixture",values:xTime.map(()=>1)}]} emptyDescription="No usage" /></ZCodeIntlProvider>
      ));
      flushSync(() => renderer.render(
        <ServiceProvider services={services}><ZCodeIntlProvider initialLocale="en-US"><Panel /></ZCodeIntlProvider></ServiceProvider>
      ));
    `,
      },
      absWorkingDir: root,
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      tsconfig: resolve(root, "packages/ui/tsconfig.json"),
      alias: {
        "@": resolve(root, "packages/ui/src"),
        react: dirname(requireRoot.resolve("react/package.json")),
        "react-dom": dirname(requireRoot.resolve("react-dom/package.json")),
      },
      loader: { ".svg": "dataurl", ".png": "dataurl", ".css": "empty" },
      define: { "process.env.NODE_ENV": JSON.stringify("test") },
    });
    await app.whenReady();
    win = new BrowserWindow({
      show: true,
      width: 800,
      height: 600,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    await win.loadURL(
      "data:text/html,<html><head><style>[data-slot=chart]{width:740px;height:350px}</style></head><body><div id='root'></div></body></html>",
    );
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text);
    const observe = (expression) => win.webContents.executeJavaScript(expression);
    assert.equal(await observe("document.querySelector('[role=dialog]') === null"), true);
    assert.equal(
      await observe(
        `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Period details')); if (!button) return false; button.click(); return true; })()`,
      ),
      true,
    );
    // A real DOM interaction must reveal the mounted Radix dialog, not only toggle a state/config fixture.
    assert.equal(
      await observe(
        `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(!!document.querySelector('[role=dialog]')))))`,
      ),
      true,
    );
    const text = await observe("document.querySelector('[role=dialog]').textContent");
    assert.match(text, /Period details · read only/);
    assert.match(text, /Monthly/);
    assert.match(text, /Read-only quota\. Reset, renew or replace through your administrator\./);
    assert.match(text, /75%/);
    assert.match(text, /server-local/);
    assert.match(text, /Nov 2, 2026, 12:00 AM/);
    assert.doesNotMatch(text, /Five.hour|Weekly quota|Reset quota/);
    assert.deepEqual(await observe("window.periodCalls"), []);
    assert.equal(
      await observe(
        `(() => { document.querySelector('[role=dialog] button').click(); return true; })()`,
      ),
      true,
    );
    assert.equal(
      await observe(
        `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.querySelector('[role=dialog]') === null))))`,
      ),
      true,
    );
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setTimezoneOverride", {
      timezoneId: "America/Los_Angeles",
    });
    const chartLabels = async (granularity, xTime) => {
      await observe(
        `window.renderUsageChart(${JSON.stringify(granularity)}, ${JSON.stringify(xTime)})`,
      );
      return observe(`new Promise(resolve => {
        const labels = () => [...document.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map(e=>e.textContent);
        const finish = () => { const values=labels(); if (!values.length) return; observer.disconnect(); resolve(values); };
        const observer = new MutationObserver(finish); observer.observe(document.getElementById('root'),{childList:true,subtree:true});
        setTimeout(() => { observer.disconnect(); resolve(labels()); }, 1500); finish();
      })`);
    };
    const dailyLabels = await chartLabels("day", ["2026-10-09"]);
    const hourlyLabels = await chartLabels("hour", ["01:00 -04:00", "01:00 -05:00"]);
    assert.deepEqual(
      { dailyLabels, hourlyLabels },
      {
        dailyLabels: ["Oct 9"],
        hourlyLabels: ["01:00 -04:00", "01:00 -05:00"],
      },
      "actual chart axes must keep server calendar days and distinguish repeated DST hours",
    );
    console.log(
      JSON.stringify({
        nativePeriodActionOpensDialog: true,
        singleReadOnlyPeriod: true,
        administratorExplanation: true,
        noOfficialResetCalls: true,
        closeTransition: true,
        dailyLabels,
        hourlyLabels,
      }),
    );
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    clearTimeout(deadline);
    await rm(temporary, { recursive: true, force: true });
    app.exit(exitCode);
  }
}
void run();
