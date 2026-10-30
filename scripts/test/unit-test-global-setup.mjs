import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// XCODE: 父进程在 worker 退出后清理，不能让测试迁移或修剪用户的数据库备份。
export default async function setup(project) {
  const root = await mkdtemp(join(tmpdir(), "xwork-unit-storage-"));
  project.provide("xcodeUnitTestRoot", root);
  // Vitest 的 global teardown 早于 pool.close；自然退出时才能安全回收持库 worker 的目录。
  // shortcut: forced exits leave temporary roots, use an external owner if interrupted-run cleanup is required.
  process.once("beforeExit", () => {
    void rm(root, { recursive: true, force: true }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
