import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { conversationRowSchema } from "@zcode/shared/zcode-protocol-v4";
import {
  zcodeSessionStateSnapshotSchema,
  ZCODE_PROTOCOL_NAME,
  ZCODE_PROTOCOL_VERSION,
} from "@zcode/shared";
import { ConversationShareHttpClient } from "../src/conversation-share/conversationShareHttpClient.js";
import { ConversationShareService } from "../src/conversation-share/conversationShareService.js";
import { sha256ConversationShareJson } from "../src/conversation-share/conversationShareIntegrity.js";
import { createLocalConversationShareArtifactSource } from "../src/conversation-share/conversationShareArtifactSource.js";
import { createZCodeSessionService } from "../src/zcode-session/zcodeSessionService.js";
import { sessionCreateAdmission } from "../src/zcode-agent/zcodeAgent.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { createZCodeTaskIndexSyncer } from "../src/zcode-agent/zcodeTaskIndexSyncer.js";

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const rows = [
  conversationRowSchema.parse({
    rowId: 1,
    turnId: "turn",
    productTurnId: "turn",
    createdAt: 1,
    createdAtSeq: 1,
    kind: "turnHeader",
    origin: "userInput",
    state: "completedSuccess",
    startedAt: 1,
  }),
  conversationRowSchema.parse({
    rowId: 2,
    turnId: "turn",
    productTurnId: "turn",
    createdAt: 1,
    createdAtSeq: 2,
    kind: "userInput",
    origin: "realUser",
    text: "A's selected content",
  }),
];
const capabilities = {
  schema_version: 1,
  access_modes: ["public_importable"],
  ttl_ms: 60_000,
  max_rows: 100,
  max_payload_bytes: 100_000,
  max_artifact_count: 10,
  max_artifact_bytes: 100_000,
  max_total_artifact_bytes: 100_000,
  allowed_artifacts: [{ type: "pdf", extensions: ["pdf"], mime_types: ["application/pdf"] }],
};
const continuation = {
  schema_version: 1,
  import_grant_id: "grant",
  import_grant_expires_at: 9999999999999,
  share: {
    share_id: "share",
    title: "Shared content",
    access_mode: "public_importable",
    created_at: 1,
    expires_at: 9999999999999,
  },
  rows,
  artifacts: [],
  integrity: {
    projection_sha256: sha256ConversationShareJson(rows),
    artifact_set_sha256: sha256ConversationShareJson([]),
  },
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "share-operation-fence-"));
  let owner = "A";
  const requests: Array<{ path: string; token: string | null }> = [];
  const client = new ConversationShareHttpClient({
    baseUrl: "https://official.example",
    tokenProvider: async () => "native-token-never-used",
    requestAuthProvider: async () => {
      const captured = owner;
      return {
        token: `official-${captured}`,
        isCurrent: async () => captured === owner,
        assertCurrentSync: () => {
          if (captured !== owner) throw new Error("Official cloud owner changed");
        },
      };
    },
    apiClient: {
      request: async (url, init) => {
        const path = new URL(url).pathname;
        requests.push({ path, token: new Headers(init?.headers).get("authorization") });
        const data = path.endsWith("/capabilities")
          ? capabilities
          : path.endsWith("/continuation")
            ? continuation
            : { preparation_id: "prep", expires_at: 9999999999999, status: "preparing" };
        return new Response(JSON.stringify({ code: 0, msg: "success", data }));
      },
    },
  });
  const agent = {
    conversationRowsRangeV4: async () => ({
      rows,
      atSeq: 1,
      atRevision: 1,
      atLogEpoch: "epoch",
      hasMore: false,
    }),
    conversationFileChangesV4: async () => {
      throw new Error("No file changes expected");
    },
    conversationAttachmentReadV4: async () => {
      throw new Error("No attachments expected");
    },
    conversationAttachmentStatV4: async () => {
      throw new Error("No attachments expected");
    },
  };
  return {
    dir,
    client,
    agent,
    requests,
    switchOwner: () => {
      owner = "B";
    },
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

test("actual publish stops after paused A rows resume under B, before preparation/upload/confirm", async () => {
  const f = await fixture();
  const entered = barrier();
  const release = barrier();
  f.agent.conversationRowsRangeV4 = async () => {
    entered.resolve();
    await release.promise;
    return { rows, atSeq: 1, atRevision: 1, atLogEpoch: "epoch", hasMore: false };
  };
  const service = new ConversationShareService({
    client: f.client,
    zcodeAgentService: f.agent,
    artifactSource: createLocalConversationShareArtifactSource(),
    conversationWorkspaceRoot: f.dir,
  });
  try {
    const pending = service.publish(
      {
        workspacePath: f.dir,
        sessionId: "session",
        title: "Share",
        accessMode: "public_importable",
        selection: { kind: "all" },
        clientRequestId: "publish",
        disclosureAcceptedAt: 1,
      },
      "publish",
    );
    const rejected = assert.rejects(pending, /owner changed/i);
    await entered.promise;
    assert.deepEqual(f.requests, [{ path: "/shares/capabilities", token: "Bearer official-A" }]);
    f.switchOwner();
    release.resolve();
    await rejected;
    assert.deepEqual(f.requests, [{ path: "/shares/capabilities", token: "Bearer official-A" }]);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

test("actual publish stops after paused A artifact collection resumes under B", async () => {
  const f = await fixture();
  const entered = barrier();
  const release = barrier();
  await writeFile(join(f.dir, "result.pdf"), "A's local artifact bytes");
  const artifactRows = [
    ...rows,
    conversationRowSchema.parse({
      rowId: 3,
      turnId: "turn",
      productTurnId: "turn",
      createdAt: 1,
      createdAtSeq: 3,
      kind: "assistantText",
      state: "complete",
      text: "Result: `result.pdf`",
    }),
  ];
  f.agent.conversationRowsRangeV4 = async () => ({
    rows: artifactRows,
    atSeq: 1,
    atRevision: 1,
    atLogEpoch: "epoch",
    hasMore: false,
  });
  const artifactSource = createLocalConversationShareArtifactSource();
  const read = artifactSource.read.bind(artifactSource);
  artifactSource.read = async (input) => {
    entered.resolve();
    await release.promise;
    return read(input);
  };
  const service = new ConversationShareService({
    client: f.client,
    zcodeAgentService: f.agent,
    artifactSource,
    conversationWorkspaceRoot: f.dir,
  });
  try {
    const pending = service.publish(
      {
        workspacePath: f.dir,
        sessionId: "session",
        title: "Share",
        accessMode: "public_importable",
        selection: { kind: "all" },
        clientRequestId: "artifact-publish",
        disclosureAcceptedAt: 1,
      },
      "artifact-publish",
    );
    const rejected = assert.rejects(pending, /owner changed/i);
    await entered.promise;
    f.switchOwner();
    release.resolve();
    await rejected;
    assert.deepEqual(f.requests, [{ path: "/shares/capabilities", token: "Bearer official-A" }]);
    assert.equal(await readFile(join(f.dir, "result.pdf"), "utf8"), "A's local artifact bytes");
  } finally {
    release.resolve();
    await f.dispose();
  }
});

test("actual import passes its fence through awaited session MCP preparation before durable create and index", async () => {
  const f = await fixture();
  const entered = barrier();
  const release = barrier();
  const agent = createZCodeAgentService();
  const repo = new TaskIndexRepo(join(f.dir, "task-index.sqlite"));
  const syncer = createZCodeTaskIndexSyncer({ agentService: agent, taskIndexRepo: repo });
  let broadcasts = 0;
  const subscription = syncer.onDynamicWorkspaceEvent(f.dir)(() => {
    broadcasts++;
  });
  let durableCreates = 0;
  // Only the durable port is substituted: import and session-service admission are production consumers.
  agent.createSession = async () => {
    durableCreates++;
    throw new Error("Durable create must not be reached");
  };
  const sessionService = createZCodeSessionService({
    agentService: agent,
    taskIndexSyncer: syncer,
    cuaProductMcpServerResolver: {
      resolveMcpServers: async (servers) => {
        entered.resolve();
        await release.promise;
        return servers;
      },
      restart: async () => {
        throw new Error("Helper restart is not part of import");
      },
      restartAfterPermissionGrant: async () => {
        throw new Error("Permission restart is not part of import");
      },
    },
  });
  const service = new ConversationShareService({
    client: f.client,
    zcodeAgentService: f.agent,
    artifactSource: createLocalConversationShareArtifactSource(),
    conversationWorkspaceRoot: f.dir,
    zcodeSessionService: sessionService,
  });
  try {
    const pending = service.importShare(
      { shareCode: "code", clientRequestId: "import", targetWorkspacePath: f.dir },
      "import",
    );
    const rejected = assert.rejects(pending, /owner changed/i);
    await entered.promise;
    f.switchOwner();
    release.resolve();
    await rejected;
    assert.equal(durableCreates, 0);
    assert.deepEqual(await repo.listTaskMetas({ workspacePath: f.dir }), []);
    assert.equal(broadcasts, 0);
    await assert.rejects(
      readFile(join(f.dir, ".zcode-share", "share", "shared-conversation.json")),
      { code: "ENOENT" },
    );
  } finally {
    release.resolve();
    subscription.dispose();
    syncer.disposeAll();
    repo.close();
    await agent.disposeAllAndWait();
    await f.dispose();
  }
});

test("real task index transaction rejects a captured owner lost while SQLite admission waits", async () => {
  const f = await fixture();
  const entered = barrier();
  const release = barrier();
  const agent = createZCodeAgentService();
  const repo = new TaskIndexRepo(join(f.dir, "task-index.sqlite"));
  const syncer = createZCodeTaskIndexSyncer({ agentService: agent, taskIndexRepo: repo });
  const persist = repo.syncTaskMetaAtGroupedTop.bind(repo);
  repo.syncTaskMetaAtGroupedTop = async (params) => {
    entered.resolve();
    await release.promise;
    return persist(params);
  };
  const snapshot = zcodeSessionStateSnapshotSchema.parse({
    protocol: { name: ZCODE_PROTOCOL_NAME, version: ZCODE_PROTOCOL_VERSION },
    session: {
      sessionId: "share-import-test",
      workspace: { workspacePath: f.dir, workspaceKey: f.dir },
      sessionKind: "interactive",
      title: "Shared content",
      mode: "build",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
    },
    settings: {
      model: { available: [] },
      thoughtLevel: { enabled: false, available: [] },
      mode: { current: "build" },
    },
    projection: {
      sessionId: "share-import-test",
      status: "idle",
      mode: "build",
      turnCount: 0,
      totalTokenCount: 0,
      contextUsed: 0,
      contextWindow: 200000,
      pendingPermissions: [],
      activeToolCalls: [],
      backgroundJobs: [],
    },
    runtime: { eventSeq: 0, stateRevision: 0, pendingRequestIds: [] },
    messages: [],
  });
  const operation = await f.client.captureOperation();
  let broadcasts = 0;
  const subscription = syncer.onDynamicWorkspaceEvent(f.dir)(() => {
    broadcasts++;
  });
  try {
    const pending = syncer.syncSnapshotAndBroadcast(snapshot, {
      moveGroupedTaskToTop: true,
      broadcastReason: "task_meta_changed",
      assertCurrent: operation.assertCurrentOwner,
      assertCurrentSync: operation.assertCurrentSync,
    });
    const rejected = assert.rejects(pending, /owner changed/i);
    await entered.promise;
    f.switchOwner();
    release.resolve();
    await rejected;
    assert.deepEqual(await repo.listTaskMetas({ workspacePath: f.dir }), []);
    assert.equal(broadcasts, 0);
  } finally {
    release.resolve();
    subscription.dispose();
    syncer.disposeAll();
    repo.close();
    await agent.disposeAllAndWait();
    await f.dispose();
  }
});

test("actual import preserves installed artifacts after durable acknowledgement but rejects stale result", async () => {
  const f = await fixture();
  const agent = createZCodeAgentService();
  agent.createSession = async (params) => {
    const snapshot = zcodeSessionStateSnapshotSchema.parse({
      protocol: { name: ZCODE_PROTOCOL_NAME, version: ZCODE_PROTOCOL_VERSION },
      session: {
        sessionId: params.sessionId,
        workspace: { workspacePath: f.dir, workspaceKey: f.dir },
        sessionKind: "interactive",
        title: "Shared content",
        mode: "build",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
      },
      settings: {
        model: { available: [] },
        thoughtLevel: { enabled: false, available: [] },
        mode: { current: "build" },
      },
      projection: {
        sessionId: params.sessionId,
        status: "idle",
        mode: "build",
        turnCount: 0,
        totalTokenCount: 0,
        contextUsed: 0,
        contextWindow: 200000,
        pendingPermissions: [],
        activeToolCalls: [],
        backgroundJobs: [],
      },
      runtime: { eventSeq: 0, stateRevision: 0, pendingRequestIds: [] },
      messages: [],
    });
    params[sessionCreateAdmission]?.onCommitted();
    f.switchOwner();
    return snapshot;
  };
  const sessionService = createZCodeSessionService({ agentService: agent });
  const service = new ConversationShareService({
    client: f.client,
    zcodeAgentService: f.agent,
    artifactSource: createLocalConversationShareArtifactSource(),
    conversationWorkspaceRoot: f.dir,
    zcodeSessionService: sessionService,
  });
  try {
    await assert.rejects(
      service.importShare(
        { shareCode: "code", clientRequestId: "import", targetWorkspacePath: f.dir },
        "import",
      ),
      /owner changed/i,
    );
    const installed = JSON.parse(
      await readFile(join(f.dir, ".zcode-share", "share", "shared-conversation.json"), "utf8"),
    );
    assert.deepEqual(installed.rows, rows);
  } finally {
    await agent.disposeAllAndWait();
    await f.dispose();
  }
});
