import type { WebRequest, OnBeforeRequestListenerDetails } from "electron";

type Observer = (details: OnBeforeRequestListenerDetails) => void;
type Guard = (details: OnBeforeRequestListenerDetails) => { cancel: boolean };
type RequestSource = Pick<WebRequest, "onBeforeRequest">;
type Entry = { urls: string[]; patterns: RegExp[] } & ({ observer: Observer } | { guard: Guard });
const sources = new WeakMap<RequestSource, Set<Entry>>();

/** XCODE: Electron 只有一个 listener 槽；只读观测与安全准入共用分发，拒绝优先。 */
function subscribe(source: RequestSource, entry: Entry): () => void {
  let subscriptions = sources.get(source);
  if (!subscriptions) {
    subscriptions = new Set();
    sources.set(source, subscriptions);
  }
  const entries = subscriptions;
  const update = () => {
    if (!entries.size) {
      source.onBeforeRequest(null);
      sources.delete(source);
      return;
    }
    source.onBeforeRequest(
      { urls: [...new Set([...entries].flatMap((item) => item.urls))] },
      (details, callback) => {
        let cancel = false;
        for (const item of entries) {
          if (!("guard" in item)) continue;
          try {
            if (item.patterns.some((pattern) => pattern.test(details.url))) {
              const result = item.guard(details);
              cancel = result.cancel || cancel;
            }
          } catch {
            // XCODE: 安全策略异常不得变成放行；观测者不能获得请求决定权。
            cancel = true;
          }
        }
        callback(cancel ? { cancel: true } : {});
        for (const item of entries) {
          if (!("observer" in item)) continue;
          try {
            if (item.patterns.some((pattern) => pattern.test(details.url))) item.observer(details);
          } catch {
            /* 观测错误不得阻断网络或其他观测者 */
          }
        }
      },
    );
  };
  entries.add(entry);
  update();
  return () => {
    if (entries.delete(entry)) update();
  };
}

function patternsFor(urls: string[]): RegExp[] {
  return urls.map((pattern) =>
    pattern === "<all_urls>"
      ? /^.*$/
      : new RegExp(
          `^${pattern
            .split("*")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*")}$`,
        ),
  );
}

export function subscribeBeforeRequest(
  source: RequestSource,
  urls: string[],
  observer: Observer,
): () => void {
  return subscribe(source, { urls, patterns: patternsFor(urls), observer });
}

export function subscribeBeforeRequestGuard(
  source: RequestSource,
  urls: string[],
  guard: Guard,
): () => void {
  return subscribe(source, { urls, patterns: patternsFor(urls), guard });
}
