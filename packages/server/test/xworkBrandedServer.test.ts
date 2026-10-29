import { PassThrough } from "node:stream";
import { Emitter } from "@zcode/rpc";
import type { IRemoteBackend, StdioStream } from "../src/remote/backend.js";
import { detectRemoteAssetTools } from "../src/remote/remoteAssetPreflight.js";
import { createSourceServerTransportAdapter } from "../src/source-server/transportAdapter.js";
import { describe, expect, it, vi } from "vitest";

function completedStream(output: string, error = "", code = 0): StdioStream {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const closed = new Emitter<number>();
  // exec 是异步接口，下一轮事件循环发出关闭，确保调用方已注册流监听。
  setTimeout(() => {
    stdout.end(output);
    stderr.end(error);
    closed.fire(code);
    closed.dispose();
  }, 0);
  return { stdin, stdout, stderr, onClose: closed.event };
}
function backendFor(output: string, error = "", code = 0): IRemoteBackend {
  return {
    detect: async () => ({ platform: "linux", arch: "x64" }),
    upload: async () => {},
    exists: async () => false,
    readFile: async () => "",
    exec: vi.fn(async () => completedStream(output, error, code)),
    dispose() {},
  };
}

describe("Aiscoo server display diagnostics", () => {
  it.each([
    ["download=\ntar=tar\nsha256=sha256sum\n", "无法直接下载 Aiscoo 远程资源"],
    ["download=curl\ntar=\nsha256=sha256sum\n", "无法解压 Aiscoo Source Server"],
    ["download=curl\ntar=tar\nsha256=\n", "无法校验 Aiscoo 远程资源"],
  ])(
    "brands local asset preflight failures without renaming remote tools",
    async (output, message) => {
      const backend = backendFor(output);
      await expect(detectRemoteAssetTools(backend, { log() {} })).rejects.toThrow(message);
      expect(backend.exec).toHaveBeenCalledWith(expect.stringContaining("command -v tar"));
    },
  );

  it("keeps branded glibc failures in the remote preflight classification", async () => {
    const backend = backendFor(
      "__ZCODE_PROBE_PLATFORM__\nLinux\n__ZCODE_PROBE_ARCH__\nx86_64\n__ZCODE_PROBE_KERNEL__\nLinux\n" +
        "__ZCODE_PROBE_LIBC__\nglibc 2.17\n__ZCODE_PROBE_INSTALLED__\n0\n__ZCODE_PROBE_END__\n",
    );
    const adapter = createSourceServerTransportAdapter("ssh", {
      createBackend: async () => backend,
    });
    await expect(
      adapter.probe({ kind: "ssh", host: "example.invalid", username: "alice" }, {}),
    ).rejects.toMatchObject({
      code: "remote-preflight-failed",
      message: expect.stringContaining("required by Aiscoo Source Server"),
    });
    expect(backend.exec).toHaveBeenCalledWith(expect.stringContaining('"$HOME/.zcode/server"'));
  });

  it("preserves upstream diagnostic text and technical probe markers", async () => {
    const message = "ZCode upstream service: XWork account unavailable";
    const backend = backendFor("", message, 1);
    const adapter = createSourceServerTransportAdapter("ssh", {
      createBackend: async () => backend,
    });
    await expect(
      adapter.probe({ kind: "ssh", host: "example.invalid", username: "alice" }, {}),
    ).rejects.toMatchObject({ message });
    expect(backend.exec).toHaveBeenCalledWith(expect.stringContaining("__ZCODE_PROBE_PLATFORM__"));
  });
});
