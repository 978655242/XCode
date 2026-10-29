import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, test, vi } from "vitest";
import { installFinderOpenFolderWorkflow } from "../src/main/desktopFinderOpenFolderWorkflow.js";

const LEGACY_WORKFLOW_NAME = "Open in ZCode.workflow";
// XCODE: 当前展示路径随品牌变更，旧 XWork 路径由独立迁移回归验证。
const XWORK_WORKFLOW_NAME = "Open in Aiscoo.workflow";
const BUNDLE_ID = "dev.zcode.app.finder-open-workflow";

async function writeWorkflowInfo(homeDir: string, workflowName: string, bundleId: string) {
  const contentsDir = join(homeDir, "Library", "Services", workflowName, "Contents");
  await mkdir(contentsDir, { recursive: true });
  await writeFile(
    join(contentsDir, "Info.plist"),
    `<plist><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`,
  );
}

test("installs the Aiscoo Finder service and removes only the legacy app workflow", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "xwork-finder-workflow-"));
  try {
    await writeWorkflowInfo(homeDir, LEGACY_WORKFLOW_NAME, BUNDLE_ID);
    let refreshCount = 0;

    installFinderOpenFolderWorkflow({
      platform: "darwin",
      locale: "en-US",
      homeDir,
      logger: { info() {}, warn() {} },
      refreshServicesIndex: () => refreshCount++,
    });

    const servicesDir = join(homeDir, "Library", "Services");
    const xworkInfo = await readFile(
      join(servicesDir, XWORK_WORKFLOW_NAME, "Contents", "Info.plist"),
      "utf8",
    );
    await assert.rejects(
      readFile(join(servicesDir, LEGACY_WORKFLOW_NAME, "Contents", "Info.plist")),
    );
    assert.match(xworkInfo, /Open in Aiscoo/);
    assert.equal(refreshCount, 1);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("preserves an unrelated workflow that uses the legacy filename", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "xwork-finder-workflow-"));
  try {
    await writeWorkflowInfo(homeDir, LEGACY_WORKFLOW_NAME, "devXzcodeYappZfinder-open-workflow");

    installFinderOpenFolderWorkflow({
      platform: "darwin",
      locale: "zh-CN",
      homeDir,
      logger: { info() {}, warn() {} },
      refreshServicesIndex() {},
    });

    const legacyInfo = await readFile(
      join(homeDir, "Library", "Services", LEGACY_WORKFLOW_NAME, "Contents", "Info.plist"),
      "utf8",
    );
    assert.match(legacyInfo, /devXzcodeYappZfinder-open-workflow/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktopFinderOpenFolderWorkflow", () => {
  it("按中文 locale 写入 Finder 服务展示名", () => {
    const homeDir = createTempHome();
    const refreshServicesIndex = vi.fn();

    installFinderOpenFolderWorkflow({
      platform: "darwin",
      locale: "zh-CN",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex,
    });

    const infoPlist = readInfoPlist(homeDir);
    expect(infoPlist).toContain("<string>在Aiscoo中打开</string>");
    expect(infoPlist).not.toContain("<string>Open in Aiscoo</string>");
    expect(refreshServicesIndex).toHaveBeenCalledTimes(1);
  });

  it("按英文 locale 写入 Finder 服务展示名并复用稳定 workflow 文件名", () => {
    const homeDir = createTempHome();
    const refreshServicesIndex = vi.fn();

    installFinderOpenFolderWorkflow({
      platform: "darwin",
      locale: "en-US",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex,
    });

    const infoPlist = readInfoPlist(homeDir);
    expect(infoPlist).toContain("<string>Open in Aiscoo</string>");
    expect(infoPlist).not.toContain("<string>在Aiscoo中打开</string>");
    expect(infoPlist).toContain("<string>5</string>");
    expect(refreshServicesIndex).toHaveBeenCalledTimes(1);
  });

  it("非 macOS 不安装 Finder 服务", () => {
    const homeDir = createTempHome();
    const refreshServicesIndex = vi.fn();

    installFinderOpenFolderWorkflow({
      platform: "linux",
      locale: "zh-CN",
      homeDir,
      logger: { info: vi.fn(), warn: vi.fn() },
      refreshServicesIndex,
    });

    expect(refreshServicesIndex).not.toHaveBeenCalled();
  });
});

function createTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "zcode-finder-workflow-"));
  tempDirs.push(dir);
  return dir;
}

function readInfoPlist(homeDir: string): string {
  return readFileSync(
    join(homeDir, "Library", "Services", XWORK_WORKFLOW_NAME, "Contents", "Info.plist"),
    "utf8",
  );
}
