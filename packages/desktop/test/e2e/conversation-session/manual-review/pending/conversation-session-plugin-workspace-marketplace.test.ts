import type { IServiceAccessor } from "@zcode/services";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { clearAppData, getE2EAppDataPaths } from "../../../helpers/desktop-app.js";
import {
  addMarketplaceSourceThroughUi,
  clickPluginControl,
  createPluginLifecycleFixture,
  hasPluginControl,
  openPluginCard,
  openPluginSettings,
  PLUGIN_LIFECYCLE_ID,
  PLUGIN_LIFECYCLE_MARKETPLACE_ID,
  pluginStoragePath,
  waitForPluginCard,
} from "../../../helpers/plugin-management-lifecycle.js";

describe("WPL-009 Global Plugin Marketplace install E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("keeps marketplace and installation in User inventory while Workspace stays config-only", async function () {
    this.timeout(300000);

    const fixture = await createPluginLifecycleFixture("1.0.0");
    const { storageRoot, workspace } = getE2EAppDataPaths();
    const workspaceConfigPath = join(workspace, ".zcode", "config.json");
    const userConfigPath = join(storageRoot, "cli", "config.json");
    const knownMarketplacesPath = pluginStoragePath("known_marketplaces.json");
    const marketplaceCachePath = pluginStoragePath("marketplaces", PLUGIN_LIFECYCLE_MARKETPLACE_ID);

    // V4 Root 没有 legacy App 的插件 test actions；添加和安装都走现有商店 UI。
    await openPluginSettings();
    await addMarketplaceSourceThroughUi(fixture.marketplaceRoot);
    await browser.waitUntil(
      async () =>
        (await readPluginProjection(workspace, "user")).overview.availablePlugins.some(
          (plugin) => plugin.id === PLUGIN_LIFECYCLE_ID,
        ),
      { timeout: 60000, timeoutMsg: "Global marketplace fixture did not become available" },
    );
    await browser.waitUntil(
      async () => !(await hasPluginControl("plugin-store-add-source-dialog")),
      { timeout: 60000, timeoutMsg: "Marketplace source dialog did not close after adding source" },
    );

    expect(await readFile(knownMarketplacesPath, "utf8")).toContain(
      PLUGIN_LIFECYCLE_MARKETPLACE_ID,
    );
    expect(existsSync(marketplaceCachePath)).toBe(true);
    expect((await readPluginProjection(workspace, "user")).overview.marketplaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: PLUGIN_LIFECYCLE_MARKETPLACE_ID })]),
    );

    // Marketplace 只从全局入口打开；页面本身没有 scope、启停或 options 配置控件。
    expect(await hasPluginControl("plugin-store-scope-trigger")).toBe(false);
    expect(await hasPluginControl("plugin-store-enabled-switch")).toBe(false);
    expect(await hasPluginControl("plugin-store-config")).toBe(false);
    await clickPluginControl("plugin-store-segment-personal");
    await waitForPluginCard(PLUGIN_LIFECYCLE_ID);
    await openPluginCard(PLUGIN_LIFECYCLE_ID);
    await clickPluginControl("plugin-store-install", { pluginId: PLUGIN_LIFECYCLE_ID });
    await browser.waitUntil(
      async () =>
        (await readPluginProjection(workspace, "user")).overview.installedPlugins.some(
          (plugin) => plugin.id === PLUGIN_LIFECYCLE_ID,
        ),
      { timeout: 120000, timeoutMsg: `Plugin did not install through UI: ${PLUGIN_LIFECYCLE_ID}` },
    );

    const userConfig = JSON.parse(await readFile(userConfigPath, "utf8")) as {
      plugins?: {
        enabledPlugins?: Record<string, boolean>;
        options?: Record<string, Record<string, unknown>>;
      };
    };
    expect(userConfig.plugins?.enabledPlugins?.[PLUGIN_LIFECYCLE_ID]).toBe(true);
    expect(userConfig.plugins?.options?.[PLUGIN_LIFECYCLE_ID]).toBeUndefined();

    const workspaceConfig = existsSync(workspaceConfigPath)
      ? (JSON.parse(await readFile(workspaceConfigPath, "utf8")) as {
          plugins?: {
            extraKnownMarketplaces?: Record<string, unknown>;
            enabledPlugins?: Record<string, boolean>;
            options?: Record<string, Record<string, unknown>>;
          };
        })
      : {};
    expect(workspaceConfig.plugins?.extraKnownMarketplaces).toBeUndefined();
    expect(workspaceConfig.plugins?.enabledPlugins?.[PLUGIN_LIFECYCLE_ID]).toBeUndefined();
    expect(workspaceConfig.plugins?.options?.[PLUGIN_LIFECYCLE_ID]).toBeUndefined();

    const workspaceProjection = (
      await readPluginProjection(workspace, "workspace")
    ).list.plugins.find((plugin) => plugin.id === PLUGIN_LIFECYCLE_ID);
    const userProjection = (await readPluginProjection(workspace, "user")).list.plugins.find(
      (plugin) => plugin.id === PLUGIN_LIFECYCLE_ID,
    );
    expect(workspaceProjection).toMatchObject({ enabled: true, enabledSource: "user" });
    expect(userProjection).toMatchObject({ enabled: true, enabledSource: "user" });
  });
});

async function readPluginProjection(workspacePath: string, configScope: "user" | "workspace") {
  return browser.execute(
    async (path, scope) => {
      const element = document.querySelector('[data-testid="plugin-store-root"]');
      if (!element) throw new Error("Plugin Store is not mounted");
      const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber"));
      let fiber: unknown = fiberKey ? Reflect.get(element, fiberKey) : undefined;
      while (fiber && typeof fiber === "object") {
        const props: unknown = Reflect.get(fiber, "memoizedProps");
        const value =
          props && typeof props === "object" && "value" in props ? props.value : undefined;
        const candidate =
          value && typeof value === "object" && "pluginManagementService" in value
            ? value
            : props && typeof props === "object" && "services" in props
              ? props.services
              : undefined;
        if (candidate && typeof candidate === "object" && "pluginManagementService" in candidate) {
          // 复用 ServiceProvider 注入的公开服务，只读真实 Agent 投影，不新增产品桥接。
          const { pluginManagementService } = candidate as Pick<
            IServiceAccessor,
            "pluginManagementService"
          >;
          const params = { workspacePath: path, configScope: scope };
          const [overview, list] = await Promise.all([
            pluginManagementService.getPluginsOverview(params),
            pluginManagementService.listPlugins(params),
          ]);
          return { overview, list };
        }
        fiber = Reflect.get(fiber, "return");
      }
      throw new Error("Plugin Store ServiceProvider not found");
    },
    workspacePath,
    configScope,
  );
}
