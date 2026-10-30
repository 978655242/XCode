import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as legacyBrand from "@zcode/ui/xwork-brand";
import * as currentBrand from "@zcode/ui/aiscoo-brand";
import * as implementationBrand from "../src/aiscoo/brand/index.js";
import * as legacySharedBrand from "@zcode/shared/xwork-brand";
import * as currentSharedBrand from "@zcode/shared/aiscoo-brand";
import * as legacyStartup from "@zcode/ui/xwork-startup-context";
import * as currentStartup from "@zcode/ui/aiscoo-startup-context";
import * as legacyPluginView from "../src/xwork/plugin-guides/index.js";
import * as currentPluginView from "../src/aiscoo/plugin-guides/index.js";
import * as legacyGuides from "@zcode/shared/xwork-plugin-guides";
import * as currentGuides from "@zcode/shared/aiscoo-plugin-guides";
import { IPluginGuideService as legacyService } from "@zcode/services/xwork-plugin-guides";
import { IPluginGuideService as currentService } from "@zcode/services/aiscoo-plugin-guides";
import { zcodeProtocolMethods, zcodeProtocolNotifications } from "@zcode/shared";
import type { ProductBrand } from "@zcode/shared/aiscoo-brand";

// 老消费者可以继续构造不包含新法律字段的完整类型。
const oldBrand: ProductBrand = {
  productName: "Aiscoo",
  wordmark: "aiscoo",
  developmentName: "Aiscoo Dev",
  previewName: "Aiscoo Preview",
  desktopName: "Aiscoo Desktop App",
  sourceDirectory: "docs/brand/aiscoo",
  desktopIcon: { theme: "dark", markScale: 1 },
  palette: {
    lightForeground: "#000",
    lightBackground: "#fff",
    darkForeground: "#fff",
    darkBackground: "#000",
  },
};

describe("Aiscoo naming compatibility", () => {
  it("retains exact published brand targets and one shared implementation", async () => {
    const shared = JSON.parse(
      await readFile(new URL("../../shared/package.json", import.meta.url), "utf8"),
    );
    const ui = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(shared.exports["./xwork-brand"]).toBe("./src/xwork-brand/runtime.js");
    expect(shared.exports["./aiscoo-brand"]).toBe("./src/xwork-brand/runtime.js");
    expect(ui.exports["./xwork-brand"]).toBe("./src/xwork/brand/index.ts");
    expect(ui.exports["./aiscoo-brand"]).toBe("./src/xwork/brand/index.ts");
    expect(currentSharedBrand.PRODUCT_BRAND).toBe(legacySharedBrand.PRODUCT_BRAND);
    expect(currentBrand.AiscooMark).toBe(legacyBrand.AiscooMark);
    expect(currentBrand.AiscooMark).toBe(implementationBrand.AiscooMark);
    expect(oldBrand.productName).toBe("Aiscoo");
  });

  it("retains guide schema and service identity across both public names", () => {
    expect(currentGuides.pluginGuideTargetSchema).toBe(legacyGuides.pluginGuideTargetSchema);
    expect(currentStartup.createAiscooRoot).toBe(legacyStartup.createXWorkRoot);
    expect(currentPluginView.AiscooPluginStoreDetailView).toBe(
      legacyPluginView.XWorkPluginStoreDetailView,
    );
    expect(currentService).toBe(legacyService);
    expect(currentService.channelName).toBe("xwork-plugin-guides");
  });

  it("keeps old and new protocol names on the same wire methods", () => {
    expect(zcodeProtocolMethods.xworkPluginGuideSource).toBe("xwork/plugins/guideSource");
    expect(zcodeProtocolMethods.aiscooPluginGuideSource).toBe(
      zcodeProtocolMethods.xworkPluginGuideSource,
    );
    expect(zcodeProtocolMethods.xworkWorkspaceStreamText).toBe("xwork/workspace/streamText");
    expect(zcodeProtocolMethods.aiscooWorkspaceStreamText).toBe(
      zcodeProtocolMethods.xworkWorkspaceStreamText,
    );
    expect(zcodeProtocolNotifications.xworkWorkspaceTextDelta).toBe("xwork/workspace/textDelta");
    expect(zcodeProtocolNotifications.aiscooWorkspaceTextDelta).toBe(
      zcodeProtocolNotifications.xworkWorkspaceTextDelta,
    );
  });
});
