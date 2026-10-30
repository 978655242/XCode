import { readFile } from "node:fs/promises";
import ts from "typescript";
import { OFF_PEAK_PROVIDER_IDS } from "@zcode/shared";
import { beforeAll, expect, it, vi } from "vitest";
import { OFF_PEAK_TASK_OWNER_FENCE, OffPeakModelUnavailableError } from "@zcode/services/node";
import {
  assertBoundSessionDispatchable,
  resolveOffPeakDispatchKind,
} from "../src/host/offPeakDispatchPlan.js";

let createDispatch: (
  dependencies: Record<string, unknown>,
) => (request: Record<string, unknown>) => Promise<unknown>;

beforeAll(async () => {
  // 只装载真实派发函数，隔离 host/index 的进程启动副作用；不复制一份派发算法测试自己。
  const path = new URL("../src/host/index.ts", import.meta.url);
  const source = ts.createSourceFile(
    path.pathname,
    await readFile(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "dispatchOffPeakRun",
  );
  if (!declaration) throw new Error("Missing production dispatchOffPeakRun");
  const code = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  createDispatch = (dependencies) =>
    new Function(...Object.keys(dependencies), `${code}; return dispatchOffPeakRun;`)(
      ...Object.values(dependencies),
    );
});

function setup() {
  const service = {
    listDeletedTaskIds: vi.fn(async (): Promise<string[]> => []),
    // tasks-index 行的 status 只镜像 CLI 终态，运行中只能来自 syncer 的活动集合。
    listActiveTaskIds: vi.fn(async (): Promise<string[]> => []),
    resumeTask: vi.fn(async () => {}),
    setConfigOption: vi.fn(async () => {}),
    createTask: vi.fn(async (_params: Record<string, unknown>) => ({
      taskId: "new",
      traceId: "trace-new",
    })),
    sendPrompt: vi.fn(async () => {}),
  };
  const ownerFence = Object.assign(
    vi.fn(async () => {}),
    { assertCurrentSync: vi.fn() },
  );
  const runtime = {
    service: {
      // XCODE: 驻留执行交接仍须保留 Native 账号 owner 栅栏。
      [OFF_PEAK_TASK_OWNER_FENCE]: vi.fn(async () => ownerFence),
      residentExecutions: {
        has: vi.fn(() => false),
        retakeGuard: vi.fn(() => () => true),
        isUserOwned: vi.fn(() => false),
        discardTicket: vi.fn(async () => {}),
        deliverTicket: vi.fn(async () => undefined as { sessionId: string } | undefined),
      },
    },
    validateSelection: vi.fn(async () => true),
    buildRequestAuth: vi.fn(async () => ({ apiKey: "test-ticket-auth" })),
  };
  const dispose = vi.fn();
  const admitted = vi.fn();
  const track = vi.fn(() => ({ admitted }));
  const repo = {
    get: vi.fn(async () => ({ status: "queued", conversationId: "bound" })),
    markRunning: vi.fn(async () => ({})),
    requeueForContinuation: vi.fn(async () => ({})),
  };
  const report = vi.fn();
  const dispatch = createDispatch({
    activeServices: { getOptional: () => service },
    reportHostSessionCreate: report,
    parentPort: {},
    IZCodeTaskService: Symbol("task-service"),
    IZCodeAgentService: Symbol("agent-service"),
    offPeakTaskRepo: repo,
    isOffPeakTerminalStatus: (status: string) =>
      ["completed", "failed", "cancelled"].includes(status),
    ensureOffPeakRuntime: async () => runtime,
    OFF_PEAK_TASK_OWNER_FENCE,
    OffPeakModelUnavailableError,
    resolveOffPeakDispatchKind,
    assertBoundSessionDispatchable,
    randomUUID: () => "run-1",
    OFF_PEAK_RESUME_PROMPT: "resume prompt",
    offPeakRunSubscriptionKey: (taskId: string, traceId: string) => `${taskId}:${traceId}`,
    trackOffPeakRunOutcome: track,
    disposeOffPeakRunSubscription: dispose,
  });
  const modelSelection = {
    providerId: OFF_PEAK_PROVIDER_IDS.bigmodel,
    modelId: "GLM-5.2",
    options: { reasoningLevel: "high" },
  };
  const request = {
    offPeakTaskId: "idle-1",
    prompt: "task prompt",
    permissionMode: "yolo",
    modelSelection,
    sessionId: "bound",
    serverTicketId: "ticket-1",
    workspacePath: "/project",
    workspaceIdentity: "remote:ssh:test:/project",
  };
  return {
    service,
    runtime,
    ownerFence,
    dispose,
    track,
    report,
    dispatch,
    request,
    admitted,
    repo,
  };
}

it("rejects a stale owner before dispatching or writing session config", async () => {
  const state = setup();
  const staleOwner = new Error("stale owner");
  state.ownerFence.assertCurrentSync.mockImplementation(() => {
    throw staleOwner;
  });
  await expect(state.dispatch(state.request)).rejects.toBe(staleOwner);
  expect(state.runtime.buildRequestAuth).not.toHaveBeenCalled();
  expect(state.service.resumeTask).not.toHaveBeenCalled();
  expect(state.service.setConfigOption).not.toHaveBeenCalled();
  expect(state.service.createTask).not.toHaveBeenCalled();
  expect(state.service.sendPrompt).not.toHaveBeenCalled();
});

it("does not admit a run whose owner changes while sendPrompt is pending", async () => {
  const state = setup();
  const staleOwner = new Error("stale owner after send");
  state.service.sendPrompt.mockImplementation(async () => {
    state.ownerFence.assertCurrentSync.mockImplementation(() => {
      throw staleOwner;
    });
  });
  await expect(state.dispatch(state.request)).rejects.toBe(staleOwner);
  expect(state.repo.markRunning).not.toHaveBeenCalled();
  expect(state.admitted).not.toHaveBeenCalled();
  expect(state.report).not.toHaveBeenCalled();
  expect(state.dispose).toHaveBeenCalledWith("bound:idle-1:bound:run-1");
});

it("rejects an owner change while building resident ticket auth before handoff", async () => {
  const state = setup();
  const staleOwner = new Error("stale owner during resident auth");
  state.runtime.service.residentExecutions.has.mockReturnValue(true);
  state.runtime.buildRequestAuth.mockImplementation(async () => {
    state.ownerFence.assertCurrentSync.mockImplementation(() => {
      throw staleOwner;
    });
    return { apiKey: "test-ticket-auth" };
  });
  await expect(state.dispatch(state.request)).rejects.toBe(staleOwner);
  expect(state.runtime.service.residentExecutions.deliverTicket).not.toHaveBeenCalled();
  expect(state.repo.markRunning).not.toHaveBeenCalled();
  expect(state.repo.requeueForContinuation).not.toHaveBeenCalled();
  expect(state.service.sendPrompt).not.toHaveBeenCalled();
});

it("keeps the owner fence on resident ticket handoff and out of worker auth", async () => {
  const state = setup();
  const assertCurrent = vi.fn(async () => {});
  state.runtime.service.residentExecutions.has.mockReturnValue(true);
  state.runtime.buildRequestAuth.mockImplementation(async () => ({
    apiKey: "test-ticket-auth",
    assertCurrent,
  }));
  state.runtime.service.residentExecutions.deliverTicket.mockResolvedValue({
    sessionId: "bound",
  });
  await expect(state.dispatch(state.request)).resolves.toMatchObject({ sessionId: "bound" });
  expect(assertCurrent).toHaveBeenCalled();
  expect(state.repo.markRunning).toHaveBeenCalledWith(
    "idle-1",
    expect.objectContaining({ assertCurrent: state.ownerFence }),
  );
  expect(state.runtime.service.residentExecutions.deliverTicket).toHaveBeenCalledWith(
    "idle-1",
    "ticket-1",
    { apiKey: "test-ticket-auth" },
  );
});
