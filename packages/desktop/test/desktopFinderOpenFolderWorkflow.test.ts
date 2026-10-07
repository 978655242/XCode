import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installFinderOpenFolderWorkflow } from "../src/main/desktopFinderOpenFolderWorkflow.js";

const LEGACY_WORKFLOW_NAME = "Open in ZCode.workflow";
const XWORK_WORKFLOW_NAME = "Open in XWork.workflow";
const BUNDLE_ID = "dev.zcode.app.finder-open-workflow";

async function writeWorkflowInfo(homeDir: string, workflowName: string, bundleId: string) {
  const contentsDir = join(homeDir, "Library", "Services", workflowName, "Contents");
  await mkdir(contentsDir, { recursive: true });
  await writeFile(
    join(contentsDir, "Info.plist"),
    `<plist><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`,
  );
}

test("installs the XWork Finder service and removes only the legacy app workflow", async () => {
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
    assert.match(xworkInfo, /Open in XWork/);
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
