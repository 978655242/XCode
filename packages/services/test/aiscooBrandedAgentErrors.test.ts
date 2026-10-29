import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zcodeProtocolMethods } from "@zcode/shared";
import { setDataBaseDir } from "../src/paths.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";
import { ZCodeStdioTransport } from "../src/zcode-agent/zcodeStdioTransport.js";

const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("../src/zcode-agent/zcodeAgentProcessManager.js", () => ({
  ZCodeAgentProcessManager: class {
    getClient = getClient;
    onRuntimeLifecycle() {
      return { dispose() {} };
    }
    onRuntimeRestarted() {
      return { dispose() {} };
    }
    disposeAll() {}
  },
}));

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
  setDataBaseDir(null);
  await rm(directory, { recursive: true, force: true });
});
function fakeClient(request: ReturnType<typeof vi.fn>) {
  return {
    request,
    transportKind: "stdio",
    onNotification: () => ({ dispose() {} }),
    onRequest: () => ({ dispose() {} }),
    onClose: () => ({ dispose() {} }),
  };
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
      const result = kind === "mcp" ? { servers: [] } : { plugins: [] };
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
