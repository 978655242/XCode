import type { SessionId } from "@zcode/contracts";
import type {
  V4SessionDataParams,
  V4SessionDataPurgeResult,
} from "@zcode/shared/zcode-protocol-v4";
import type { SessionDataHost } from "./contract.js";

type PurgeBatch = (
  host: SessionDataHost,
  params: V4SessionDataParams,
) => Promise<V4SessionDataPurgeResult>;

/** XCODE: 只调度原删除 owner；计划删除不等于已删除，引用方必须在真实删行后才解除保护。 */
export async function purgeWithSurvivorSafety(
  host: SessionDataHost,
  params: V4SessionDataParams,
  purgeBatch: PurgeBatch,
): Promise<V4SessionDataPurgeResult> {
  const result: V4SessionDataPurgeResult = { deleted: [], kept: [], failed: [], memory: [] };
  const outcomes = new Map<string, V4SessionDataPurgeResult>();
  let pending = [...new Set(params.sessionIds)];
  let progressed: boolean;
  do {
    progressed = false;
    const deferred: string[] = [];
    for (const root of pending) {
      const owned = await host.store.listOwnedSessionTrees([root as SessionId]);
      const tree = owned.get(root as SessionId);
      const ids = tree?.length ? tree : [root];
      const busy = ids.some((id) => host.residency(id) === "busy");
      let outcome: V4SessionDataPurgeResult;
      if (busy || (await hasCrossSessionReference(host, ids))) {
        // 同树文件逐个删除而行最后提交，任一文件失败会让全部行幸存，不能忽略内部跨 session 引用。
        outcome = {
          deleted: [],
          kept: [{ sessionId: root, reason: busy ? "running" : "referenced" }],
          failed: [],
          memory: [],
        };
      } else {
        outcome = await purgeBatch(host, { sessionIds: [root], directories: [] });
      }
      outcomes.set(root, outcome);
      if (outcome.deleted.length) progressed = true;
      if (outcome.kept.some((item) => item.reason === "referenced")) deferred.push(root);
    }
    // 仅真实删除带来新资格；失败与 busy 不自动重试，循环引用在无进展时保守保留。
    pending = deferred;
  } while (progressed && pending.length);

  for (const root of new Set(params.sessionIds)) {
    const outcome = outcomes.get(root)!;
    result.deleted.push(...outcome.deleted);
    result.kept.push(...outcome.kept);
    result.failed.push(...outcome.failed);
  }
  // 原 owner 仍按原目录顺序执行 memory；不随会话的引用重评重复删除。
  if (params.directories.length) {
    const memory = await purgeBatch(host, { sessionIds: [], directories: params.directories });
    result.memory.push(...memory.memory);
    result.failed.push(...memory.failed);
  }
  return result;
}

async function hasCrossSessionReference(
  host: SessionDataHost,
  ids: readonly string[],
): Promise<boolean> {
  const members = new Set(ids);
  const referrers = await host.store.listArtifactReferrers(ids as SessionId[]);
  return ids.some((target) =>
    (referrers.get(target as SessionId) ?? []).some(
      (referrer) => referrer !== target && members.has(referrer),
    ),
  );
}
