import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "@zcode/rpc";
import {
  zcodeProtocolMethods,
  zcodeRuntimeCapabilitiesParamsSchema,
  type ZCodeProtocolMessage,
} from "@zcode/shared";
import { setDataBaseDir } from "../src/paths.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";
import { ZCodeProtocolClient } from "../src/zcode-agent/zcodeProtocolClient.js";
import type { ZCodeAgentProcessManager } from "../src/zcode-agent/zcodeAgentProcessManager.js";
import { ZCodeStdioTransport } from "../src/zcode-agent/zcodeStdioTransport.js";

const { getClient } = vi.hoisted(() => ({
  getClient: vi.fn<ZCodeAgentProcessManager["getClient"]>(),
}));
vi.mock("../src/zcode-agent/zcodeAgentProcessManager.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/zcode-agent/zcodeAgentProcessManager.js")>();
  return {
    ...actual,
    // XCODE: 继承真实管理器的共享运行时、事件和释放接口，只替换进程获取，避免缺方法提前遮蔽 retry。
    ZCodeAgentProcessManager: class extends actual.ZCodeAgentProcessManager {
      override getClient = getClient;
    },
  };
});

const clientCleanup: Array<() => void> = [];
let directory: string;
let service: ReturnType<typeof createZCodeAgentService> | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "aiscoo-agent-errors-"));
  setDataBaseDir(directory);
  getClient.mockReset();
});
afterEach(async () => {
  service?.disposeAll();
  service = undefined;
  for (const dispose of clientCleanup.splice(0)) dispose();
  setDataBaseDir(null);
  await rm(directory, { recursive: true, force: true });
});
function fakeClient(request: ReturnType<typeof vi.fn>) {
  const messages = new Emitter<ZCodeProtocolMessage>();
  const closes = new Emitter<{ reason?: string }>();
  const client = new ZCodeProtocolClient({
    kind: "stdio",
    onMessage: messages.event,
    onClose: closes.event,
    async send(message) {
      if (!("method" in message) || !("id" in message))
        throw new Error("Expected protocol request");
      try {
        // XCODE: 新版启动能力协商独立于业务请求；仅注入真实 stdio 关闭错误，保留业务 retry 次数断言。
        if (message.method === zcodeProtocolMethods.runtimeCapabilities) {
          zcodeRuntimeCapabilitiesParamsSchema.parse(message.params);
          messages.fire({ id: message.id, result: {} });
          return;
        }
        const result = await request(message.method, message.params);
        messages.fire({ id: message.id, result });
      } catch (error) {
        if (message.method === zcodeProtocolMethods.workspaceReadPresentation) client.dispose();
        throw error;
      }
    },
    dispose() {},
  });
  clientCleanup.push(() => {
    client.dispose();
    messages.dispose();
    closes.dispose();
  });
  return client;
}

describe("branded Agent diagnostic compatibility", () => {
  it.each(["Aiscoo", "XWork"])("keeps %s stdio-close errors retryable", async (brand) => {
    const presentation = {
      workspace: { workspacePath: directory, workspaceKey: directory },
      mode: "build",
      slashCommands: [],
    };
    const failedRequest = vi.fn(async (method: string) => {
      if (method === zcodeProtocolMethods.workspaceReadPresentation)
        throw new Error(`${brand} agent stdio transport is closed`);
      return {};
    });
    const recoveredRequest = vi.fn(async () => presentation);
    getClient
      .mockResolvedValueOnce(fakeClient(failedRequest))
      .mockResolvedValue(fakeClient(recoveredRequest));
    service = createZCodeAgentService();
    await expect(service.readWorkspacePresentation({ workspacePath: directory })).resolves.toEqual(
      presentation,
    );
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(failedRequest).toHaveBeenCalledOnce();
    expect(recoveredRequest).toHaveBeenCalledOnce();
  });

  it.each([
    ["Aiscoo", "mcp"],
    ["XWork", "mcp"],
    ["Aiscoo", "plugins"],
    ["XWork", "plugins"],
  ] as const)(
    "keeps %s %s timeout text in the existing retry classification",
    async (brand, kind) => {
      const method =
        kind === "mcp" ? zcodeProtocolMethods.mcpList : zcodeProtocolMethods.pluginsList;
      const result = kind === "mcp" ? { statuses: {} } : { plugins: [], diagnostics: [] };
      const request = vi
        .fn()
        .mockRejectedValueOnce(new Error(`${brand} Protocol request timed out: ${method}`))
        .mockResolvedValue(result);
      getClient.mockResolvedValue(fakeClient(request));
      service = createZCodeAgentService();
      const pending =
        kind === "mcp"
          ? service.listMcpServerStatuses({ workspacePath: directory })
          : service.listPlugins({ workspacePath: directory });
      await expect(pending).resolves.toEqual(result);
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it("does not classify arbitrary external error text as the branded timeout", async () => {
    const error = new Error("Project XWork / ZCode: network unavailable");
    const request = vi.fn().mockRejectedValue(error);
    getClient.mockResolvedValue(fakeClient(request));
    service = createZCodeAgentService();
    await expect(service.listPlugins({ workspacePath: directory })).rejects.toBe(error);
    expect(request).toHaveBeenCalledOnce();
  });

  it("emits branded stdio-close diagnostics without changing protocol messages", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: true,
      exitCode: 0,
      signalCode: null,
    }) as ChildProcessWithoutNullStreams;
    const transport = new ZCodeStdioTransport(child);
    try {
      await expect(transport.send({ id: 1, method: "session/read", params: {} })).rejects.toThrow(
        "Aiscoo agent stdio transport is closed",
      );
    } finally {
      child.stderr.end();
      transport.dispose();
    }
  });
});
