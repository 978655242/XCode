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

  it("warns with the branded runtime requirement and continues probing older glibc", async () => {
    // XCODE: 新版探测要求 ROOT 段；缺失会先报输出不完整，无法验证 glibc 只告警、不拒连的上游合同。
    const backend = backendFor(
      "__ZCODE_PROBE_PLATFORM__\nLinux\n__ZCODE_PROBE_ARCH__\nx86_64\n" +
        "__ZCODE_PROBE_ROOT__\n/home/alice/.zcode/server\n__ZCODE_PROBE_KERNEL__\nLinux\n" +
        "__ZCODE_PROBE_LIBC__\nglibc 2.17\n__ZCODE_PROBE_INSTALLED__\n0\n__ZCODE_PROBE_END__\n",
    );
    const adapter = createSourceServerTransportAdapter("ssh", {
      createBackend: async () => backend,
    });
    const onLog = vi.fn();
    await expect(
      adapter.probe({ kind: "ssh", host: "example.invalid", username: "alice" }, { onLog }),
    ).resolves.toEqual({
      platform: "linux",
      arch: "x64",
      installPath: "/home/alice/.zcode/server",
      installed: false,
    });
    expect(onLog).toHaveBeenCalledExactlyOnceWith({
      phase: "probe",
      level: "warn",
      message:
        "Remote glibc 2.17 is older than glibc 2.28 required by the bundled Aiscoo Source Server runtime. " +
        "Aiscoo Source Server may fail to start. Continuing installation or connection.",
    });
    expect(backend.exec).toHaveBeenCalledWith(expect.stringContaining('"$HOME/.zcode/server"'));
  });

  it("rejects an incomplete probe before reporting a glibc warning", async () => {
    const backend = backendFor(
      "__ZCODE_PROBE_PLATFORM__\nLinux\n__ZCODE_PROBE_ARCH__\nx86_64\n__ZCODE_PROBE_KERNEL__\nLinux\n" +
        "__ZCODE_PROBE_LIBC__\nglibc 2.17\n__ZCODE_PROBE_INSTALLED__\n0\n__ZCODE_PROBE_END__\n",
    );
    const adapter = createSourceServerTransportAdapter("ssh", {
      createBackend: async () => backend,
    });
    const onLog = vi.fn();
    await expect(
      adapter.probe({ kind: "ssh", host: "example.invalid", username: "alice" }, { onLog }),
    ).rejects.toMatchObject({
      code: "remote-preflight-failed",
      message: "Source Server environment probe returned incomplete or invalid output: ROOT",
    });
    expect(onLog).not.toHaveBeenCalled();
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
