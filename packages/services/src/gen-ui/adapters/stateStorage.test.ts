import type * as NodeFs from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenUiStateStorage } from "./stateStorage.js";

const hints = vi.hoisted(
  (): {
    manual: boolean;
    callbacks: Array<{ directory: string; listener: NodeFs.WatchListener<string> }>;
    watchers: Array<{ delivered: boolean; onDelivered?: () => void }>;
  } => ({ manual: false, callbacks: [], watchers: [] }),
);
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    watch: (
      directory: NodeFs.PathLike,
      options: NodeFs.WatchOptionsWithStringEncoding,
      listener: NodeFs.WatchListener<string>,
    ) => {
      if (!hints.manual) {
        const watcher: (typeof hints.watchers)[number] = { delivered: false };
        hints.watchers.push(watcher);
        return actual.watch(directory, options, (event, filename) => {
          watcher.delivered = true;
          watcher.onDelivered?.();
          listener(event, filename);
        });
      }
      if (typeof directory !== "string") throw new Error("Missing state observer");
      hints.callbacks.push({ directory, listener });
      // XCODE: 保留真实 watcher 的资源生命周期，仅控制 OS 提示，磁盘、锁和状态通知仍走生产实现。
      return actual.watch(directory, options, () => {});
    },
  };
});
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  hints.manual = false;
  hints.callbacks.length = 0;
  hints.watchers.length = 0;
});
// 修复原因：同一目录新建第二个 fs.watch 时，macOS FSEvents 可能丢掉紧邻的事件（实测约 1/80），
// 原用例让 b.set 在写入同一刻才创建 b 的 watcher，a 偶尔收不到外部写入而 30s 超时。
// 先让两个实例都建立监听，并反复写无关探针文件直到每个 watcher 真实投递过事件，再验证广播；
// 生产实现会忽略非状态文件名。
async function waitUntilAllWatching(directory: string) {
  for (const watcher of hints.watchers) {
    const { promise, resolve } = Promise.withResolvers<void>();
    watcher.onDelivered = resolve;
    // 每次写入后让出事件循环，监听一旦生效就会在下一轮写入前回调。
    for (let attempt = 0; !watcher.delivered; attempt++) {
      if (attempt >= 10_000) throw new Error("Gen UI state watcher never delivered events");
      await writeFile(join(directory, "watch-probe"), String(attempt));
      await Promise.race([promise, new Promise((next) => setImmediate(next))]);
    }
    watcher.onDelivered = undefined;
  }
}
describe("desktop Gen UI state persistence", () => {
  it("keeps the latest 100 paths and serializes writes across service instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "gen-ui-state-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const a = createGenUiStateStorage(root),
      b = createGenUiStateStorage(root);
    cleanup.push(
      () => a.dispose(),
      () => b.dispose(),
    );
    const scope = { workspacePath: "/workspace", sessionId: "task" };
    for (let i = 0; i < 102; i++)
      await (i % 2 ? a : b).set(
        { ...scope, path: `/workspace/view-${i}.html` },
        { modelContent: i, privateContent: null },
      );
    const entries = await b.list(scope);
    expect(entries).toHaveLength(100);
    expect(entries.some((entry) => entry.path === "/workspace/view-101.html")).toBe(true);
    expect(await a.get({ ...scope, path: "/workspace/view-0.html" })).toBeNull();
  });
  it("restores across service instances and serializes complete snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "gen-ui-state-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const first = createGenUiStateStorage(root),
      second = createGenUiStateStorage(root);
    cleanup.push(
      () => first.dispose(),
      () => second.dispose(),
    );
    const target = {
      workspacePath: "/workspace",
      sessionId: "task",
      path: "/workspace/chart.html",
    };
    await Promise.all(
      [1, 2, 3].map((tab) => first.set(target, { modelContent: null, privateContent: { tab } })),
    );
    expect(await second.get(target)).toEqual({ modelContent: null, privateContent: { tab: 3 } });
    expect(await second.get({ ...target, workspaceIdentity: "remote-example" })).toBeNull();
    await second.set(target, { modelContent: { year: 2026 }, privateContent: null });
    expect(await first.get(target)).toEqual({ modelContent: { year: 2026 }, privateContent: null });
  });
  it("broadcasts external writes without echo loops", async () => {
    const root = await mkdtemp(join(tmpdir(), "gen-ui-state-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const a = createGenUiStateStorage(root),
      b = createGenUiStateStorage(root);
    cleanup.push(
      () => a.dispose(),
      () => b.dispose(),
    );
    const target = {
      workspacePath: "/workspace",
      sessionId: "task",
      path: "/workspace/chart.html",
    };
    await a.get(target);
    await b.get(target);
    await waitUntilAllWatching(join(root, (await readdir(root))[0]!));
    const changed = new Promise<unknown>((resolve) => {
      const off = a.onChanged((event) => {
        off.dispose();
        resolve(event.state);
      });
    });
    await b.set(target, { modelContent: "selection", privateContent: null });
    expect(await changed).toEqual({ modelContent: "selection", privateContent: null });
  });

  it.each(["state.lock", null])(
    "observes the committed snapshot from a coalesced %s hint without echoes or scope leaks",
    async (filename) => {
      hints.manual = true;
      const root = await mkdtemp(join(tmpdir(), "gen-ui-state-"));
      cleanup.push(() => rm(root, { recursive: true, force: true }));
      const a = createGenUiStateStorage(root),
        b = createGenUiStateStorage(root);
      cleanup.push(
        () => a.dispose(),
        () => b.dispose(),
      );
      const target = {
        workspacePath: "/workspace",
        sessionId: "task",
        path: "/workspace/chart.html",
      };
      await a.get(target);
      await a.get({ ...target, sessionId: "another-task" });
      const observed: unknown[] = [];
      a.onChanged((event) => observed.push(event));
      await b.set(target, { modelContent: "selection", privateContent: null });
      const lock = join(hints.callbacks[0]!.directory, "state.lock");
      await writeFile(lock, "");
      const notify = () =>
        Promise.all(hints.callbacks.map(({ listener }) => listener("rename", filename)));
      // 唯一一条提示在锁仍存在时到达；之后不再有任何 OS 事件，补读必须由锁释放触发。
      await notify();
      expect(observed).toEqual([]);
      await rm(lock);
      await vi.waitFor(() =>
        expect(observed).toEqual([
          { target, state: { modelContent: "selection", privateContent: null } },
        ]),
      );
      await notify();
      expect(observed).toEqual([
        { target, state: { modelContent: "selection", privateContent: null } },
      ]);
    },
  );
});
