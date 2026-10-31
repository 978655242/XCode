import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appSettingsSchema, type AppSettings } from "@zcode/shared";
import { createSettingService } from "../src/setting/settingService.js";

// XCODE: 独立下游回归只使用合成 HOME，显式清除继承路径，避免读取真实设置或用户指令。
let root: string;
let home: string;
let legacySettingsFile: string;
let selectedSettingsFile: string;

async function writeJson(file: string, settings: unknown): Promise<string> {
  const text = JSON.stringify(settings, null, 2);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return text;
}

async function seedSettings(file: string, patch: Partial<AppSettings>): Promise<string> {
  return writeJson(file, appSettingsSchema.parse(patch));
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8"));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aiscoo-settings-file-"));
  home = join(root, "home");
  legacySettingsFile = join(home, ".zcode", "v2", "setting.json");
  selectedSettingsFile = join(root, "channel-data", ".zcode", "v2", "setting.json");
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("ZCODE_DESKTOP_HOME_DIR", "");
  vi.stubEnv("ZCODE_DATA_BASE_DIR", "");
  vi.stubEnv("ZCODE_SETTINGS_FILE_PATH", undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("Aiscoo settings file isolation through the generic path override", () => {
  it("reads and updates the trimmed explicit file without changing HOME or user instructions", async () => {
    const originalLegacy = await seedSettings(legacySettingsFile, { locale: "en-US" });
    await seedSettings(selectedSettingsFile, { locale: "zh-CN" });
    const instructionsFile = join(home, ".zcode", "AGENTS.md");
    await writeFile(instructionsFile, "Synthetic home instructions");
    const channelInstructionsFile = join(root, "channel-data", ".zcode", "AGENTS.md");
    await writeFile(channelInstructionsFile, "Synthetic channel sentinel");
    vi.stubEnv("ZCODE_SETTINGS_FILE_PATH", `  ${selectedSettingsFile}\t`);

    const service = createSettingService();
    expect((await service.get()).locale).toBe("zh-CN");
    await service.update({ keepAwakeWhileRunning: true });
    expect((await service.get()).keepAwakeWhileRunning).toBe(true);
    expect(await readJson(selectedSettingsFile)).toMatchObject({
      locale: "zh-CN",
      keepAwakeWhileRunning: true,
    });
    expect(await readFile(legacySettingsFile, "utf8")).toBe(originalLegacy);
    expect(process.env.HOME).toBe(home);
    expect(await service.getUserInstructions()).toEqual({
      filePath: instructionsFile,
      content: "Synthetic home instructions",
    });
    expect(await service.saveUserInstructions("Updated synthetic instructions")).toEqual({
      filePath: instructionsFile,
    });
    expect(await readFile(instructionsFile, "utf8")).toBe("Updated synthetic instructions");
    expect(await readFile(channelInstructionsFile, "utf8")).toBe("Synthetic channel sentinel");
  });

  it("persists initialization migrations only to the explicitly selected settings file", async () => {
    const originalLegacy = await writeJson(legacySettingsFile, { locale: "en-US" });
    await writeJson(selectedSettingsFile, { locale: "zh-CN" });
    vi.stubEnv("ZCODE_SETTINGS_FILE_PATH", selectedSettingsFile);

    const service = createSettingService();
    expect((await service.get()).locale).toBe("zh-CN");
    expect(await readJson(selectedSettingsFile)).toMatchObject({
      closeToTrayOnWindowsMigrationInitialized: true,
      messageStreamShowReasoningMigrationInitialized: true,
      taskAutoArchiveResetVersion: 1,
    });
    await service.update({ keepAwakeWhileRunning: true });
    expect((await service.get()).keepAwakeWhileRunning).toBe(true);
    expect(await readFile(legacySettingsFile, "utf8")).toBe(originalLegacy);
  });

  it("creates the exact selected file when missing instead of falling back to old settings", async () => {
    const originalLegacy = await seedSettings(legacySettingsFile, { locale: "en-US" });
    const customSettingsFile = join(root, "custom", "preferences.json");
    vi.stubEnv("ZCODE_SETTINGS_FILE_PATH", customSettingsFile);

    const service = createSettingService();
    expect(await service.get()).toEqual(appSettingsSchema.parse({}));
    await service.update({ locale: "zh-CN", keepAwakeWhileRunning: true });
    expect(await readJson(customSettingsFile)).toMatchObject({
      locale: "zh-CN",
      keepAwakeWhileRunning: true,
    });
    expect(await readFile(legacySettingsFile, "utf8")).toBe(originalLegacy);
    await expect(readFile(selectedSettingsFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([undefined, "", " \t "])(
    "preserves the default HOME file when the override is %j",
    async (override) => {
      await seedSettings(legacySettingsFile, { locale: "en-US" });
      const originalSelected = await seedSettings(selectedSettingsFile, { locale: "zh-CN" });
      vi.stubEnv("ZCODE_SETTINGS_FILE_PATH", override);

      const service = createSettingService();
      expect((await service.get()).locale).toBe("en-US");
      await service.update({ keepAwakeWhileRunning: true });
      expect(await readJson(legacySettingsFile)).toMatchObject({
        locale: "en-US",
        keepAwakeWhileRunning: true,
      });
      expect(await readFile(selectedSettingsFile, "utf8")).toBe(originalSelected);
    },
  );

  it("preserves the existing desktop HOME priority without an explicit settings file", async () => {
    const originalLegacy = await seedSettings(legacySettingsFile, { locale: "en-US" });
    const desktopHome = join(root, "desktop-home");
    const desktopSettingsFile = join(desktopHome, ".zcode", "v2", "setting.json");
    await seedSettings(desktopSettingsFile, { locale: "zh-CN" });
    vi.stubEnv("ZCODE_DESKTOP_HOME_DIR", desktopHome);

    const service = createSettingService();
    expect((await service.get()).locale).toBe("zh-CN");
    await service.update({ keepAwakeWhileRunning: true });
    expect((await readJson(desktopSettingsFile)).keepAwakeWhileRunning).toBe(true);
    expect(await readFile(legacySettingsFile, "utf8")).toBe(originalLegacy);
  });

  it.each(["default", "override"])(
    "keeps an instance's %s file after the environment changes before its first IO",
    async (initialPath) => {
      const originalLegacy = await seedSettings(legacySettingsFile, { locale: "en-US" });
      await seedSettings(selectedSettingsFile, { locale: "zh-CN" });
      const laterSettingsFile = join(root, "later-channel", "settings.json");
      const originalLater = await seedSettings(laterSettingsFile, { locale: "en-US" });
      if (initialPath === "override") {
        vi.stubEnv("ZCODE_SETTINGS_FILE_PATH", selectedSettingsFile);
      }
      const service = createSettingService();
      vi.stubEnv("ZCODE_SETTINGS_FILE_PATH", laterSettingsFile);
      vi.stubEnv("HOME", join(root, "later-home"));
      vi.stubEnv("USERPROFILE", join(root, "later-home"));
      vi.stubEnv("ZCODE_DESKTOP_HOME_DIR", join(root, "later-desktop-home"));

      expect((await service.get()).locale).toBe(initialPath === "override" ? "zh-CN" : "en-US");
      await service.update({ keepAwakeWhileRunning: true });
      const boundFile = initialPath === "override" ? selectedSettingsFile : legacySettingsFile;
      expect((await readJson(boundFile)).keepAwakeWhileRunning).toBe(true);
      expect(await readFile(laterSettingsFile, "utf8")).toBe(originalLater);
      if (initialPath === "override") {
        expect(await readFile(legacySettingsFile, "utf8")).toBe(originalLegacy);
      }
      const laterService = createSettingService();
      expect((await laterService.get()).keepAwakeWhileRunning).toBe(false);
    },
  );
});
