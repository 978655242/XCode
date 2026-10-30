import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { createNodeSessionDataFiles } from "../../adapters/src/storage/session-data-files/index.js";
import { createMessageId, createPartId, createProjectId, type SessionId } from "@zcode/contracts";
import {
  purgeSessionDataWith,
  type SessionDataHost,
} from "../src/zcode-protocol/session-data/index.js";

type FailureStep = "release" | "files" | "rows";
const ORDERS = [
  ["sess_a", "sess_b"],
  ["sess_b", "sess_a"],
];

// XCODE: fake port 按真实仓储语义在删行成功后移除引用方；失败行必须继续保护其引用的附件。
function fixture(
  options: {
    refs?: Record<string, string[]>;
    trees?: Record<string, string[]>;
    busy?: string[];
    failure?: { id: string; step: FailureStep };
  } = {},
) {
  const trees = options.trees ?? { sess_a: ["sess_a"], sess_b: ["sess_b"], sess_c: ["sess_c"] };
  const alive = new Set(Object.values(trees).flat());
  const artifacts = new Set(alive);
  const calls: string[] = [];
  const fail = (id: string, step: FailureStep) => {
    if (options.failure?.id === id && options.failure.step === step)
      throw Object.assign(new Error("fixture failure"), {
        code: step === "rows" ? "EIO" : "EBUSY",
      });
  };
  const host: SessionDataHost = {
    store: {
      listOwnedSessionTrees: async (ids) =>
        new Map(
          ids.map((id) => [
            id,
            (trees[id] ?? [id]).filter((child) => alive.has(child)) as SessionId[],
          ]),
        ),
      listArtifactReferrers: async (ids) =>
        new Map(
          ids.flatMap((id) => {
            const refs = (options.refs?.[id] ?? []).filter((ref) => ref !== id && alive.has(ref));
            return refs.length ? [[id, refs as SessionId[]] as const] : [];
          }),
        ),
      purgeSessions: async (ids) => {
        for (const id of ids) {
          calls.push(`rows:${id}`);
          fail(id, "rows");
          for (const child of trees[id] ?? [id]) alive.delete(child);
        }
      },
    },
    files: {
      measureSession: async () => 1,
      removeSession: async (id) => {
        calls.push(`files:${id}`);
        fail(id, "files");
        artifacts.delete(id);
        return 1;
      },
      measureMemory: async () => 1,
      removeMemory: async ({ workspacePath }) => {
        calls.push(`memory:${workspacePath}`);
        return 1;
      },
    },
    residency: (id) => (options.busy?.includes(id) ? "busy" : "idle"),
    release: async (id) => {
      calls.push(`release:${id}`);
      fail(id, "release");
    },
    forgetIndexed: (id) => {
      calls.push(`forget:${id}`);
    },
  };
  return { host, alive, artifacts, calls };
}

describe("Aiscoo session purge survivor safety", () => {
  for (const order of ORDERS) {
    it.each<FailureStep>(["release", "files", "rows"])(
      `keeps B while its referrer A fails at %s, order=${order}`,
      async (step) => {
        const f = fixture({ refs: { sess_b: ["sess_a"] }, failure: { id: "sess_a", step } });
        const result = await purgeSessionDataWith(f.host, { sessionIds: order, directories: [] });
        expect(result.deleted).toEqual([]);
        expect(result.failed).toEqual([
          { sessionId: "sess_a", code: step === "rows" ? "EIO" : "EBUSY" },
        ]);
        expect(result.kept).toEqual([{ sessionId: "sess_b", reason: "referenced" }]);
        expect(f.alive.has("sess_a")).toBe(true);
        expect(f.alive.has("sess_b")).toBe(true);
        expect(f.artifacts.has("sess_b")).toBe(true);
        expect(f.calls.some((call) => call.endsWith(":sess_b"))).toBe(false);
        expect(f.calls.filter((call) => call === `${step}:sess_a`)).toHaveLength(1);
      },
    );

    it(`deletes a successful acyclic batch and memory once, order=${order}`, async () => {
      const f = fixture({ refs: { sess_b: ["sess_a"] } });
      const result = await purgeSessionDataWith(f.host, {
        sessionIds: order,
        directories: [{ workspacePath: "/fixture" }],
      });
      expect(result.deleted).toEqual(order.map((sessionId) => ({ sessionId, bytes: 1 })));
      expect(result.kept).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(f.calls.indexOf("rows:sess_a")).toBeLessThan(f.calls.indexOf("files:sess_b"));
      expect(f.calls.filter((call) => call === "files:sess_a")).toHaveLength(1);
      expect(f.calls.filter((call) => call === "files:sess_b")).toHaveLength(1);
      expect(f.calls.filter((call) => call.startsWith("memory:"))).toEqual(["memory:/fixture"]);
    });

    it(`keeps a cross-root cycle without deletion side effects, order=${order}`, async () => {
      const f = fixture({ refs: { sess_a: ["sess_b"], sess_b: ["sess_a"] } });
      const result = await purgeSessionDataWith(f.host, { sessionIds: order, directories: [] });
      expect(result.kept).toEqual(order.map((sessionId) => ({ sessionId, reason: "referenced" })));
      expect(result.deleted).toEqual([]);
      expect(f.calls).toEqual([]);
    });
  }

  it.each([
    ["sess_a", "sess_child"],
    ["sess_child", "sess_a"],
  ])(
    "protects owned-tree cross-session reference %s → %s before any root/child failure",
    async (referrer, target) => {
      for (const failingId of ["sess_a", "sess_child"]) {
        const f = fixture({
          trees: { sess_a: ["sess_a", "sess_child"] },
          refs: { [target]: [referrer] },
          failure: { id: failingId, step: "files" },
        });
        const result = await purgeSessionDataWith(f.host, {
          sessionIds: ["sess_a"],
          directories: [],
        });
        expect(result.kept).toEqual([{ sessionId: "sess_a", reason: "referenced" }]);
        expect(result.failed).toEqual([]);
        expect([...f.alive]).toEqual(["sess_a", "sess_child"]);
        expect([...f.artifacts]).toEqual(["sess_a", "sess_child"]);
        expect(f.calls).toEqual([]);
      }
    },
  );

  it("keeps a source referred to by an unselected owned child", async () => {
    const f = fixture({
      trees: { sess_a: ["sess_a", "sess_child"], sess_b: ["sess_b"] },
      refs: { sess_b: ["sess_child"] },
    });
    const result = await purgeSessionDataWith(f.host, { sessionIds: ["sess_b"], directories: [] });
    expect(result.kept).toEqual([{ sessionId: "sess_b", reason: "referenced" }]);
    expect(f.calls).toEqual([]);
  });

  it("gives busy precedence and propagates its actual surviving references", async () => {
    const f = fixture({
      trees: { sess_a: ["sess_a", "sess_child"], sess_b: ["sess_b"] },
      busy: ["sess_child"],
      refs: { sess_b: ["sess_child"], sess_a: ["sess_child"] },
    });
    const result = await purgeSessionDataWith(f.host, {
      sessionIds: ["sess_b", "sess_a"],
      directories: [],
    });
    expect(result.kept).toEqual([
      { sessionId: "sess_b", reason: "referenced" },
      { sessionId: "sess_a", reason: "running" },
    ]);
    expect(f.calls).toEqual([]);
  });

  it("deletes an ordinary owned tree with same-session references", async () => {
    const f = fixture({
      trees: { sess_a: ["sess_a", "sess_child"] },
      refs: { sess_a: ["sess_a"], sess_child: ["sess_child"] },
    });
    const result = await purgeSessionDataWith(f.host, { sessionIds: ["sess_a"], directories: [] });
    expect(result.deleted).toEqual([{ sessionId: "sess_a", bytes: 2 }]);
    expect([...f.alive]).toEqual([]);
    expect(f.calls).toEqual([
      "release:sess_a",
      "release:sess_child",
      "files:sess_a",
      "files:sess_child",
      "rows:sess_a",
      "forget:sess_a",
      "forget:sess_child",
    ]);
  });

  it("does not retry a failed tree when an unrelated deletion makes progress", async () => {
    const f = fixture({ refs: { sess_b: ["sess_a"] }, failure: { id: "sess_a", step: "files" } });
    const result = await purgeSessionDataWith(f.host, {
      sessionIds: ["sess_b", "sess_a", "sess_c"],
      directories: [],
    });
    expect(result.deleted).toEqual([{ sessionId: "sess_c", bytes: 1 }]);
    expect(result.failed).toEqual([{ sessionId: "sess_a", code: "EBUSY" }]);
    expect(result.kept).toEqual([{ sessionId: "sess_b", reason: "referenced" }]);
    expect(f.calls.filter((call) => call === "files:sess_a")).toHaveLength(1);
    expect(f.calls.some((call) => call.endsWith(":sess_b"))).toBe(false);
  });

  it("revisits a reversed acyclic chain only after actual row deletion", async () => {
    const f = fixture({ refs: { sess_a: ["sess_b"], sess_b: ["sess_c"] } });
    const result = await purgeSessionDataWith(f.host, {
      sessionIds: ["sess_a", "sess_b", "sess_c"],
      directories: [],
    });
    expect(result.deleted.map((item) => item.sessionId)).toEqual(["sess_a", "sess_b", "sess_c"]);
    expect(f.calls.filter((call) => call.startsWith("rows:"))).toEqual([
      "rows:sess_c",
      "rows:sess_b",
      "rows:sess_a",
    ]);
  });
});

describe("Aiscoo purge safety with real temporary SQLite and artifact files", () => {
  it.each(ORDERS)(
    "preserves B's real artifact when A's file removal fails, order=%s,%s",
    async (...order) => {
      const root = await mkdtemp(join(tmpdir(), "aiscoo-purge-safe-"));
      const store = await createSqliteSessionStore({ dbPath: join(root, "sessions.sqlite") });
      const artifact = join(root, "cli", "artifacts", "sess_b", "out.txt");
      const forgotten: string[] = [];
      try {
        for (const session of ["sess_a", "sess_b"]) {
          await store.createSession({
            id: session as SessionId,
            projectID: createProjectId("purge-fixture"),
            slug: session,
            directory: root,
            path: root,
            title: session,
            permission: { mode: "build" },
            version: "3.17.1",
            time: { created: 1, updated: 1 },
          });
        }
        const sessionID = "sess_a" as SessionId;
        const messageID = createMessageId("reference");
        await store.saveMessage({
          id: messageID,
          sessionID,
          role: "user",
          time: { created: 1 },
          agent: "zcode-agent",
          modelSelection: { providerId: "fixture", modelId: "fixture" },
        } as never);
        await store.savePart({
          id: createPartId("reference-part"),
          sessionID,
          messageID,
          type: "text",
          text: "zcode-artifact://sess_b/out.txt",
          time: { start: 1, end: 1 },
        });
        await mkdir(join(artifact, ".."), { recursive: true });
        await writeFile(artifact, "keep artifact");
        const files = createNodeSessionDataFiles({
          cliStorageRoot: join(root, "cli"),
          memoryRoot: () => join(root, "cli", "memories", "projects", "fixture", "memory"),
        });
        const host: SessionDataHost = {
          store,
          files: {
            ...files,
            removeSession: async (id) => {
              if (id === "sess_a")
                throw Object.assign(new Error("fixture failure"), { code: "EBUSY" });
              return files.removeSession(id);
            },
          },
          residency: () => null,
          release: async () => {},
          forgetIndexed: (id) => {
            forgotten.push(id);
          },
        };
        const result = await purgeSessionDataWith(host, { sessionIds: order, directories: [] });
        expect(result.failed).toEqual([{ sessionId: "sess_a", code: "EBUSY" }]);
        expect(result.kept).toEqual([{ sessionId: "sess_b", reason: "referenced" }]);
        expect(result.deleted).toEqual([]);
        expect(await store.getSession("sess_a" as SessionId)).not.toBeNull();
        expect(await store.getSession("sess_b" as SessionId)).not.toBeNull();
        expect(await readFile(artifact, "utf8")).toBe("keep artifact");
        expect(forgotten).toEqual([]);
      } finally {
        store.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
