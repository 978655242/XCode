/* eslint-disable max-lines -- off-peak 任务编排服务集中维护 创建/取消/暂停/继续/删除、
   轮询同步（offPeakTaskSync）、终态核销 outbox 与 3102 续跑重取号，稳定后再按职责拆分。 */
/* off-peak 任务编排服务（host 域，仿 automationService 形态）。
   职责：
   - 创建即取号（POST /ticket 成功才落库，§4.1）；3103/3101 抛类型化错误给 UI
   - 取消/暂停/继续/删除/编辑 的状态守卫编排（D29-3/D30-7/D30-10）
   - offPeakTaskSync：有非终态任务才批量轮询 /ticket/status（轮询触发服务端晋级，D25/D26），
     写回 schedulable/位次/next_poll_at；expired 且非 paused → 同 task_id 自动重取号（D26/D27）
   - 终态核销 outbox：终态即 settle、失败随轮询周期捎带补报、启动扫描（D22/§7.7）
   - CLI ticket_needed 生命周期通知经同一驻留 owner 回队续票，不以主轮终态推断后台完成。 */
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  isOffPeakTerminalStatus,
  resolveWorkspaceKey,
  type ProjectExecutionSnapshot,
  type OffPeakCodingPlanSupport,
  type OffPeakTaskCreateErrorCategory,
  type OffPeakTaskCreateFailureStage,
  type OffPeakTaskCreateResult,
  type ZCodeOffPeakTask,
  type ZCodeOffPeakTaskCreateParams,
} from "@zcode/shared";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import { isOffPeakBoundSessionConflict, type OffPeakTaskRepo } from "./offPeakTaskRepo.js";
import type { IOffPeakTaskService, OffPeakUpdateTaskParams } from "./offPeakTask.js";
import {
  OffPeakServerError,
  type OffPeakServerClient,
  type OffPeakOwnerFence,
} from "./offPeakServerClient.js";
import { OffPeakCodingPlanUnavailableError } from "./offPeakRuntimeModel.js";
import type { ModelSelection, ModelSelectionValidation } from "@zcode/provider";
import { OffPeakResidentExecutions } from "./offPeakResidentExecutions.js";

/** 轮询下限/上限与失败退避（服务端 next_poll_after 优先，钳制防打爆/防饿死）。 */
export const OFF_PEAK_SYNC_MIN_INTERVAL_MS = 5_000;
export const OFF_PEAK_SYNC_MAX_INTERVAL_MS = 5 * 60_000;
const SYNC_FAILURE_BASE_MS = 10_000;

export interface OffPeakTaskServiceDeps {
  repo: OffPeakTaskRepo;
  prepareProjectExecution?: (projectId: string) => Promise<ProjectExecutionSnapshot>;
  client: OffPeakServerClient;
  /** 与 ticket/runtime 共用 resolver 后的脱敏结果，供 renderer 创建门控。 */
  resolveCodingPlanSupport: () => Promise<OffPeakCodingPlanSupport>;
  /** 只返回安全 hostname；解析失败返回空串，不能影响创建业务结果。 */
  resolveTelemetryProviderName: () => Promise<string>;
  /** 用当前完整 Registry 解析并校验固定 Off-Peak Provider 的选择。 */
  resolveModelSelection: (input: {
    readonly modelId?: string;
    readonly reasoningLevel?: string;
  }) => Promise<
    | { readonly ok: true; readonly selection: ModelSelection }
    | { readonly ok: false; readonly validation: ModelSelectionValidation }
  >;
  logger: ServiceLogger;
  /** schedulable 翻 1 后立即唤醒 scheduler tick（缺省等 20s 轮询）。 */
  requestSchedulerWake?: () => void;
  /** 取消 running 任务时中止其 agent loop（host 注入；best-effort）。 */
  stopRunningTask?: (params: {
    conversationId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }) => Promise<void>;
  /** 列表变化广播钩子（UI 刷新）。 */
  onTasksChanged?: () => void;
  /** 测试注入时钟。 */
  now?: () => number;
  /** disposeAll 附加清理（如关闭 mock 网关）。 */
  onDispose?: () => void;
}

const VALID_CREATE_PERMISSION_MODES = new Set([
  "default",
  "yolo",
  "guarded",
  "plan",
  "edit",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "autoEdit",
  "build",
]);

function isValidCreateParams(params: ZCodeOffPeakTaskCreateParams): boolean {
  return (
    typeof params.title === "string" &&
    params.title.trim().length > 0 &&
    typeof params.prompt === "string" &&
    params.prompt.trim().length > 0 &&
    ((typeof params.projectId === "string" && params.projectId.trim().length > 0) ||
      (typeof params.workspacePath === "string" && params.workspacePath.trim().length > 0)) &&
    typeof params.permissionMode === "string" &&
    VALID_CREATE_PERMISSION_MODES.has(params.permissionMode)
  );
}

export function classifyOffPeakCreateFailure(
  error: unknown,
  failureStage: OffPeakTaskCreateFailureStage,
): Pick<
  Extract<OffPeakTaskCreateResult, { ok: false }>,
  "failureStage" | "errorCategory" | "errorCode"
> {
  let errorCategory: OffPeakTaskCreateErrorCategory = "unknown";
  let errorCode = "";
  if (failureStage === "client_validation") {
    errorCategory = "client_validation";
  } else if (failureStage === "local_persist") {
    errorCategory = "local_persist";
  } else if (error instanceof OffPeakServerError) {
    errorCode = error.bizCode === undefined ? "" : String(error.bizCode);
    if (error.bizCode === 3101) errorCategory = "eligibility_3101";
    else if (error.bizCode === 3103) errorCategory = "quota_3103";
  } else if (error instanceof ZodError) {
    errorCategory = "invalid_response";
  } else {
    // ticket client 内的 credential/RPC/fetch/abort 都可能以普通 Error 跨层抛出；
    // 它们仍属于 ticket_request，不能靠 raw message 猜测或泄漏服务端响应。
    errorCategory = "network";
  }
  return { failureStage, errorCategory, errorCode };
}

const OFF_PEAK_SESSION_BOUND_FAILURE = {
  failureStage: "client_validation",
  errorCategory: "client_validation",
  errorCode: "session_bound",
} as const;

/** Symbol-keyed because RPC dispatch accepts arbitrary string method names. */
export const OFF_PEAK_TASK_OWNER_FENCE = Symbol("offPeakTaskOwnerFence");

export class OffPeakTaskService implements IOffPeakTaskService {
  readonly residentExecutions: OffPeakResidentExecutions;
  private readonly retakes = new Map<string, Promise<void>>();
  // XCODE: 核销重试必须携带原 owner，换号后不能使用新账号释放旧票。
  private readonly releasedTicketOutbox = new Map<string, OffPeakOwnerFence>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncRunning = false;
  private syncStopped = true;
  private consecutiveSyncFailures = 0;

  constructor(private readonly deps: OffPeakTaskServiceDeps) {
    this.residentExecutions = new OffPeakResidentExecutions({
      renew: (taskId, current, assertCurrent) =>
        this.handleTicketExpiredDuringRun(taskId, current, assertCurrent),
      takeover: async (taskId, capturedFence) => {
        const assertCurrent = capturedFence ?? (await this[OFF_PEAK_TASK_OWNER_FENCE](taskId));
        await this.deps.repo.markRunning(taskId, { startedAt: this.now(), assertCurrent });
        await this.deps.repo.updateSchedulingSnapshot(taskId, {
          assertCurrent,
          schedulable: false,
          queuePosition: null,
          now: this.now(),
        });
        await assertCurrent();
        assertCurrent.assertCurrentSync?.();
        this.emitChanged();
      },
      release: (ticketId, assertCurrent) => this.releaseExecutionTicket(ticketId, assertCurrent),
    });
  }

  /** 释放票据不改变任务终态；失败捎带现有 sync 重试，不增加计时器或持久化凭据。 */
  private async releaseExecutionTicket(
    ticketId: string,
    capturedFence?: OffPeakOwnerFence,
  ): Promise<void> {
    const assertCurrent = capturedFence ?? (await this.deps.client.captureOwnerFence());
    this.releasedTicketOutbox.set(ticketId, assertCurrent);
    try {
      await this.deps.client.settle(ticketId, assertCurrent);
      this.releasedTicketOutbox.delete(ticketId);
    } catch (error) {
      if (
        (error instanceof OffPeakServerError && error.httpStatus < 500) ||
        (error instanceof OffPeakCodingPlanUnavailableError && error.reason === "selection_changed")
      )
        this.releasedTicketOutbox.delete(ticketId);
      else
        this.deps.logger.warn(
          `off-peak execution ticket release failed ticket=${ticketId}:`,
          error,
        );
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private emitChanged(): void {
    try {
      this.deps.onTasksChanged?.();
    } catch (error) {
      this.deps.logger.warn("off-peak onTasksChanged 回调失败:", error);
    }
  }

  // ---- 管理操作 ----

  async getCodingPlanSupport(): Promise<OffPeakCodingPlanSupport> {
    return this.deps.resolveCodingPlanSupport();
  }

  /** Host 派发前的窄检查；最终执行仍由目标 Agent ModelFactory 重新校验。 */
  async validateDispatchModelSelection(selection: ModelSelection): Promise<boolean> {
    const resolved = await this.deps.resolveModelSelection({
      modelId: selection.modelId,
      ...(selection.options?.reasoningLevel
        ? { reasoningLevel: selection.options.reasoningLevel }
        : {}),
    });
    return (
      resolved.ok &&
      resolved.selection.providerId === selection.providerId &&
      resolved.selection.modelId === selection.modelId
    );
  }

  async getTakeNumberAvailability() {
    const assertCurrent = await this.deps.client.captureOwnerFence();
    const availability = await this.deps.client.getTakeNumberAvailability(assertCurrent);
    await assertCurrent();
    assertCurrent.assertCurrentSync?.();
    return availability;
  }

  /** Trusted Host dispatch seam; never registered as a Renderer service method. */
  async [OFF_PEAK_TASK_OWNER_FENCE](offPeakTaskId: string): Promise<OffPeakOwnerFence> {
    const fence = await this.deps.client.captureOwnerFence();
    await this.deps.repo.assertTaskOwner(offPeakTaskId, fence);
    fence.assertCurrentSync?.();
    return fence;
  }

  /** 创建即取号（取号成功才落库）；失败只返回稳定分类，绝不跨 RPC 返回 raw error。 */
  async createTask(params: ZCodeOffPeakTaskCreateParams): Promise<OffPeakTaskCreateResult> {
    let providerName = "";
    try {
      providerName = await this.deps.resolveTelemetryProviderName();
    } catch {
      // provider_name 只是埋点维度；解析失败不得改变创建、toast 或任务执行。
    }
    if (!isValidCreateParams(params)) {
      return {
        ok: false,
        ...classifyOffPeakCreateFailure(undefined, "client_validation"),
        providerName,
      };
    }
    let assertCurrent: OffPeakOwnerFence;
    try {
      assertCurrent = await this.deps.client.captureOwnerFence();
    } catch (error) {
      return { ok: false, ...classifyOffPeakCreateFailure(error, "ticket_request"), providerName };
    }
    const selection = await this.deps.resolveModelSelection({
      modelId: params.modelSelection.modelId,
      ...(params.modelSelection.options?.reasoningLevel
        ? { reasoningLevel: params.modelSelection.options.reasoningLevel }
        : {}),
    });
    if (!selection.ok) {
      return {
        ok: false,
        ...classifyOffPeakCreateFailure(undefined, "client_validation"),
        providerName,
      };
    }
    let execution: ProjectExecutionSnapshot | undefined;
    if (params.projectId) {
      try {
        if (params.boundSessionId || !this.deps.prepareProjectExecution)
          throw new Error("project.creation-unavailable");
        execution = await this.deps.prepareProjectExecution(params.projectId);
      } catch (error) {
        return {
          ok: false,
          ...classifyOffPeakCreateFailure(error, "client_validation"),
          providerName,
        };
      }
    }
    const normalizedParams: ZCodeOffPeakTaskCreateParams = {
      ...params,
      ...execution,
      modelSelection: selection.selection,
    };
    // 绑定会话已有未终态任务即拒，先于取号避免浪费额度；
    // 并发穿过预检的一方由 idx_off_peak_bound_active 在 INSERT 时拒绝（见下方 local_persist 分支）。
    if (
      params.boundSessionId &&
      (await this.deps.repo.hasActiveBoundTask(
        resolveWorkspaceKey({
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
        }),
        params.boundSessionId,
      ))
    ) {
      return { ok: false, ...OFF_PEAK_SESSION_BOUND_FAILURE, providerName };
    }
    const offPeakTaskId = `offpeak-${randomUUID()}`;
    let ticket;
    try {
      ticket = await this.deps.client.takeTicket(offPeakTaskId, assertCurrent);
    } catch (error) {
      return {
        ok: false,
        ...classifyOffPeakCreateFailure(error, "ticket_request"),
        providerName,
      };
    }
    let created: ZCodeOffPeakTask;
    try {
      created = await this.deps.repo.create(normalizedParams, {
        assertCurrent,
        ownerKey: assertCurrent.ownerKey,
        offPeakTaskId,
        serverTicketId: ticket.ticketId,
        registeredAt: ticket.registeredAt,
        ...(ticket.position !== undefined ? { queuePosition: ticket.position } : {}),
        // 取号即 ready（低峰空闲直接晋级）时随建随派
        schedulable: ticket.state === "ready",
      });
      if (ticket.nextPollAfterMs !== undefined) {
        await this.deps.repo.updateSchedulingSnapshot(created.offPeakTaskId, {
          assertCurrent,
          nextPollAt: this.now() + ticket.nextPollAfterMs,
        });
      }
      await assertCurrent();
      assertCurrent.assertCurrentSync?.();
    } catch (error) {
      if (isOffPeakBoundSessionConflict(error)) {
        // 已取的票随任务作废，服务端按过期回收；不为此加释放接口。
        return { ok: false, ...OFF_PEAK_SESSION_BOUND_FAILURE, providerName };
      }
      return {
        ok: false,
        ...classifyOffPeakCreateFailure(error, "local_persist"),
        providerName,
      };
    }
    this.deps.logger.info(
      `off-peak task created id=${offPeakTaskId} ticket=${ticket.ticketId} state=${ticket.state}`,
    );
    assertCurrent.assertCurrentSync?.();
    this.emitChanged();
    this.ensureSyncScheduled(0);
    if (ticket.state === "ready") {
      try {
        assertCurrent.assertCurrentSync?.();
        this.deps.requestSchedulerWake?.();
      } catch (error) {
        this.deps.logger.warn("off-peak scheduler wake failed after create:", error);
      }
    }
    return {
      ok: true,
      task: created,
      ticketInitialState: ticket.state,
      ...(ticket.position !== undefined ? { queuePosition: ticket.position } : {}),
      providerName,
    };
  }

  /**
   * 取消（任意非终态）：先落终态再停 loop——顺序保证 loop 的 stopped 迟到回写
   * 被终态守卫丢弃，不会覆盖 cancelled（幂等）。
   */
  async cancelTask(
    offPeakTaskId: string,
    capturedFence?: OffPeakOwnerFence,
  ): Promise<ZCodeOffPeakTask | null> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing || isOffPeakTerminalStatus(existing.status)) return existing;
    const assertCurrent =
      capturedFence ??
      ((await this.deps.repo.getNativeOwnerKey(offPeakTaskId))
        ? await this[OFF_PEAK_TASK_OWNER_FENCE](offPeakTaskId)
        : undefined);
    const cancelled = await this.deps.repo.markTerminal(offPeakTaskId, {
      status: "cancelled",
      endedAt: this.now(),
      assertCurrent,
    });
    if (!cancelled) return this.deps.repo.get(offPeakTaskId);
    assertCurrent?.assertCurrentSync?.();
    if (this.residentExecutions.has(offPeakTaskId)) {
      try {
        await this.residentExecutions.cancel(offPeakTaskId);
      } catch (error) {
        this.deps.logger.warn(`off-peak lifecycle cancel failed task=${offPeakTaskId}:`, error);
      }
    } else if (
      existing.status === "running" &&
      existing.conversationId &&
      this.deps.stopRunningTask
    ) {
      try {
        await this.deps.stopRunningTask({
          conversationId: existing.conversationId,
          workspacePath: existing.workspacePath,
          ...(existing.workspaceIdentity ? { workspaceIdentity: existing.workspaceIdentity } : {}),
        });
      } catch (error) {
        this.deps.logger.warn(`off-peak cancel stop loop failed task=${offPeakTaskId}:`, error);
      }
    }
    await assertCurrent?.();
    assertCurrent?.assertCurrentSync?.();
    this.emitChanged();
    void this.settleOne(cancelled);
    return cancelled;
  }

  /** Pause：停止本地派发，票留服务端队列继续排。 */
  async pauseTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const paused = await this.deps.repo.setPaused(offPeakTaskId, true, {
      now: this.now(),
    });
    if (paused) this.emitChanged();
    return paused;
  }

  /**
   * Continue：票活着 = 恢复派发（零成本）；票已废（expired/not_found/无票）= 此刻手动
   * 重取号回队尾（额度消耗必须由用户显式动作触发）。
   */
  async continueTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const assertCurrent = await this[OFF_PEAK_TASK_OWNER_FENCE](offPeakTaskId);
    const resumed = await this.deps.repo.setPaused(offPeakTaskId, false, {
      now: this.now(),
      assertCurrent,
    });
    if (!resumed) return null;
    let ticketAlive = false;
    if (resumed.serverTicketId) {
      try {
        const status = await this.deps.client.batchStatus([resumed.serverTicketId], assertCurrent);
        // 必须按 ticketId 匹配，不能取 tickets[0]——批量应答顺序/内容不保证与请求一致。
        const entry = status.tickets.find((t) => t.ticketId === resumed.serverTicketId);
        ticketAlive =
          entry !== undefined && entry.state !== "expired" && entry.state !== "not_found";
        if (entry && ticketAlive) {
          await this.deps.repo.updateSchedulingSnapshot(offPeakTaskId, {
            assertCurrent,
            schedulable: entry.state === "ready",
            queuePosition: entry.position ?? null,
            now: this.now(),
          });
        }
        await assertCurrent();
        assertCurrent.assertCurrentSync?.();
      } catch (error) {
        await assertCurrent();
        assertCurrent.assertCurrentSync?.();
        // 状态查询失败按票活处理，交给轮询兜底；不在 Continue 上白耗一次取号额度。
        this.deps.logger.warn(
          `off-peak continue status check failed task=${offPeakTaskId}:`,
          error,
        );
        ticketAlive = true;
      }
    }
    if (!ticketAlive) {
      await this.retakeTicket(offPeakTaskId, assertCurrent);
    }
    const currentTask = await this.deps.repo.get(offPeakTaskId);
    await assertCurrent();
    assertCurrent.assertCurrentSync?.();
    this.emitChanged();
    this.ensureSyncScheduled(0);
    return currentTask;
  }

  /** 删除：非终态先按取消处理（停 loop + settle），再删行；终态直接删。 */
  async deleteTask(offPeakTaskId: string): Promise<void> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing) return;
    const assertCurrent = (await this.deps.repo.getNativeOwnerKey(offPeakTaskId))
      ? await this[OFF_PEAK_TASK_OWNER_FENCE](offPeakTaskId)
      : undefined;
    if (!isOffPeakTerminalStatus(existing.status)) {
      await this.cancelTask(offPeakTaskId, assertCurrent);
    }
    await this.deps.repo.delete(offPeakTaskId, assertCurrent);
    await assertCurrent?.();
    assertCurrent?.assertCurrentSync?.();
    this.emitChanged();
  }

  /** Delete history：仅写本地可见性标记，任务与会话继续保留。 */
  async deleteHistory(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const updated = await this.deps.repo.markHistoryDeleted(offPeakTaskId, {
      now: this.now(),
    });
    if (updated) this.emitChanged();
    return updated;
  }

  /** 编辑（queued/paused 全字段可编辑；票只锁队列身份，prompt 派发时才读）。 */
  async updateTask(
    offPeakTaskId: string,
    params: OffPeakUpdateTaskParams,
  ): Promise<ZCodeOffPeakTask | null> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing) return null;
    const assertCurrent = (await this.deps.repo.getNativeOwnerKey(offPeakTaskId))
      ? await this[OFF_PEAK_TASK_OWNER_FENCE](offPeakTaskId)
      : undefined;
    if (existing.status !== "queued" && existing.status !== "paused") {
      // running 起锁定编辑（仅取消），终态只读。
      return null;
    }
    // 闲时任务必须保存一个可由当前 Registry 解析的明确模型；清空模型不能退化成
    // “稍后取第一个”，否则编辑时看到的选择和真正派发的模型会发生漂移。
    if (params.modelSelection === null) return null;
    const candidate = params.modelSelection ?? existing.modelSelection;
    if (!candidate) return null;
    const selection = await this.deps.resolveModelSelection({
      modelId: candidate.modelId,
      ...(candidate.options?.reasoningLevel
        ? { reasoningLevel: candidate.options.reasoningLevel }
        : {}),
    });
    if (!selection.ok) return null;
    const normalizedParams: OffPeakUpdateTaskParams = {
      ...params,
      modelSelection: selection.selection,
    };
    const updated = await this.deps.repo.updateEditableFields(offPeakTaskId, normalizedParams, {
      now: this.now(),
      assertCurrent,
    });
    await assertCurrent?.();
    assertCurrent?.assertCurrentSync?.();
    if (updated) this.emitChanged();
    return updated;
  }

  async list(): Promise<ZCodeOffPeakTask[]> {
    return this.projectModelSelectionIssues(await this.deps.repo.list());
  }

  async get(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const task = await this.deps.repo.get(offPeakTaskId);
    if (!task) return null;
    return (await this.projectModelSelectionIssues([task]))[0] ?? null;
  }

  /**
   * 只派生当前配置诊断，不写数据库；旧字段仅由 migration 处理。
   */
  private async projectModelSelectionIssues(
    tasks: readonly ZCodeOffPeakTask[],
  ): Promise<ZCodeOffPeakTask[]> {
    const repaired: ZCodeOffPeakTask[] = [];
    for (const task of tasks) {
      if (task.modelSelection) {
        // 读取时把当前账号不可用写成 NULL，会永久丢掉原选择并诱发旧字段重绑。
        // 新结构只派生诊断，不写任务或 Ticket；终态不再使用模型，无需重新检查。
        const usable =
          isOffPeakTerminalStatus(task.status) ||
          (await this.validateDispatchModelSelection(task.modelSelection));
        repaired.push(
          usable
            ? task
            : {
                ...task,
                schedulable: false,
                modelSelectionIssue: {
                  code: "repair-required",
                  legacyModelId: task.modelSelection.modelId,
                  legacyReasoningLevel: task.modelSelection.options?.reasoningLevel,
                },
              },
        );
        continue;
      }
      // 数据库迁移无法确定旧 Provider 时保持缺失；读取不补迁、不重绑 Ticket。
      repaired.push({ ...task, schedulable: false });
    }
    return repaired;
  }

  // ---- 3102 续跑（host 终态回写识别标记后调用）----

  /** 票据过期（active 3h 到期/ready 废票）：回队保 session → 同 task_id 重取号。 */
  async handleTicketExpiredDuringRun(
    offPeakTaskId: string,
    current = this.residentExecutions.retakeGuard(offPeakTaskId),
    capturedFence?: OffPeakOwnerFence,
  ): Promise<void> {
    if (!current()) return;
    const assertCurrent = capturedFence ?? (await this[OFF_PEAK_TASK_OWNER_FENCE](offPeakTaskId));
    const requeued = await this.deps.repo.requeueForContinuation(offPeakTaskId, {
      assertCurrent,
      now: this.now(),
    });
    if (!current()) {
      if (this.residentExecutions.isUserOwned(offPeakTaskId))
        await this.deps.repo.markRunning(offPeakTaskId, { startedAt: this.now(), assertCurrent });
      return;
    }
    if (!requeued) {
      this.deps.logger.info(
        `off-peak ticket-expired requeue dropped (not running) task=${offPeakTaskId}`,
      );
      return;
    }
    await this.retakeTicket(offPeakTaskId, assertCurrent);
    await assertCurrent();
    assertCurrent.assertCurrentSync?.();
    this.emitChanged();
    this.ensureSyncScheduled(0);
  }

  /** 同 task_id 重新取号（已确认允许多次），失败留给轮询周期重试。 */
  private async retakeTicket(offPeakTaskId: string, fence?: OffPeakOwnerFence): Promise<void> {
    const existing = this.retakes.get(offPeakTaskId);
    if (existing) return existing;
    const current = this.residentExecutions.retakeGuard(offPeakTaskId);
    if (!current()) return;
    const pending = this.runRetakeTicket(offPeakTaskId, current, fence).finally(() => {
      this.retakes.delete(offPeakTaskId);
    });
    this.retakes.set(offPeakTaskId, pending);
    return pending;
  }

  private async runRetakeTicket(
    offPeakTaskId: string,
    current: () => boolean,
    fence?: OffPeakOwnerFence,
  ): Promise<void> {
    try {
      const assertCurrent = fence ?? (await this[OFF_PEAK_TASK_OWNER_FENCE](offPeakTaskId));
      await this.deps.repo.assertTaskOwner(offPeakTaskId, assertCurrent);
      assertCurrent.assertCurrentSync?.();
      if (!current()) return;
      const ticket = await this.deps.client.takeTicket(offPeakTaskId, assertCurrent);
      const task = await this.deps.repo.get(offPeakTaskId);
      if (!current() || !task || isOffPeakTerminalStatus(task.status)) {
        await this.releaseExecutionTicket(ticket.ticketId, assertCurrent);
        return;
      }
      await this.deps.repo.updateSchedulingSnapshot(offPeakTaskId, {
        assertCurrent,
        serverTicketId: ticket.ticketId,
        registeredAt: ticket.registeredAt,
        schedulable: ticket.state === "ready",
        queuePosition: ticket.position ?? null,
        ...(ticket.nextPollAfterMs !== undefined
          ? { nextPollAt: this.now() + ticket.nextPollAfterMs }
          : {}),
        now: this.now(),
      });
      await assertCurrent();
      assertCurrent.assertCurrentSync?.();
      if (!current()) {
        await this.releaseExecutionTicket(ticket.ticketId, assertCurrent);
        if (this.residentExecutions.isUserOwned(offPeakTaskId)) {
          await this.deps.repo.markRunning(offPeakTaskId, { startedAt: this.now(), assertCurrent });
          await this.deps.repo.updateSchedulingSnapshot(offPeakTaskId, {
            assertCurrent,
            serverTicketId: task.serverTicketId,
            schedulable: false,
            now: this.now(),
          });
        }
        return;
      }
      if (ticket.state === "ready") this.deps.requestSchedulerWake?.();
      this.deps.logger.info(
        `off-peak re-take ticket task=${offPeakTaskId} ticket=${ticket.ticketId} state=${ticket.state}`,
      );
    } catch (error) {
      if (
        error instanceof OffPeakCodingPlanUnavailableError &&
        error.reason === "selection_changed"
      )
        throw error;
      // 取号失败（额度/网络）不终态化——任务留在 queued，下个轮询周期发现无有效票再补取。
      this.deps.logger.warn(`off-peak re-take ticket failed task=${offPeakTaskId}:`, error);
    }
  }

  // ---- offPeakTaskSync：批量轮询 + 晋级写回 + 核销 outbox ----

  startSync(): void {
    if (!this.syncStopped) return;
    this.syncStopped = false;
    // 启动即扫一次未核销终态（host 启动扫描）。
    this.ensureSyncScheduled(0);
  }

  stopSync(): void {
    this.syncStopped = true;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /** disposeServiceResources 钩子：host 退出统一回收（停轮询 + 附加清理）。 */
  disposeAll(): void {
    this.residentExecutions.dispose();
    this.stopSync();
    try {
      this.deps.onDispose?.();
    } catch (error) {
      this.deps.logger.warn("off-peak onDispose 清理失败:", error);
    }
  }

  private ensureSyncScheduled(delayMs: number): void {
    if (this.syncStopped) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.runSyncCycle();
    }, delayMs);
    // Node 定时器不阻止进程退出（host 生命周期由外部管理）。
    this.syncTimer.unref?.();
  }

  /** 单次同步周期；显式调用（测试/启动扫描）不受 stopSync 影响，仅自动重排循环受控。 */
  async runSyncCycle(): Promise<void> {
    if (this.syncRunning) return;
    this.syncRunning = true;
    let nextDelay = OFF_PEAK_SYNC_MAX_INTERVAL_MS;
    try {
      // 1) 核销 outbox 捎带补报（不新增计时器）。
      await this.flushSettleOutbox();
      for (const [ticketId, assertCurrent] of this.releasedTicketOutbox)
        await this.releaseExecutionTicket(ticketId, assertCurrent);
      try {
        await this.residentExecutions.retryPendingTickets();
      } catch (error) {
        // 交接确认失败保留原票，下个同步周期继续；不能阻断其他任务轮询与票据释放。
        this.deps.logger.warn("off-peak ticket confirmation pending:", error);
      }
      // 2) 有非终态任务才轮询。
      const nonTerminal = await this.projectModelSelectionIssues(
        await this.deps.repo.listNonTerminal(),
      );
      if (nonTerminal.length === 0) {
        this.consecutiveSyncFailures = 0;
        return;
      }
      const assertCurrent = await this.deps.client.captureOwnerFence();
      const ownedTasks: ZCodeOffPeakTask[] = [];
      for (const task of nonTerminal) {
        if (await this.deps.repo.ownsTask(task.offPeakTaskId, assertCurrent)) ownedTasks.push(task);
      }
      assertCurrent.assertCurrentSync?.();
      const withTickets = ownedTasks.filter(
        (task) => task.serverTicketId && !this.residentExecutions.isUserOwned(task.offPeakTaskId),
      );
      // 无票的 queued 任务（重取号失败残留）：补取号。
      for (const task of ownedTasks) {
        if (!task.serverTicketId && task.status === "queued") {
          await this.retakeTicket(task.offPeakTaskId, assertCurrent);
        }
      }
      if (withTickets.length > 0) {
        const status = await this.deps.client.batchStatus(
          withTickets.map((task) => task.serverTicketId!),
          assertCurrent,
        );
        let anyBecameSchedulable = false;
        for (const task of withTickets) {
          const entry = status.tickets.find((t) => t.ticketId === task.serverTicketId);
          if (!entry) continue;
          anyBecameSchedulable =
            (await this.applyTicketStatus(task, entry.state, entry.position, assertCurrent)) ||
            anyBecameSchedulable;
        }
        await assertCurrent();
        assertCurrent.assertCurrentSync?.();
        if (anyBecameSchedulable) this.deps.requestSchedulerWake?.();
        if (status.nextPollAfterMs !== undefined) {
          nextDelay = status.nextPollAfterMs;
        } else {
          nextDelay = OFF_PEAK_SYNC_MIN_INTERVAL_MS;
        }
        assertCurrent.assertCurrentSync?.();
        this.emitChanged();
      } else {
        nextDelay = OFF_PEAK_SYNC_MIN_INTERVAL_MS;
      }
      this.consecutiveSyncFailures = 0;
    } catch (error) {
      // 轮询失败退避重试：期间不派发、在跑不受影响。
      this.consecutiveSyncFailures += 1;
      nextDelay = Math.min(
        SYNC_FAILURE_BASE_MS * 2 ** Math.max(0, this.consecutiveSyncFailures - 1),
        OFF_PEAK_SYNC_MAX_INTERVAL_MS,
      );
      this.deps.logger.warn(
        `off-peak sync cycle failed (attempt ${this.consecutiveSyncFailures}):`,
        error,
      );
    } finally {
      this.syncRunning = false;
      const clamped = Math.min(
        Math.max(nextDelay, OFF_PEAK_SYNC_MIN_INTERVAL_MS),
        OFF_PEAK_SYNC_MAX_INTERVAL_MS,
      );
      this.ensureSyncScheduled(clamped);
    }
  }

  /** 单票状态映射（两轴）：返回是否翻为可派发。 */
  private async applyTicketStatus(
    task: ZCodeOffPeakTask,
    state: string,
    position: number | undefined,
    assertCurrent: OffPeakOwnerFence,
  ): Promise<boolean> {
    const now = this.now();
    switch (state) {
      case "ready": {
        const became = task.schedulable !== true && task.status === "queued";
        await this.deps.repo.updateSchedulingSnapshot(task.offPeakTaskId, {
          assertCurrent,
          schedulable: true,
          queuePosition: position ?? null,
          nextPollAt: now + OFF_PEAK_SYNC_MIN_INTERVAL_MS,
          now,
        });
        return became;
      }
      case "queued":
        await this.deps.repo.updateSchedulingSnapshot(task.offPeakTaskId, {
          assertCurrent,
          schedulable: false,
          queuePosition: position ?? null,
          now,
        });
        return false;
      case "active":
        // 客户端 loop 在跑（或派发在途）；快照不动状态机，仅清位次展示。
        await this.deps.repo.updateSchedulingSnapshot(task.offPeakTaskId, {
          assertCurrent,
          queuePosition: null,
          now,
        });
        return false;
      case "expired": {
        // 任何 expired → 同 task_id 重新取号续排（统一口径）；
        // 例外：paused 停在原地等手动 Continue；running 的 3h 到期
        // 由 messages 400/3102 路径触发，这里只处理排队中的废票。
        if (task.status === "queued") {
          await this.deps.repo.updateSchedulingSnapshot(task.offPeakTaskId, {
            assertCurrent,
            schedulable: false,
            queuePosition: null,
            now,
          });
          await this.retakeTicket(task.offPeakTaskId, assertCurrent);
        }
        return false;
      }
      case "settled":
      case "not_found":
      default:
        return false;
    }
  }

  /** 终态未核销任务补报（幂等，永远失败也无害——服务端静默超时回收兜底）。 */
  private async flushSettleOutbox(): Promise<void> {
    const unsettled = await this.deps.repo.listUnsettledTerminal();
    for (const task of unsettled) {
      await this.settleOne(task);
    }
  }

  private async settleOne(task: ZCodeOffPeakTask): Promise<void> {
    if (!task.serverTicketId) {
      // 无服务端票据只结算本地 outbox，不要求官方登录，也不消费任何云端结果。
      await this.deps.repo.markSettled(task.offPeakTaskId, this.now());
      return;
    }
    let assertCurrent: OffPeakOwnerFence | undefined;
    try {
      assertCurrent = await this[OFF_PEAK_TASK_OWNER_FENCE](task.offPeakTaskId);
      await this.deps.client.settle(task.serverTicketId, assertCurrent);
      await this.deps.repo.markSettled(task.offPeakTaskId, this.now(), assertCurrent);
      await assertCurrent();
      assertCurrent.assertCurrentSync?.();
    } catch (error) {
      if (error instanceof OffPeakServerError && error.httpStatus < 500) {
        // 4xx（未知票等）按幂等 ack 处理：服务端已无此票可释放。
        await assertCurrent?.();
        assertCurrent?.assertCurrentSync?.();
        await this.deps.repo.markSettled(task.offPeakTaskId, this.now(), assertCurrent);
        return;
      }
      // 网络/5xx：保持未核销，下个周期捎带补报（不新增计时器）。
      this.deps.logger.warn(`off-peak settle failed ticket=${task.serverTicketId}:`, error);
    }
  }
}
