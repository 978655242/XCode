import { expect, it, vi } from "vitest";
import { NetworkCaptureBuffer } from "../../src/main/networkCaptureBuffer.js";
import {
  subscribeBeforeRequest,
  subscribeBeforeRequestGuard,
} from "../../src/main/observeBeforeRequest.js";
import type { WebRequest, OnBeforeRequestListenerDetails } from "electron";

it("缓存有界，旧 capture 批次被拒绝，清空不停止采集，关闭释放数据", () => {
  const buffer = new NetworkCaptureBuffer();
  const record = {
    timestamp: 1,
    processType: "host" as const,
    pid: 42,
    method: "GET",
    url: "https://example.test/path?token=secret",
  };
  buffer.start("one");
  for (let i = 0; i < 12; i++)
    buffer.ingest({ captureId: "one", records: Array(100).fill(record), dropped: 0 });
  expect(buffer.snapshot().records).toHaveLength(1_000);
  expect(buffer.snapshot().dropped).toBe(200);
  expect(JSON.stringify(buffer.snapshot())).not.toContain("secret");
  buffer.start("two");
  buffer.ingest({ captureId: "one", records: [record], dropped: 0 });
  expect(buffer.snapshot().records).toHaveLength(0);
  buffer.ingest({ captureId: "two", records: [record], dropped: 0 });
  buffer.clear();
  expect(buffer.snapshot()).toMatchObject({ captureId: "two", records: [], dropped: 0 });
  buffer.stop();
  expect(() => buffer.snapshot()).toThrow();
});

it("Electron 单 listener 分发不会覆盖其他观测者，异常仍原样放行，停用恢复过滤器", () => {
  let listener:
    | ((details: OnBeforeRequestListenerDetails, callback: (response: object) => void) => void)
    | null;
  const onBeforeRequest = vi.fn((_filter, next) => {
    listener = next;
  });
  const webRequest = { onBeforeRequest } as unknown as WebRequest;
  const cdnObserver = vi.fn();
  const removeCdnObserver = subscribeBeforeRequest(
    webRequest,
    ["https://*.alicdn.com/*"],
    cdnObserver,
  );
  const removeCapture = subscribeBeforeRequest(webRequest, ["http://*/*", "https://*/*"], () => {
    throw new Error("closed");
  });
  const callback = vi.fn();
  listener!({ url: "https://g.alicdn.com/a" } as OnBeforeRequestListenerDetails, callback);
  expect(callback).toHaveBeenCalledExactlyOnceWith({});
  expect(cdnObserver).toHaveBeenCalledOnce();
  removeCapture();
  expect(onBeforeRequest.mock.lastCall![0]).toEqual({ urls: ["https://*.alicdn.com/*"] });
  removeCdnObserver();
  expect(onBeforeRequest.mock.lastCall![0]).toBeNull();
});

it("安全 guard 拒绝优先且回调一次，观测者不能修改决定，停用观测不移除 guard", () => {
  let listener:
    | ((details: OnBeforeRequestListenerDetails, callback: (response: object) => void) => void)
    | null = null;
  const source = {
    onBeforeRequest: vi.fn((filter, next) => {
      listener = filter === null ? null : next;
    }),
  } as unknown as WebRequest;
  const removeDeny = subscribeBeforeRequestGuard(source, ["<all_urls>"], (details) => ({
    cancel: details.url.includes("/private"),
  }));
  const allow = vi.fn(() => ({ cancel: false }));
  const removeAllow = subscribeBeforeRequestGuard(source, ["https://*/*"], allow);
  const observed: string[] = [];
  const removeObserver = subscribeBeforeRequest(source, ["https://*/*"], (details) => {
    observed.push(details.url);
    return { cancel: !details.url.includes("/private") };
  });
  const request = (url: string) => {
    const callback = vi.fn();
    listener!({ url } as OnBeforeRequestListenerDetails, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    return callback.mock.calls[0]![0];
  };
  expect(request("https://example.test/private")).toEqual({ cancel: true });
  expect(allow).toHaveBeenCalledOnce();
  expect(request("https://example.test/public")).toEqual({});
  expect(observed).toEqual(["https://example.test/private", "https://example.test/public"]);
  removeObserver();
  removeObserver();
  expect(request("https://example.test/private")).toEqual({ cancel: true });
  removeDeny();
  expect(request("https://example.test/private")).toEqual({});
  removeAllow();
  expect(listener).toBeNull();
});

it("guard 异常必须 fail closed 且其他 guard/观测者仍运行，非匹配 guard 不阻断请求", () => {
  let listener:
    | ((details: OnBeforeRequestListenerDetails, callback: (response: object) => void) => void)
    | null = null;
  const source = {
    onBeforeRequest: vi.fn((filter, next) => {
      listener = filter === null ? null : next;
    }),
  } as unknown as WebRequest;
  const observer = vi.fn(() => {
    throw new Error("observer unavailable");
  });
  const removeObserver = subscribeBeforeRequest(source, ["<all_urls>"], observer);
  const removeThrowing = subscribeBeforeRequestGuard(source, ["https://private.test/*"], () => {
    throw new Error("policy unavailable");
  });
  const allow = vi.fn(() => ({ cancel: false }));
  const removeAllow = subscribeBeforeRequestGuard(source, ["<all_urls>"], allow);
  const denied = vi.fn();
  listener!({ url: "https://private.test/view" } as OnBeforeRequestListenerDetails, denied);
  expect(denied).toHaveBeenCalledExactlyOnceWith({ cancel: true });
  expect(allow).toHaveBeenCalledOnce();
  expect(observer).toHaveBeenCalledOnce();
  const allowed = vi.fn();
  listener!({ url: "file:///public.txt" } as OnBeforeRequestListenerDetails, allowed);
  expect(allowed).toHaveBeenCalledExactlyOnceWith({});
  expect(observer).toHaveBeenCalledTimes(2);
  removeObserver();
  removeThrowing();
  removeAllow();
});
