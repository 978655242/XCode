// XCODE: Aiscoo 专属回归；上游 App 业务套件已退役，仅保留下游差异的断言。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { setDataBaseDir } from "#src/paths.js";
import { TaskIndexRepo } from "#src/session/taskIndexRepo.js";

let repo: TaskIndexRepo;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "zcode-task-index-workspace-identity-"));
  setDataBaseDir(tempDir);
  repo = new TaskIndexRepo();
});

afterEach(async () => {
  repo.close();
  setDataBaseDir(null);
  // Windows 需要等待 SQLite 释放文件句柄，避免临时目录清理出现 EPERM。
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempDir, { recursive: true, force: true });
});

function task(params: {
  taskId: string;
  workspaceIdentity: string;
  title?: string;
}): ZCodeTaskMeta {
  return {
    taskId: params.taskId,
    traceId: `trace-${params.taskId}`,
    title: params.title ?? params.taskId,
    workspacePath: "/workspace/project",
    workspaceIdentity: params.workspaceIdentity,
    createdAt: 10,
    updatedAt: 20,
    mode: "default",
    provider: "glm",
    status: "running",
  };
}

describe("Aiscoo TaskIndex Native write queue", () => {
  it("Native CLI facts and presentation check the captured owner after entering the write queue", async () => {
    const meta = task({
      taskId: "native",
      workspaceIdentity:
        "remote:ssh:dev.example.test:22:coder:/workspace/project",
    });
    await repo.ensureReady();
    let current = true;
    const assertCurrent = () => {
      if (!current) throw new Error("owner revoked");
    };
    const pending = repo.applyCliFacts({ meta, assertCurrent });
    current = false;
    await expect(pending).rejects.toThrow("owner revoked");
    expect(await repo.getTaskMeta(meta)).toBeNull();

    await repo.applyCliFacts({ meta });
    current = true;
    const presentation = repo.updateTaskPresentation({
      ...meta,
      presentation: { model: "late-model" },
      assertCurrent,
    });
    current = false;
    await expect(presentation).rejects.toThrow("owner revoked");
    expect((await repo.getTaskMeta(meta))?.model).toBeUndefined();
    expect((await repo.getTaskMeta(meta))?.title).toBe(meta.title);
  });
});
