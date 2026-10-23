import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { readRemoteTabSnapshot, selectSSHRemoteDirectory } from "#e2e/helpers/ssh-remote-p0";
import { readProjectTaskRowState } from "#e2e/helpers/project-sidebar";
import type * as ProjectSidebar from "#e2e/helpers/project-sidebar";

vi.mock("#e2e/helpers/desktop-app", () => ({ waitForWorkspaceApp: vi.fn() }));
vi.mock("#e2e/helpers/project-sidebar", async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectSidebar>()),
  selectRemoteProjectDirectory: vi.fn(),
}));
vi.mock("#e2e/helpers/custom-openai-provider-store", () => ({}));
afterEach(() => vi.unstubAllGlobals());

// XCODE: 同路径项目按精确身份返回，失败页分支也不能丢失项目归属或重复建草稿。
it.each([
  [false, true, false],
  [true, true, false],
  [false, false, false],
  [true, false, false],
  [true, true, true],
  [true, false, true],
])(
  "同路径第二个 Source 按新项目 identity 等待，预选目录编辑器=%s，等待关闭=%s，缺少身份=%s",
  async (prefilledEditor, waitForDialogClose, missingIdentity) => {
    const first = "remote:server:11111111-1111-4111-8111-111111111111:/work";
    const second = "remote:server:22222222-2222-4222-8222-222222222222:/work";
    const projectIds = ["existing"];
    let activeIdentity = first;
    let switching = false;
    let reads = 0;
    let draftCreations = 0;
    const document = {
      querySelectorAll: () => projectIds.map((id) => ({ getAttribute: () => id })),
    };
    const window = {
      __zcodeTabStoreE2E: {
        getState: () => {
          if (switching && ++reads > 1) activeIdentity = second;
          return {
            activeWorkspaceIdentity: activeIdentity,
            activeWorkspacePath: "/work",
            tabs: [first, second].map((identity) => ({
              workspaceIdentity: identity,
              workspacePath: "/work",
              remoteSessionId: identity === first ? "first-session" : "second-session",
              remoteTarget: { kind: "ssh", host: "127.0.0.1" },
            })),
          };
        },
      },
    };
    vi.stubGlobal("$", (selector: string) => {
      if (selector === '[data-testid="ssh-success"]') return { isExisting: async () => false };
      if (selector === '[data-testid="remote-project-new"]') {
        if (prefilledEditor) throw new Error("已在预选目录编辑器，不存在新建项目列表按钮");
        return { waitForEnabled: vi.fn(), click: vi.fn() };
      }
      if (selector === '[data-testid="virtual-project-name"]')
        return { setValue: vi.fn(), isDisplayed: async () => prefilledEditor };
      if (selector === '[data-testid="virtual-project-root-name"]')
        return { getAttribute: async () => "/work", isExisting: async () => true };
      if (selector === '[data-testid="virtual-project-directory-browser"]')
        return { isDisplayed: async () => false };
      if (selector === '[data-testid="virtual-project-save"]') return { click: vi.fn() };
      if (selector === '[data-testid="project-folder-trust-confirm"]')
        return { waitForDisplayed: vi.fn(), click: () => projectIds.push("new") };
      if (selector === '[data-testid="settings-back-button"]')
        return { isDisplayed: async () => false };
      if (selector === '[data-project-id="new"]')
        return {
          getAttribute: async () => (missingIdentity ? "" : second),
          moveTo: vi.fn(),
          $: () => ({
            click: () => {
              switching = true;
              draftCreations += 1;
            },
          }),
        };
      throw new Error(`Unexpected selector: ${selector}`);
    });
    vi.stubGlobal("browser", {
      execute: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        runInNewContext(`(${fn.toString()})(...args)`, { args, document, window }),
      waitUntil: async (predicate: () => Promise<boolean>) => {
        for (let attempt = 0; attempt < 3; attempt++) if (await predicate()) return;
        throw new Error("Second Source did not become active");
      },
    });

    const selection = selectSSHRemoteDirectory("/work", "E2E_SOURCE_SELECTION", {
      waitForDialogClose,
    });
    if (missingIdentity) {
      await expect(selection).rejects.toThrow("新远程项目缺少 workspace identity");
      expect(draftCreations).toBe(0);
      return;
    }
    const selected = await selection;
    expect(selected).toEqual({ projectId: "new", workspaceIdentity: second });
    expect(draftCreations).toBe(1);
    expect(activeIdentity).toBe(waitForDialogClose ? second : first);
  },
);

it("远程任务必须同时匹配项目 ID 与 workspace identity，本地仍按原目录项目定位", async () => {
  const row = {
    dataset: { testid: "task-item-remote-task" },
    classList: { contains: (name: string) => name === "bg-selected" },
    querySelector: () => null,
  };
  const document = {
    querySelectorAll: () => [row],
    querySelector: (selector: string) =>
      selector ===
        'section[data-project-id="new"][data-project-workspace-identity="remote:server:source-b:/work"]' ||
      selector === '[data-project-id][data-project-name="work"]'
        ? { contains: (element: unknown) => element === row }
        : null,
  };
  vi.stubGlobal("browser", {
    execute: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      runInNewContext(`(${fn.toString()})(...args)`, { args, document }),
  });
  expect(
    await readProjectTaskRowState("remote-task", {
      projectId: "new",
      workspaceIdentity: "remote:server:source-b:/work",
    }),
  ).toMatchObject({ exists: true, inProject: true, active: true, error: false, running: false });
  expect(
    (
      await readProjectTaskRowState("remote-task", {
        projectId: "existing",
        workspaceIdentity: "remote:server:source-b:/work",
      })
    ).inProject,
  ).toBe(false);
  expect(
    (
      await readProjectTaskRowState("remote-task", {
        projectId: "new",
        workspaceIdentity: "remote:server:source-a:/work",
      })
    ).inProject,
  ).toBe(false);
  expect((await readProjectTaskRowState("remote-task", "/work")).inProject).toBe(true);
});

it("无筛选条件时读取当前激活工作区，不能把不存在的路径当作无远程会话", async () => {
  const state = {
    activeWorkspaceIdentity: "remote:server:source-b:/work",
    activeWorkspacePath: "/work",
    tabs: [
      {
        workspaceIdentity: "remote:server:source-a:/work",
        workspacePath: "/work",
        remoteSessionId: "a",
      },
      {
        workspaceIdentity: "remote:server:source-b:/work",
        workspacePath: "/work",
        remoteSessionId: "b",
        remoteTarget: { kind: "ssh" },
      },
    ],
  };
  vi.stubGlobal("browser", {
    execute: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      runInNewContext(`(${fn.toString()})(...args)`, {
        args,
        window: { __zcodeTabStoreE2E: { getState: () => state } },
      }),
  });
  expect(await readRemoteTabSnapshot()).toMatchObject({
    remoteSessionId: "b",
    workspaceIdentity: state.activeWorkspaceIdentity,
  });
  state.activeWorkspaceIdentity = "";
  state.activeWorkspacePath = "/local";
  expect((await readRemoteTabSnapshot()).remoteSessionId).toBeNull();
  expect((await readRemoteTabSnapshot("remote:server:source-a:/work")).remoteSessionId).toBe("a");
});
