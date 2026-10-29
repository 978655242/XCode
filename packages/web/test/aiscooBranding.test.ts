import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getWebAuthCopy } from "../src/auth/webAuthLocale.js";
import {
  WebRemoteControlBrand,
  WebRemoteControlDeviceListPage,
  WebRemoteControlConnectionList,
} from "#src/web-remote-control/views.js";
import { resolveWebRemoteControlScreenCopy } from "#src/web-remote-control/domain/webRemoteControlScreenCopy.js";
import type { WebRemoteControlDeviceGroup } from "#src/web-remote-control/index.js";
import {
  ConversationShareLandingPage,
  ConversationShareLandingStatus,
} from "../src/share/ConversationShareLandingPage.js";
import type { ConversationSharePreview } from "@zcode/shared";

const device: WebRemoteControlDeviceGroup = {
  deviceMid: "device-user-key",
  name: "ZCode XWork personal computer",
  platform: "darwin",
  onlineConnections: [
    {
      device_sid: "session-user-key",
      device_mid: "device-user-key",
      online: true,
      created_at: 1,
      meta: { version: "3.15.0" },
    },
  ],
};

describe("Aiscoo Web 展示接线", () => {
  it.each(["zh-CN", "en-US"] as const)("%s 登录与远控恢复使用产品名且保留登录供应商", (locale) => {
    const copy = getWebAuthCopy(locale);
    expect(copy.brand).toBe("Aiscoo");
    expect(copy.loginAction.zai).toContain("Z.ai");
    expect(copy.loginAction.bigmodel).toContain("BigModel");
    const failure = resolveWebRemoteControlScreenCopy({ reason: "desktop-disconnected" }, locale);
    expect(failure.nextSteps[0]).toContain("Aiscoo");
    const brand = renderToStaticMarkup(
      createElement(WebRemoteControlBrand, { productName: "Aiscoo" }),
    );
    expect(brand).toContain(">Aiscoo</span>");
    expect(brand).toContain('data-aiscoo-brand="app"');
    expect(brand).not.toContain("<button");
  });

  it.each(["zh-CN", "en-US"] as const)(
    "%s 设备行保留用户设备名，产品版本与静态帮助显示新品牌",
    (locale) => {
      const html = renderToStaticMarkup(
        createElement(WebRemoteControlDeviceListPage, {
          locale,
          productName: "Aiscoo",
          view: { kind: "devices", devices: [device], loading: false, error: false },
          onSelect: () => {},
          onRefresh: () => {},
          onSwitchAccount: () => {},
        }),
      );
      expect(html).toContain("ZCode XWork personal computer");
      expect(html).toContain("macOS · Aiscoo 3.15.0");
      const list = renderToStaticMarkup(
        createElement(WebRemoteControlConnectionList, {
          device,
          locale,
          productName: "Aiscoo",
          disabled: false,
          now: 1_000,
          onSelect: () => {},
        }),
      );
      expect(list).toContain("Aiscoo 3.15.0");
      expect(list).not.toContain("ZCode 3.15.0");
    },
  );

  it.each(["zh-CN", "en-US"] as const)(
    "%s 分享自有提示使用新品牌，用户标题与深链不转换",
    (locale) => {
      const preview: ConversationSharePreview = {
        schema_version: 1,
        share: {
          title: "ZCode XWork user title",
          access_mode: "public_importable",
          created_at: 1_000,
          expires_at: 2_000,
        },
        rows: [],
        artifacts: [],
        integrity: { projection_sha256: "a".repeat(64), artifact_set_sha256: "b".repeat(64) },
      };
      const html = renderToStaticMarkup(
        createElement(ConversationShareLandingPage, { shareCode: "old-key", preview, locale }),
      );
      expect(html).toContain("ZCode XWork user title");
      expect(html).toContain(locale === "zh-CN" ? "去 Aiscoo 继续" : "Continue in Aiscoo");
      expect(html).toContain('href="zcode://share/import?code=old-key"');
      expect(html).toContain('data-aiscoo-brand="wordmark"');
      const status = renderToStaticMarkup(
        createElement(ConversationShareLandingStatus, {
          locale,
          state: { kind: "error", error: "upgrade_required" },
        }),
      );
      expect(status).toContain("Aiscoo");
      expect(status).not.toContain("XWork");
    },
  );
});
