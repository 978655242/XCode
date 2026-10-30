// XCODE: Aiscoo 专属回归；上游 App 业务套件已退役，仅保留下游差异的断言。
import { describe, expect, it, vi } from "vitest";
import type {
  TaskFactSource,
  TaskFactStore,
  TaskFactsContract,
} from "#src/task-facts/contract.js";
import { createTaskFacts } from "#src/task-facts/index.js";
const target = { workspacePath: "/repo", taskId: "session" };
const meta = {
  ...target,
  title: "old",
  createdAt: 1,
  updatedAt: 2,
  traceId: "trace",
  mode: "default" as const,
};
function fixture() {
  const store: TaskFactStore = {
    applyCliFacts: vi.fn(async (facts) => facts.meta),
    applyCliDeletion: vi.fn(async () => {}),
    markCliOrphan: vi.fn(async () => {}),
    listReconciliationRows: vi.fn(async () => [{ meta, handoffPending: 8 }]),
    getTaskMeta: vi.fn(async () => meta),
  };
  const source: TaskFactSource = {
    reconcile: vi.fn(async () => ({ sessions: [] })),
    execute: vi.fn(async () => {}),
  };
  const changed = vi.fn();
  const port: TaskFactsContract = createTaskFacts({ store, source, changed });
  return { store, source, changed, port };
}
describe("Aiscoo task-facts owner fence", () => {
  it("rejects a Native refresh whose owner is revoked during CLI IO before any index write", async () => {
    const { port, source, store, changed } = fixture();
    let current = true;
    const assertCurrent = () => {
      if (!current) throw new Error("owner revoked");
    };
    vi.mocked(source.reconcile).mockImplementationOnce(async () => {
      current = false;
      return {
        sessions: [
          {
            sessionId: "session",
            exists: true,
            deleted: false,
            title: "late",
            titleSource: "generated",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      };
    });
    await expect(port.refresh(target, assertCurrent)).rejects.toThrow(
      "owner revoked",
    );
    expect(store.applyCliFacts).not.toHaveBeenCalled();
    expect(store.markCliOrphan).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("carries the same Native fence to the queued CLI-fact store", async () => {
    const { port, source, store } = fixture();
    const assertCurrent = vi.fn();
    vi.mocked(source.reconcile).mockResolvedValueOnce({
      sessions: [
        {
          sessionId: "session",
          exists: true,
          deleted: false,
          title: "CLI",
          titleSource: "generated",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
    await port.refresh(target, assertCurrent);
    expect(store.applyCliFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        assertCurrent,
        meta: expect.objectContaining({ title: "CLI" }),
      }),
    );
  });
});
