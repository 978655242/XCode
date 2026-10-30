// XCODE: Aiscoo 专属回归；上游 App 业务套件已退役，仅保留下游差异的断言。
import { describe, expect, it, vi } from "vitest";
import { OffPeakResidentExecutions } from "../src/task-facts/index.js";

describe("Aiscoo resident execution owner", () => {
  it("撤销注册 owner 后拒绝续票、控制、完成和核销，不借新账号执行旧任务", async () => {
    let current = true;
    const check = () => {
      if (!current) throw new Error("owner revoked");
    };
    const assertCurrent = Object.assign(async () => check(), {
      assertCurrentSync: check,
    });
    const renew = vi.fn(async () => {});
    const takeover = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    const control = vi.fn(async () => ({ accepted: true }));
    const complete = vi.fn(async () => {});
    const runs = new OffPeakResidentExecutions({ renew, takeover, release });
    runs
      .register({
        offPeakTaskId: "task",
        executionId: "execution",
        sessionId: "session",
        ticketId: "one",
        assertCurrent,
        control,
        complete,
      })
      .admitted();
    const target = {
      offPeakTaskId: "task",
      executionId: "execution",
      sessionId: "session",
    };
    await runs.handle({
      ...target,
      type: "ticket_needed",
      renewalId: 1,
      expiredTicketId: "one",
    });
    const guard = runs.retakeGuard("task");
    expect(renew).toHaveBeenCalledExactlyOnceWith(
      "task",
      expect.any(Function),
      assertCurrent,
    );
    current = false;
    expect(guard()).toBe(false);
    await expect(runs.deliverTicket("task", "two", {})).rejects.toThrow(
      "owner revoked",
    );
    await expect(runs.cancel("task")).rejects.toThrow("owner revoked");
    await expect(
      runs.handle({ ...target, type: "user_takeover" }),
    ).rejects.toThrow("owner revoked");
    await expect(
      runs.handle({ ...target, type: "completed", outcome: "succeeded" }),
    ).rejects.toThrow("owner revoked");
    await expect(
      runs.handle({ ...target, type: "ticket_released", ticketId: "one" }),
    ).rejects.toThrow("owner revoked");
    expect(control).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(takeover).not.toHaveBeenCalled();
  });
});
