import type {
  OffPeakControlParams,
  OffPeakControlResult,
  OffPeakLifecycleNotification,
  OffPeakOutcome,
} from "@zcode/shared";
import type { TaskExecutionOwnerFence } from "./contract.js";

type RequestAuth = Extract<OffPeakControlParams, { action: "replace_ticket" }>["requestAuth"];
interface TicketDelivery {
  control: Extract<OffPeakControlParams, { action: "replace_ticket" }>;
  previousTicketId: string;
  inFlight?: Promise<void>;
}
interface Registration {
  offPeakTaskId: string;
  executionId: string;
  sessionId: string;
  ticketId: string;
  control(input: OffPeakControlParams): Promise<OffPeakControlResult>;
  complete(outcome: OffPeakOutcome): Promise<void>;
  disposed?(): void;
  assertCurrent?: TaskExecutionOwnerFence;
}
interface ResidentExecution extends Registration {
  ready: Promise<void>;
  admit(): void;
  discarded: boolean;
  userOwned: boolean;
  terminal: boolean;
  renewalId?: number;
  ticketDelivery?: TicketDelivery;
  completedWritten: boolean;
  releasedTickets: Set<string>;
}

/** XCODE: 驻留票据交接归 task-facts；Host 只关联请求，CLI 仍独占后台生命周期事实。 */
export class OffPeakResidentExecutions {
  private readonly runs = new Map<string, ResidentExecution>();

  constructor(
    private readonly deps: {
      renew(
        taskId: string,
        current: () => boolean,
        assertCurrent?: TaskExecutionOwnerFence,
      ): Promise<void>;
      takeover(taskId: string, assertCurrent?: TaskExecutionOwnerFence): Promise<void>;
      release(ticketId: string, assertCurrent?: TaskExecutionOwnerFence): Promise<void>;
    },
  ) {}

  register(input: Registration): { admitted(): void; dispose(): void } {
    const previous = this.runs.get(input.offPeakTaskId);
    if (previous && !previous.terminal && !previous.discarded)
      throw new Error("off_peak_execution_already_registered");
    let admit!: () => void;
    const ready = new Promise<void>((resolve) => {
      admit = resolve;
    });
    const run: ResidentExecution = {
      ...input,
      // XCODE: 驻留 owner 跨异步控制/完成仍需有效，不能把旧任务交给新账号。
      control: async (params) => {
        if (input.assertCurrent) await input.assertCurrent();
        input.assertCurrent?.assertCurrentSync?.();
        const result = await input.control(params);
        if (input.assertCurrent) await input.assertCurrent();
        input.assertCurrent?.assertCurrentSync?.();
        return result;
      },
      complete: async (outcome) => {
        if (input.assertCurrent) await input.assertCurrent();
        input.assertCurrent?.assertCurrentSync?.();
        await input.complete(outcome);
        if (input.assertCurrent) await input.assertCurrent();
        input.assertCurrent?.assertCurrentSync?.();
      },
      ready,
      admit,
      discarded: false,
      userOwned: false,
      terminal: false,
      completedWritten: false,
      releasedTickets: new Set(),
    };
    this.runs.set(input.offPeakTaskId, run);
    return {
      admitted: admit,
      dispose: () => {
        run.discarded = true;
        admit();
        if (this.runs.get(input.offPeakTaskId) === run) this.runs.delete(input.offPeakTaskId);
      },
    };
  }

  retakeGuard(taskId: string): () => boolean {
    const run = this.runs.get(taskId);
    const renewalId = run?.renewalId;
    return () => {
      try {
        run?.assertCurrent?.assertCurrentSync?.();
      } catch {
        return false;
      }
      return run
        ? this.runs.get(taskId) === run &&
            !run.discarded &&
            !run.userOwned &&
            !run.terminal &&
            !run.ticketDelivery &&
            renewalId !== undefined &&
            run.renewalId === renewalId
        : !this.runs.has(taskId);
    };
  }

  isUserOwned(taskId: string): boolean {
    return this.runs.get(taskId)?.userOwned === true;
  }
  has(taskId: string): boolean {
    return this.runs.has(taskId);
  }
  discardTicket(ticketId: string, assertCurrent?: TaskExecutionOwnerFence): Promise<void> {
    return this.deps.release(ticketId, assertCurrent);
  }

  async handle(event: OffPeakLifecycleNotification): Promise<void> {
    const run = this.runs.get(event.offPeakTaskId);
    if (
      !run ||
      run.discarded ||
      run.executionId !== event.executionId ||
      run.sessionId !== event.sessionId
    )
      return;
    if (run.assertCurrent) await run.assertCurrent();
    run.assertCurrent?.assertCurrentSync?.();
    if (event.type === "ticket_needed") {
      if (run.userOwned || run.terminal || event.renewalId <= (run.renewalId ?? 0)) return;
      // CLI 已开始下一次续票，旧交接已被其消费；迟到 ACK 不得倒写新的票据归属。
      run.ticketDelivery = undefined;
      run.renewalId = event.renewalId;
    }
    if (event.type === "user_takeover") {
      run.userOwned = true;
      run.renewalId = undefined;
    }
    if (event.type === "completed") {
      if (run.terminal) return;
      run.terminal = true;
      run.renewalId = undefined;
    }
    await run.ready;
    if (run.assertCurrent) await run.assertCurrent();
    run.assertCurrent?.assertCurrentSync?.();
    if (run.discarded) return;
    switch (event.type) {
      case "ticket_needed": {
        const current = this.retakeGuard(event.offPeakTaskId);
        if (current()) await this.deps.renew(event.offPeakTaskId, current, run.assertCurrent);
        return;
      }
      case "user_takeover":
        await this.deps.takeover(event.offPeakTaskId, run.assertCurrent);
        return;
      case "ticket_released":
        await this.deps.release(event.ticketId, run.assertCurrent);
        run.releasedTickets.add(event.ticketId);
        this.finish(run);
        return;
      case "completed":
        await run.complete(event.outcome);
        run.completedWritten = true;
        this.finish(run);
        return;
      case "state_changed":
        return;
    }
  }

  async deliverTicket(
    taskId: string,
    ticketId: string,
    requestAuth: RequestAuth,
  ): Promise<{ sessionId: string } | undefined> {
    const run = this.runs.get(taskId);
    if (!run || run.discarded) return undefined;
    await run.ready;
    if (run.assertCurrent) await run.assertCurrent();
    run.assertCurrent?.assertCurrentSync?.();
    if (run.discarded) return undefined;
    const pendingDelivery = run.ticketDelivery;
    if (pendingDelivery) {
      if (pendingDelivery.control.ticketId !== ticketId)
        await this.deps.release(ticketId, run.assertCurrent);
      if (run.ticketDelivery === pendingDelivery) await this.sendTicket(run, pendingDelivery);
      return { sessionId: run.sessionId };
    }
    const renewalId = run.renewalId;
    if (renewalId === undefined || run.userOwned || run.terminal) {
      if (ticketId !== run.ticketId) await this.deps.release(ticketId, run.assertCurrent);
      return { sessionId: run.sessionId };
    }
    // 新票安装后 CLI 可立即完成，通知可能早于 RPC 回执；先登记对应票，防止旧票释放误收口。
    const delivery: TicketDelivery = {
      previousTicketId: run.ticketId,
      control: {
        sessionId: run.sessionId,
        executionId: run.executionId,
        action: "replace_ticket",
        renewalId,
        ticketId,
        requestAuth: structuredClone(requestAuth),
      },
    };
    run.ticketId = ticketId;
    run.ticketDelivery = delivery;
    await this.sendTicket(run, delivery);
    return { sessionId: run.sessionId };
  }

  /** 复用既有同步周期；未知回执只重试同一控制命令，不重取票或重放任务。 */
  async retryPendingTickets(): Promise<void> {
    await Promise.all(
      [...this.runs.values()].map((run) =>
        run.ticketDelivery ? this.sendTicket(run, run.ticketDelivery) : undefined,
      ),
    );
  }

  private sendTicket(run: ResidentExecution, delivery: TicketDelivery): Promise<void> {
    if (delivery.inFlight) return delivery.inFlight;
    const pending = this.confirmTicket(run, delivery).finally(() => {
      delivery.inFlight = undefined;
    });
    delivery.inFlight = pending;
    return pending;
  }

  private async confirmTicket(run: ResidentExecution, delivery: TicketDelivery): Promise<void> {
    // RPC 抛错不代表 CLI 未安装。保留原票及凭据，retakeGuard 同时禁止 Host 回队重取。
    const result = await run.control(delivery.control);
    if (run.assertCurrent) await run.assertCurrent();
    run.assertCurrent?.assertCurrentSync?.();
    if (run.discarded || run.ticketDelivery !== delivery) return;
    run.ticketDelivery = undefined;
    if (result.accepted) {
      if (run.renewalId === delivery.control.renewalId) run.renewalId = undefined;
    } else {
      run.ticketId = delivery.previousTicketId;
      await this.deps.release(delivery.control.ticketId, run.assertCurrent);
      this.finish(run);
      if (!run.userOwned && !run.terminal) {
        // 只有明确拒绝才允许重新申请；同步重试也须经过同一续票入口恢复调度。
        await this.deps.renew(
          run.offPeakTaskId,
          this.retakeGuard(run.offPeakTaskId),
          run.assertCurrent,
        );
        throw new Error("off_peak_ticket_handoff_rejected");
      }
    }
  }

  async cancel(taskId: string): Promise<boolean> {
    const run = this.runs.get(taskId);
    if (!run || run.discarded) return false;
    if (run.assertCurrent) await run.assertCurrent();
    run.assertCurrent?.assertCurrentSync?.();
    run.renewalId = undefined;
    // 立即阻止已在途重取号写回；CLI 的 completed 仍是生命周期收口事件。
    run.userOwned = true;
    // 注册早于首轮 admission；太早发控制请求会被 CLI 拒绝并丢失用户取消。
    await run.ready;
    if (run.discarded) return true;
    await run.control({ sessionId: run.sessionId, executionId: run.executionId, action: "cancel" });
    return true;
  }

  dispose(): void {
    for (const run of this.runs.values()) {
      run.discarded = true;
      run.admit();
    }
    this.runs.clear();
  }
  private finish(run: ResidentExecution): void {
    if (!run.completedWritten || !run.releasedTickets.has(run.ticketId)) return;
    run.discarded = true;
    if (this.runs.get(run.offPeakTaskId) === run) this.runs.delete(run.offPeakTaskId);
    run.disposed?.();
  }
}
