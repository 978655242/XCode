import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createViteServer } from "vite";

assert.ok(process.argv[2], "Missing parent-owned Vite cache directory");

// XCODE: Vite/原生文件监听器由纯 Node child 持有，不跨 Vitest VM 的销毁边界。
let vite;
let closing;
async function close() {
  closing ??= (async () => {
    if (process.connected) process.send({ type: "stage", phase: "request-idle" });
    await vite?.waitForRequestsIdle();
    if (process.connected) process.send({ type: "stage", phase: "dependency-optimizer" });
    // XCODE: crawl 完成不代表 native optimizer 的扫描/构建/commit 已完成，不能直接 cancel。
    for (const environment of Object.values(vite?.environments ?? {})) {
      const optimizer = environment.depsOptimizer;
      if (!optimizer) continue;
      await optimizer.scanProcessing;
      await Promise.all(optimizer.metadata.depInfoList.map((dependency) => dependency.processing));
    }
    if (process.connected) process.send({ type: "stage", phase: "vite-close" });
    await vite?.close();
    if (process.connected) {
      const { promise: sent, resolve, reject } = Promise.withResolvers();
      process.send({ type: "closed" }, (error) => (error ? reject(error) : resolve()));
      await sent;
      process.disconnect();
    }
  })();
  return closing;
}
function fail(error) {
  console.error(error);
  process.exit(1);
}

try {
  vite = await createViteServer({
    root: process.cwd(),
    // XCODE: 不共享用户 dev server 的优化缓存；仅关闭投机预热，按需模块与 HMR 保持真实。
    cacheDir: process.argv[2],
    server: { host: "127.0.0.1", port: 0, strictPort: true, preTransformRequests: false },
    // XCODE: 采用新版手机服务的 Worker 预构建，避免操作中首次发现依赖触发 full reload。
    optimizeDeps: { include: ["@pierre/diffs/worker/worker.js"] },
  });
  assert.ok(vite.httpServer, "Missing Vite HTTP server");
  // XCODE: Vite 8 的 listen(0) 会回落 5173；其公开 HTTP listen 包装仍负责完整初始化。
  // HTTP/HMR 均由 Vite 创建与关闭，只通过 Node 原生监听选择真正的临时端口。
  const listening = once(vite.httpServer, "listening");
  vite.httpServer.listen(Number(process.argv[3] ?? "0"), "127.0.0.1");
  await listening;
  const address = vite.httpServer.address();
  if (!address || typeof address === "string") throw new Error("缺少 Mobile Web fixture 端口");
  process.on("message", (message) => {
    if (message.type === "close") void close().catch(fail);
  });
  process.once("disconnect", () => void close().catch(fail));
  if (process.connected)
    process.send({ type: "ready", origin: `http://127.0.0.1:${address.port}` });
  else await close();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await close();
}
