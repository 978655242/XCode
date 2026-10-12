import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// XCODE: 用真实工作区验证浏览器滚动/焦点行为，不靠 class 文本断言布局正确。
const browser = await chromium.connectOverCDP(process.argv[2] ?? "http://127.0.0.1:9229");
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((candidate) => candidate.url().includes("supportsSettings=true"));
assert.ok(page, "需要已打开工作区的桌面开发窗口");
const sidebar = page.getByTestId("sidebar");
const fileTree = page.getByTestId("workspace-file-tree-panel");
const geometry = () =>
  sidebar.evaluate((element) => {
    const viewport = element.children[1];
    const bounds = element.getBoundingClientRect();
    const nav = element.querySelector('[data-testid="task-new-button"]');
    const footer = element.querySelector("footer");
    const inside = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right;
    };
    return {
      scrollLeft: viewport.scrollLeft,
      navigationInside: inside(nav),
      footerInside: inside(footer),
    };
  });
const assertAligned = async () =>
  assert.deepEqual(
    await geometry(),
    {
      scrollLeft: 0,
      navigationInside: true,
      footerInside: true,
    },
    "导航/账号必须留在侧栏内，动画视口不得横向滚动",
  );
try {
  await sidebar.waitFor({ state: "visible" });
  await sidebar.evaluate((element) => {
    const viewport = element.children[1];
    viewport.scrollLeft = 0;
    viewport.children[1].scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  await assertAligned();
  for (let round = 0; round < 2; round += 1) {
    await sidebar.locator('[data-testid^="workspace-item-"]').first().hover();
    await sidebar.locator('[data-testid^="workspace-file-tree-button-"]').first().click();
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-testid="workspace-file-tree-panel"]');
      const sidebarElement = document.querySelector('[data-testid="sidebar"]');
      return (
        panel &&
        panel.parentElement.getAttribute("aria-hidden") === "false" &&
        panel.getBoundingClientRect().left === sidebarElement.getBoundingClientRect().left
      );
    });
    const listFocus = await sidebar.evaluate((element) => {
      const button = element.querySelector('[data-testid="automations-open"]');
      button.focus();
      return document.activeElement === button;
    });
    assert.equal(listFocus, false, "文件树打开时隐藏列表不得接收焦点");
    await fileTree.locator("button").first().click();
    await page.waitForFunction(() => {
      const sidebarElement = document.querySelector('[data-testid="sidebar"]');
      const list = sidebarElement.children[1].children[0];
      return (
        list.getAttribute("aria-hidden") === "false" &&
        list.getBoundingClientRect().left === sidebarElement.getBoundingClientRect().left
      );
    });
    const treeFocus = await fileTree.evaluate((element) => {
      const button = element.querySelector("button");
      button.focus();
      return document.activeElement === button;
    });
    assert.equal(treeFocus, false, "返回列表后隐藏文件树不得接收焦点");
    await sidebar.evaluate((element) => {
      const viewport = element.children[1];
      viewport.children[1].scrollIntoView({ block: "nearest", inline: "nearest" });
      viewport.scrollLeft = 54.5;
    });
    await assertAligned();
  }
  await sidebar.getByTestId("login-trigger").click();
  await page.keyboard.press("Escape");
  await assertAligned();
  console.log(
    JSON.stringify({
      sidebarLayout: "passed",
      hiddenPanelFocus: "passed",
      fileTreeRoundTrips: 2,
      accountMenu: "passed",
    }),
  );
} finally {
  if (await fileTree.count()) {
    await fileTree.evaluate((element) => {
      if (element.parentElement.getAttribute("aria-hidden") === "false")
        element.querySelector("button").click();
    });
  }
  await sidebar.evaluate((element) => {
    element.children[1].scrollLeft = 0;
  });
  await browser.close();
}
