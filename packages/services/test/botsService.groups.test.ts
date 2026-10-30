// XCODE: Aiscoo 专属回归；上游 App 业务套件已退役，仅保留下游差异的断言。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotActor } from "@zcode/shared";
import { getZCodeAgentModeSelectOptions } from "@zcode/shared";
import * as f from "./botsService.fixtures.js";

const callbackTransport = vi.hoisted(() => ({
  enabled: false,
  send: vi.fn(async () => ({ providerMessageId: "om_notice" })),
}));
const directoryMock = vi.hoisted(() =>
  vi.fn(async (): Promise<Record<string, string>> => ({ ou_user: "Alice" })),
);
const reactionMock = vi.hoisted(() => vi.fn(async () => {}));
const cardCreateMock = vi.hoisted(() =>
  vi.fn(async () => ({ providerMessageId: "om_interaction" })),
);
const cardUpdateMock = vi.hoisted(() => vi.fn(async () => {}));
const historyMock = vi.hoisted(() =>
  vi.fn(async (_bot: unknown, request: { messageId: string }) => ({
    messages: [],
    checkpoint: request.messageId,
    hasGap: false,
  })),
);

vi.mock("../src/bots/providers/feishuProvider.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/bots/providers/feishuProvider.js")
    >();
  return {
    ...actual,
    createFeishuBotProvider: (
      ...args: Parameters<typeof actual.createFeishuBotProvider>
    ) => ({
      ...actual.createFeishuBotProvider(...args),
      ...(callbackTransport.enabled
        ? {
            prepareCallbackPayload: async (_bot: unknown, payload: unknown) =>
              payload,
            handleCallbackResponse: undefined,
            resolveActorDisplayName: undefined,
            acknowledgeCallback: vi.fn(async () => undefined),
            send: callbackTransport.send,
          }
        : {}),
      getGroupMemberNames: directoryMock,
      readTopicHistory: historyMock,
      updateInputReaction: reactionMock,
      updateTransientInteractionCard: cardUpdateMock,
      createTransientInteractionCard: cardCreateMock,
      getGroupInfo: vi.fn(async () => ({ name: "测试群" })),
    }),
  };
});

const services: Array<ReturnType<typeof f.createBotsService>> = [];
afterEach(async () => {
  callbackTransport.enabled = false;
  callbackTransport.send.mockClear();
  directoryMock.mockClear();
  reactionMock.mockClear();
  cardUpdateMock.mockClear();
  cardCreateMock.mockClear();
  historyMock.mockClear();
  for (const service of services.splice(0)) await service.disposeAllAndWait();
});

function setup(
  uniqueTaskIds = false,
  modelUnavailable = false,
  remoteConnection?: { connected: boolean },
) {
  const repo = f.createMemoryRepo(structuredClone(f.feishuConfig));
  const taskService = f.createLegacyTaskService();
  if (uniqueTaskIds) {
    // 通用夹具固定返回 task-1，会掩盖跨话题任务校验；隔离用例必须分配不同任务。
    const createTask = taskService.createTask;
    let taskSequence = 0;
    taskService.createTask = vi.fn(async () => ({
      ...(await createTask()),
      taskId: `topic-task-${++taskSequence}`,
    }));
  }
  taskService.invalidateBotTopicInputs = vi.fn(async () => undefined);
  taskService.readBotTopicExecution = vi.fn(async () => undefined);
  taskService.stopBotTopicExecution = vi.fn(async () => undefined);
  taskService.submitBotGroupInput = vi.fn(async (params) => ({
    commandId: params.commandId,
    status: "accepted",
    revisionAtDecision: 1,
    result: {
      type: "inputAccepted",
      inputId: params.commandId,
      delivery: "queue",
    },
  }));
  const service = f.createBotsService({
    zcodeTaskService: taskService,
    repo: repo as never,
    credentialService: f.createCredentialService({}),
    runStartupBackgroundTasks: false,
    ...(remoteConnection
      ? {
          remoteWorkspaceService: {
            isConnected: vi.fn(async () => remoteConnection.connected),
            ensureConnected: vi.fn(async () => ({
              ok: remoteConnection.connected,
            })),
            getZCodeTaskService: vi.fn(async () => taskService),
            getModelSelectionService: vi.fn(async () =>
              f.createModelSelectionService([
                { id: "glm", name: "GLM", models: ["default"] },
              ]),
            ),
          },
        }
      : {}),
    ...(modelUnavailable
      ? { modelSelectionService: { getView: vi.fn(async () => null) } as never }
      : {}),
  });
  services.push(service);
  const send = (
    text: string,
    chatId = "oc_a",
    userId = "ou_user",
    threadId?: string,
  ) => {
    const actor: BotActor = {
      provider: "feishu",
      botId: "feishu-1",
      chatType: "group",
      chatId,
      threadId,
      ...(threadId
        ? { rootMessageId: `root_${threadId}`, topicTitle: threadId }
        : {}),
      providerUserId: userId,
      providerMessageId: `om_${text}_${userId}`,
    };
    return service.handleInboundMessage({ botId: actor.botId, actor, text });
  };
  return { repo, service, send, taskService };
}

describe("Aiscoo Bot group permission isolation", () => {
  it("applies only the owner's group draft mode to the newly created isolated session", async () => {
    const { send, repo, taskService } = setup(true);
    const modeOptions = getZCodeAgentModeSelectOptions();
    vi.mocked(taskService.getTaskConfigOptions).mockResolvedValue([
      {
        id: "mode",
        category: "mode",
        type: "select",
        currentValue: "build",
        options: modeOptions,
      },
    ]);
    await send("/enable");
    await send("/enable", "oc_b");
    const configBefore = structuredClone(await repo.readConfig());
    const otherBefore = structuredClone(
      (await repo.readState()).bots[JSON.stringify(["feishu-1", "oc_b"])],
    );
    const groupKey = JSON.stringify(["feishu-1", "oc_a"]);
    const menu = await send("/mode");
    expect(
      menu.flatMap(
        (reply) => reply.selection?.options.map((option) => option.id) ?? [],
      ),
    ).toEqual(modeOptions.map((option) => option.value));
    expect((await send("/mode yolo", "oc_a", "member"))[0]?.text).toContain(
      "绑定",
    );
    expect((await repo.readState()).bots[groupKey]?.draftOptions?.mode).toBe(
      "default",
    );
    await send("/mode not-a-mode");
    expect((await repo.readState()).bots[groupKey]?.draftOptions?.mode).toBe(
      "default",
    );
    const modeReply = await send("/mode yolo");
    expect(modeReply.length).toBeGreaterThan(0);
    expect(modeReply.map((reply) => reply.text)).toEqual(
      (await send("/status")).map((reply) => reply.text),
    );
    expect((await repo.readState()).bots[groupKey]?.draftOptions?.mode).toBe(
      "yolo",
    );
    // XCODE: 模型没有 reasoning 配置时，权限选择也必须在真实建任务边界保留且只作用于本群。
    await send("owner-selected-mode", "oc_a", "member");
    const selectedTaskId = (await repo.readState()).bots[groupKey]!
      .activeTaskId!;
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ permissionScope: "session" }),
    );
    expect(taskService.setMode).toHaveBeenCalledWith({
      taskId: selectedTaskId,
      mode: "yolo",
    });
    expect(
      (await repo.readState()).bots[JSON.stringify(["feishu-1", "oc_b"])],
    ).toEqual(otherBefore);
    await send("other-group-input", "oc_b", "member");
    const otherTaskId = (await repo.readState()).bots[
      JSON.stringify(["feishu-1", "oc_b"])
    ]!.activeTaskId!;
    expect(otherTaskId).not.toBe(selectedTaskId);
    expect(taskService.setMode).toHaveBeenLastCalledWith({
      taskId: otherTaskId,
      mode: "default",
    });
    expect(await repo.readConfig()).toEqual(configBefore);
    expect(taskService.setConfigOption).not.toHaveBeenCalled();
  });

  it("keeps the group permission menu available without a model selection view", async () => {
    const { send, repo, taskService } = setup(false, true);
    await send("/enable");
    const menu = await send("/mode");
    expect(
      menu.flatMap(
        (reply) => reply.selection?.options.map((option) => option.id) ?? [],
      ),
    ).toEqual(getZCodeAgentModeSelectOptions().map((option) => option.value));
    const modeReply = await send("/mode yolo");
    expect(modeReply.map((reply) => reply.text)).toEqual(
      (await send("/status")).map((reply) => reply.text),
    );
    expect(
      (await repo.readState()).bots[JSON.stringify(["feishu-1", "oc_a"])]
        ?.draftOptions?.mode,
    ).toBe("yolo");
    expect(taskService.createTask).not.toHaveBeenCalled();
  });
});
