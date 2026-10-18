import { beforeEach, expect, it, vi } from "vitest";
import { channel } from "node:diagnostics_channel";
import type { OnBeforeRequestListenerDetails, Session, UtilityProcess } from "electron";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  webRequest: { onBeforeRequest: vi.fn() },
  partitions: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: {},
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler),
  },
  session: { defaultSession: { webRequest: state.webRequest }, fromPartition: state.partitions },
  webContents: { fromId: () => null },
}));

beforeEach(() => {
  vi.resetModules();
  state.webRequest.onBeforeRequest.mockReset();
  state.partitions.mockReset().mockReturnValue({ webRequest: state.webRequest });
});

it("默认无捕获；窗口拥有权限及启停，新 Host 继承，关窗清理并拒绝旧批次", async () => {
  const before = channel("undici:request:create").hasSubscribers;
  const capture = await import("../src/main/resourceManagerNetwork.js");
  const host = { postMessage: vi.fn() } as unknown as UtilityProcess;
  capture.registerResourceManagerNetworkIpc();
  const get = state.handlers.get("zcode:get-network-capture-snapshot")!;
  capture.configureNetworkCaptureHost(host);
  expect(host.postMessage).not.toHaveBeenCalled();
  expect(channel("undici:request:create").hasSubscribers).toBe(before);
  expect(() => get({ sender: { id: 7 } })).toThrow();
  capture.startResourceManagerNetwork(7, () => [host]);
  try {
    expect(() => get({ sender: { id: 99 } })).toThrow();
    const id = get({ sender: { id: 7 } }).captureId;
    expect(host.postMessage).toHaveBeenLastCalledWith({
      type: "network-capture",
      control: { captureId: id },
    });
    expect(state.partitions.mock.calls.flat()).not.toContain("persist:zcode-embedded-browser");
    const late = { postMessage: vi.fn() } as unknown as UtilityProcess;
    capture.configureNetworkCaptureHost(late);
    expect(late.postMessage).toHaveBeenCalledWith({
      type: "network-capture",
      control: { captureId: id },
    });
    capture.ingestHostNetworkCapture(
      {
        captureId: id,
        records: [
          {
            timestamp: 1,
            pid: 99,
            processType: "host",
            method: "GET",
            url: "https://example.test/",
          },
        ],
        dropped: 0,
      },
      42,
    );
    expect(get({ sender: { id: 7 } }).records[0].pid).toBe(42);
    state.handlers.get("zcode:clear-network-capture")!({ sender: { id: 7 } });
    const clearedId = get({ sender: { id: 7 } }).captureId;
    expect(clearedId).not.toBe(id);
    capture.ingestHostNetworkCapture({ captureId: id, records: [], dropped: 50 }, 42);
    expect(get({ sender: { id: 7 } })).toMatchObject({ records: [], dropped: 0 });
    expect(host.postMessage).toHaveBeenLastCalledWith({
      type: "network-capture",
      control: { captureId: clearedId },
    });
    capture.stopResourceManagerNetwork([host, late]);
    expect(host.postMessage).toHaveBeenLastCalledWith({
      type: "network-capture",
      control: { captureId: null },
    });
    expect(state.webRequest.onBeforeRequest).toHaveBeenLastCalledWith(null);
    expect(channel("undici:request:create").hasSubscribers).toBe(before);
    capture.startResourceManagerNetwork(8, () => [host]);
    capture.ingestHostNetworkCapture({ captureId: id, records: [], dropped: 100 }, 42);
    expect(get({ sender: { id: 8 } })).toMatchObject({ records: [], dropped: 0 });
  } finally {
    capture.stopResourceManagerNetwork([host]);
  }
});

it("网络捕获开关前后保留实际 Native 私有路径 guard，正常请求仍进入捕获", async () => {
  // vi.resetModules 隔离每次捕获 owner/guard 生命周期，必须在重置后加载真实模块。
  const { guardPlanWebviewSession } = await import("../src/main/nativePlanWebviewManager.js");
  const capture = await import("../src/main/resourceManagerNetwork.js");
  const appSession = { webRequest: state.webRequest } as unknown as Session;
  guardPlanWebviewSession(appSession);
  capture.registerResourceManagerNetworkIpc();
  const get = state.handlers.get("zcode:get-network-capture-snapshot")!;
  const request = (url: string) => {
    const callback = vi.fn();
    const listener = state.webRequest.onBeforeRequest.mock.lastCall![1];
    expect(listener).toBeTypeOf("function");
    listener({ url, method: "GET" } as OnBeforeRequestListenerDetails, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    return callback.mock.calls[0]![0];
  };
  const assertPrivateDenied = () => {
    expect(request("https://example.test/xcode/plans?handoff=private")).toEqual({ cancel: true });
    expect(request("https://example.test/api/xcode/v1/web/view")).toEqual({ cancel: true });
  };
  try {
    assertPrivateDenied();
    for (let i = 0; i < 2; i++) {
      capture.startResourceManagerNetwork(7, () => []);
      assertPrivateDenied();
      expect(request("https://example.test/custom")).toEqual({});
      expect(get({ sender: { id: 7 } }).records).toEqual(
        expect.arrayContaining([expect.objectContaining({ url: "https://example.test/custom" })]),
      );
      capture.stopResourceManagerNetwork([]);
      assertPrivateDenied();
      expect(request("https://example.test/custom")).toEqual({});
    }
  } finally {
    capture.stopResourceManagerNetwork([]);
  }
});
