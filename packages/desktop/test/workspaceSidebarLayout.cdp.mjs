import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// XCODE: 只连接显式隔离工作区，验证新版单导航面板与外部文件管理器的真实滚动/焦点行为。
const [endpoint = "http://127.0.0.1:9229", workspacePath, projectName] = process.argv.slice(2);
assert.ok(
  workspacePath?.startsWith("/") && projectName,
  "用法：node workspaceSidebarLayout.cdp.mjs <CDP地址> <隔离工作区绝对路径> <单root本地项目名>",
);
const browser = await chromium.connectOverCDP(endpoint);
try {
  const pages = browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((candidate) => {
      const url = new URL(candidate.url());
      return (
        url.searchParams.get("supportsSettings") === "true" &&
        url.searchParams.get("initialWorkspacePath") === workspacePath
      );
    });
  assert.equal(pages.length, 1, "必须唯一匹配显式隔离工作区，禁止回退到其它用户窗口");
  const page = pages[0];
  const sidebar = page.getByTestId("sidebar");
  const navigation = sidebar.locator('[data-project-sidebar-panel="navigation"]');
  const list = sidebar.locator('[data-testid="sidebar-task-list-region"] [data-scroll-mask]');
  const project = sidebar.getByTestId("virtual-project-row").filter({
    has: page.getByText(projectName, { exact: true }),
  });
  const fileTree = page.locator(
    '[data-file-manager-pane]:visible [data-testid="workspace-file-tree-panel"]',
  );
  const tabs = page.locator("[data-side-pane-tab-id]");
  const tabIds = () =>
    tabs.evaluateAll((elements) => elements.map((element) => element.dataset.sidePaneTabId));
  await sidebar.waitFor({ state: "visible" });
  await project.waitFor({ state: "visible" });
  assert.equal(await project.count(), 1, "隔离项目名称必须唯一");
  assert.equal(await project.getByTestId("project-device").count(), 0, "只允许本地隔离项目");
  const filesButton = project.getByTestId("virtual-project-files");
  assert.notEqual(await filesButton.getAttribute("aria-haspopup"), "menu", "本场景要求单root项目");
  assert.notEqual(await filesButton.getAttribute("aria-disabled"), "true", "项目主目录必须有效");
  const originalTabs = await tabIds();
  const originalActiveTabId = await tabs.evaluateAll(
    (elements) =>
      elements.find((element) => element.hasAttribute("data-active"))?.dataset.sidePaneTabId,
  );
  let openedTabId = null;
  const assertAligned = async () => {
    await project.hover();
    // XCODE: 新建入口的 testid 在不可聚焦的 group 上；检查既有真实文件/账号按钮，不改上游焦点语义。
    for (const [testId, button] of [
      ["virtual-project-files", filesButton],
      ["login-trigger", sidebar.getByTestId("login-trigger")],
    ]) {
      assert.equal(
        await button.evaluate((element) => {
          element.focus({ preventScroll: true });
          return document.activeElement === element;
        }),
        true,
        `${testId} 在文件管理器开关前后仍须可聚焦`,
      );
    }
    assert.equal(await sidebar.locator("[data-project-sidebar-panel]").count(), 1);
    assert.deepEqual(
      await navigation.evaluate((panel) => {
        const viewport = panel.parentElement;
        const sidebarElement = panel.closest('[data-testid="sidebar"]');
        const bounds = sidebarElement.getBoundingClientRect();
        panel.scrollIntoView({ block: "nearest", inline: "nearest" });
        viewport.scrollLeft = 54.5;
        const inside = (node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
        };
        return {
          overflowX: getComputedStyle(viewport).overflowX,
          scrollLeft: viewport.scrollLeft,
          navigationInside: inside(
            panel.querySelector('[data-testid="sidebar-primary-navigation"]'),
          ),
          footerInside: inside(panel.querySelector("footer")),
        };
      }),
      { overflowX: "clip", scrollLeft: 0, navigationInside: true, footerInside: true },
      "裁切视口不能横向滚动，导航和账号必须保持在侧栏内",
    );
  };
  const assertVerticalScroll = async (viewport, label) => {
    const originalScrollTop = await viewport.evaluate((element) => {
      if (element.scrollHeight <= element.clientHeight + 1) {
        throw new Error("隔离fixture必须有足够内容形成纵向溢出，不能跳过滚动验收");
      }
      const original = element.scrollTop;
      element.scrollTop = 0;
      return original;
    });
    const handle = await viewport.elementHandle();
    try {
      await viewport.hover();
      await page.mouse.wheel(0, 160);
      await page.waitForFunction((element) => element.scrollTop > 0, handle);
      assert.ok(
        await viewport.evaluate((element) => element.scrollTop > 0),
        `${label}仍可真实纵滚`,
      );
    } finally {
      await viewport.evaluate((element, original) => {
        element.scrollTop = original;
      }, originalScrollTop);
      await handle.dispose();
    }
  };
  const closeOpenedTab = async () => {
    if (!openedTabId) return;
    assert.ok(!originalTabs.includes(openedTabId), "禁止关闭运行前已有标签");
    const tab = page.locator(`[data-side-pane-tab-id=${JSON.stringify(openedTabId)}]`);
    if (await tab.count()) {
      await tab.locator("button").click();
      await tab.waitFor({ state: "detached" });
    }
    openedTabId = null;
  };
  try {
    await assertAligned();
    await assertVerticalScroll(list, "侧栏列表");
    for (let round = 0; round < 2; round += 1) {
      await project.hover();
      await filesButton.click();
      const createdTab = await page.waitForFunction((before) => {
        const active = document.querySelector("[data-side-pane-tab-id][data-active]");
        const id = active?.getAttribute("data-side-pane-tab-id");
        return id && !before.includes(id) ? id : false;
      }, originalTabs);
      openedTabId = await createdTab.jsonValue();
      await createdTab.dispose();
      await fileTree.waitFor({ state: "visible" });
      assert.equal(
        await fileTree.evaluate((tree) =>
          document.querySelector('[data-testid="sidebar"]').contains(tree),
        ),
        false,
        "文件树属于右侧文件管理器，不能重新内联到侧栏",
      );
      const treeRows = fileTree.getByRole("treeitem");
      await treeRows.first().waitFor({ state: "visible" });
      assert.ok(
        (await treeRows.first().getAttribute("data-testid")).startsWith(
          `workspace-file-tree-row-${workspacePath}/`,
        ),
        "文件树必须读取指定隔离工作区，不能读取其它项目",
      );
      await treeRows
        .first()
        .evaluate((row) => row.scrollIntoView({ block: "nearest", inline: "nearest" }));
      await assertVerticalScroll(fileTree.getByRole("tree").locator(".."), "外部文件树");
      await assertAligned();
      await assertVerticalScroll(list, "文件管理器打开时的侧栏列表");
      await closeOpenedTab();
      await assertAligned();
      await assertVerticalScroll(list, "关闭新增标签后的侧栏列表");
      assert.deepEqual((await tabIds()).sort(), [...originalTabs].sort(), "既有标签集合必须保留");
    }
    await sidebar.getByTestId("login-trigger").click();
    assert.equal(await sidebar.getByTestId("login-trigger").getAttribute("aria-expanded"), "true");
    await page.keyboard.press("Escape");
    await assertAligned();
    console.log(
      JSON.stringify({
        sidebarLayout: "passed",
        singleNavigationPanel: "passed",
        externalFileTreeRoundTrips: 2,
        sidebarAndTreeWheelScroll: "passed",
        accountMenu: "passed",
        preservedOriginalTabs: originalTabs.length,
      }),
    );
  } finally {
    await closeOpenedTab();
    if (originalActiveTabId) {
      await page.locator(`[data-side-pane-tab-id=${JSON.stringify(originalActiveTabId)}]`).click();
    }
  }
} finally {
  await browser.close();
}
