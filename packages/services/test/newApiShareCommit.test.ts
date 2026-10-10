import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionId,
  createProjectId,
  createMessageId,
  createPartId,
  type SharedContextImportCommitBundle,
} from "@zcode/contracts";
import { SqliteSessionStore } from "../../../apps/zcode-cli/packages/adapters/src/storage/session-store/sqlite-session-store.js";

function bundle(): SharedContextImportCommitBundle {
  const sessionId = createSessionId("owner-fenced-import");
  const messageId = createMessageId("owner-fenced-context");
  return {
    session: {
      id: sessionId,
      projectID: createProjectId("isolated"),
      slug: "isolated",
      directory: "/isolated",
      title: "Shared content",
      version: "test",
    },
    contextMessage: {
      info: {
        id: messageId,
        sessionID: sessionId,
        role: "user",
        agent: "zcode-agent",
        time: { created: 1 },
        synthetic: true,
        source: "shared_context",
        visibility: "model-only",
      },
      parts: [
        {
          id: createPartId("owner-fenced-text"),
          sessionID: sessionId,
          messageID: messageId,
          type: "text",
          text: "A's private shared context",
        },
      ],
    },
    provenance: {
      id: `import:${sessionId}`,
      sessionID: sessionId,
      type: "v4/shared_context_import",
      time: { created: 1, updated: 1 },
      data: { contextId: "context", status: "pending" },
    },
  };
}

test("actual SQLite import rolls back session, context and provenance when owner changes during repository awaits", async () => {
  const store = new SqliteSessionStore({ dbPath: ":memory:" });
  const input = bundle();
  let owner = "A";
  input.assertCurrent = () => {
    if (owner !== "A") throw new Error("captured import owner changed");
  };
  try {
    // XCODE: 第一次准入仍为 A；真实 saveMessage 的 await 让出执行权后才切 B。
    queueMicrotask(() => {
      owner = "B";
    });
    await assert.rejects(
      store.commitSharedContextImportBundle(input),
      /captured import owner changed/,
    );
    const rejected = store.debugCounts(input.session.id);
    assert.equal(rejected.sessions, 0);
    assert.equal(rejected.messages, 0);
    assert.equal(rejected.parts, 0);
    assert.equal(rejected.sessionEntries, 0);
    const next = bundle();
    next.assertCurrent = () => {
      if (owner !== "B") throw new Error("B owner changed");
    };
    await store.commitSharedContextImportBundle(next);
    const committed = store.debugCounts(next.session.id);
    assert.equal(committed.sessions, 1);
    assert.equal(committed.messages, 1);
    assert.equal(committed.parts, 1);
    assert.equal(committed.sessionEntries, 1);
  } finally {
    store.close();
  }
});
