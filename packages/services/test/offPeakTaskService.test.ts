// XCODE: Aiscoo 专属回归；上游 App 业务套件已退役，仅保留下游差异的断言。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OffPeakTaskRepo } from "../src/session/offPeakTaskRepo.js";
import { OffPeakTaskService } from "../src/session/offPeakTaskService.js";
import {
  type OffPeakBatchStatusResult,
  type OffPeakServerClient,
  type OffPeakTakeTicketResult,
  type OffPeakOwnerFence,
} from "../src/session/offPeakServerClient.js";
import { setDataBaseDir } from "../src/paths.js";
import { createServiceLogger } from "../src/logger/serviceLogger.js";
import { OffPeakCodingPlanUnavailableError } from "../src/session/offPeakRuntimeModel.js";

const NOW = 1_700_000_000_000;
const logger = createServiceLogger("off-peak-service-test", {
  isDebugEnabled: false,
});

/** 可编程假客户端：按序出票 / 定制批量状态应答。 */
class FakeClient implements OffPeakServerClient {
  takeCalls: string[] = [];
  settleCalls: string[] = [];
  statusCalls: string[][] = [];
  nextTicketState: OffPeakTakeTicketResult["state"] = "queued";
  takeError: Error | null = null;
  settleError: Error | null = null;
  statusResponse: OffPeakBatchStatusResult = { tickets: [] };
  private ticketSeq = 0;

  async captureOwnerFence() {
    return async () => {};
  }

  async getTakeNumberAvailability() {
    return { canTakeNumber: true };
  }

  async takeTicket(taskId: string): Promise<OffPeakTakeTicketResult> {
    this.takeCalls.push(taskId);
    if (this.takeError) throw this.takeError;
    this.ticketSeq += 1;
    return {
      ticketId: `t-${this.ticketSeq}`,
      state: this.nextTicketState,
      position: 3,
      nextPollAfterMs: 5000,
      registeredAt: NOW,
    };
  }

  async batchStatus(ticketIds: string[]): Promise<OffPeakBatchStatusResult> {
    this.statusCalls.push(ticketIds);
    return this.statusResponse;
  }

  async settle(
    ticketId: string,
    assertCurrent?: OffPeakOwnerFence,
  ): Promise<void> {
    await assertCurrent?.();
    this.settleCalls.push(ticketId);
    if (this.settleError) throw this.settleError;
  }
}

describe("Aiscoo OffPeak owner and expiry", () => {
  let tempDir: string | null = null;
  let repo: OffPeakTaskRepo;
  let client: FakeClient;
  let service: OffPeakTaskService;
  let wakes: number;
  let stops: Array<{ conversationId: string }>;

  const makeService = (
    prepareProjectExecution?: (
      projectId: string,
    ) => Promise<import("@zcode/shared").ProjectExecutionSnapshot>,
  ) =>
    new OffPeakTaskService({
      repo,
      client,
      prepareProjectExecution,
      logger,
      resolveCodingPlanSupport: async () => ({
        supported: true,
        kind: "bigmodel-personal",
        providerFamily: "bigmodel",
        providerId: "account:bigmodel-individual-coding-plan",
        selectedConnectionKey:
          "coding-plan:account:bigmodel-individual-coding-plan",
      }),
      resolveTelemetryProviderName: async () => "api.example.com",
      resolveModelSelection: async ({ modelId, reasoningLevel }) => ({
        ok: true as const,
        selection: {
          providerId: "account:zai-offpeak-idle-plan",
          modelId: modelId ?? "GLM-5.2",
          ...(reasoningLevel ? { options: { reasoningLevel } } : {}),
        },
      }),
      requestSchedulerWake: () => {
        wakes += 1;
      },
      stopRunningTask: async (params) => {
        stops.push({ conversationId: params.conversationId });
      },
      now: () => NOW,
    });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "zcode-off-peak-service-"));
    setDataBaseDir(tempDir);
    repo = new OffPeakTaskRepo();
    client = new FakeClient();
    wakes = 0;
    stops = [];
    service = makeService();
  });

  afterEach(() => {
    service.stopSync();
    repo.close();
    setDataBaseDir(null);
    vi.useRealTimers();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  const createParams = {
    title: "夜间重构",
    prompt: "抽取公共函数",
    permissionMode: "default",
    modelSelection: {
      providerId: "account:zai-offpeak-idle-plan",
      modelId: "GLM-5.2",
      options: { reasoningLevel: "max" },
    },
    workspacePath: "/tmp/ws",
  };

  const createTask = async () => {
    const result = await service.createTask(createParams);
    expect(result.ok).toBe(true);
    if (!result.ok)
      throw new Error("expected successful test fixture creation");
    return result.task;
  };

  it("ticket-release outbox keeps its captured owner and never settles an old ticket as the next account", async () => {
    let current = true;
    const check = () => {
      if (!current)
        throw new OffPeakCodingPlanUnavailableError("selection_changed");
    };
    const fence = Object.assign(async () => check(), {
      assertCurrentSync: check,
    });
    let networkCalls = 0;
    const settle = vi
      .spyOn(client, "settle")
      .mockImplementation(async (_ticket, assertCurrent) => {
        expect(assertCurrent).toBe(fence);
        await assertCurrent?.();
        networkCalls++;
        throw new Error("temporary network failure");
      });
    await service.residentExecutions.discardTicket("old-owner-ticket", fence);
    expect(networkCalls).toBe(1);
    current = false;
    await service.runSyncCycle();
    expect(networkCalls).toBe(1);
    expect(settle).toHaveBeenCalledTimes(2);
    await service.runSyncCycle();
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it("fails an expired running ticket without automatically retaking it", async () => {
    const task = await createTask();
    await repo.markRunning(task.offPeakTaskId, {
      startedAt: NOW,
      conversationId: "conversation",
      sessionId: "session",
    });
    await service.handleTicketExpiredDuringRun(task.offPeakTaskId);
    expect((await repo.get(task.offPeakTaskId))?.status).toBe("failed");
    expect(client.takeCalls).toEqual([task.offPeakTaskId]);
    expect(client.settleCalls).toEqual([task.serverTicketId]);
    expect(stops).toEqual([{ conversationId: "conversation" }]);
  });

  it("does not finish or settle a ticket after its captured Native owner is revoked", async () => {
    const task = await createTask();
    await repo.markRunning(task.offPeakTaskId, { startedAt: NOW });
    const before = await repo.get(task.offPeakTaskId);
    const check = () => {
      throw new OffPeakCodingPlanUnavailableError("selection_changed");
    };
    const fence = Object.assign(async () => check(), {
      assertCurrentSync: check,
    });
    await expect(
      service.handleTicketExpiredDuringRun(
        task.offPeakTaskId,
        () => true,
        fence,
      ),
    ).rejects.toThrow();
    expect(await repo.get(task.offPeakTaskId)).toEqual(before);
    expect(client.settleCalls).toEqual([]);
    expect(stops).toEqual([]);
  });

  it("an observed expired ticket cannot overwrite a manually continued replacement", async () => {
    const task = await createTask();
    await repo.updateSchedulingSnapshot(task.offPeakTaskId, {
      serverTicketId: "replacement",
      schedulable: true,
      now: NOW,
    });
    await service.handleTicketExpiredDuringRun(
      task.offPeakTaskId,
      () => true,
      undefined,
      task,
    );
    expect(await repo.get(task.offPeakTaskId)).toMatchObject({
      status: "queued",
      serverTicketId: "replacement",
      schedulable: true,
    });
    expect(client.takeCalls).toEqual([task.offPeakTaskId]);
    expect(client.settleCalls).toEqual([]);
    expect(stops).toEqual([]);
  });
});
