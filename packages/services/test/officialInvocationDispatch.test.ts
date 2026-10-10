import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "@zcode/rpc";
import { zcodeProtocolMethods, type ZCodeProtocolMessage } from "@zcode/shared";
import { ZCodeProtocolClient } from "../src/zcode-agent/zcodeProtocolClient.js";
import { readSharedImportCommitStatus } from "../src/zcode-agent/zcodeAgentErrors.js";

// XCODE: 真实 client 的 storage/abort 准备不能冒充已派发的持久导入。
test("session-create synchronous dispatch admission can reject before transport IO", async () => {
  const messages = new Emitter<ZCodeProtocolMessage>();
  const closes = new Emitter<{ reason?: string }>();
  let writes = 0;
  const client = new ZCodeProtocolClient({
    kind: "memory",
    onMessage: messages.event,
    onClose: closes.event,
    send: async () => {
      writes++;
    },
    dispose() {},
  });
  try {
    await assert.rejects(
      client.request(zcodeProtocolMethods.sessionCreate, {}, undefined, {
        onDispatch: () => {
          throw new Error("captured owner changed");
        },
      }),
      /captured owner changed/,
    );
    assert.equal(writes, 0);
    assert.equal(client.pendingRequestCount, 0);
  } finally {
    client.dispose();
    messages.dispose();
    closes.dispose();
  }
});

test("storage failure before dispatch never invokes session-create dispatch admission", async () => {
  const messages = new Emitter<ZCodeProtocolMessage>();
  const closes = new Emitter<{ reason?: string }>();
  let dispatched = false;
  let writes = 0;
  const client = new ZCodeProtocolClient(
    {
      kind: "memory",
      onMessage: messages.event,
      onClose: closes.event,
      send: async () => {
        writes++;
      },
      dispose() {},
    },
    { requireStorageStartup: true },
  );
  const pending = client.request(zcodeProtocolMethods.sessionCreate, {}, undefined, {
    onDispatch: () => {
      dispatched = true;
    },
  });
  const rejected = assert.rejects(pending, /storage|closed|disposed/i);
  client.dispose();
  await rejected;
  assert.equal(dispatched, false);
  assert.equal(writes, 0);
  messages.dispose();
  closes.dispose();
});

test("transport interruption after session-create dispatch preserves the uncertainty signal", async () => {
  const messages = new Emitter<ZCodeProtocolMessage>();
  const closes = new Emitter<{ reason?: string }>();
  let dispatched = false;
  const client = new ZCodeProtocolClient({
    kind: "memory",
    onMessage: messages.event,
    onClose: closes.event,
    send: async () => {
      throw new Error("connection interrupted after write");
    },
    dispose() {},
  });
  try {
    await assert.rejects(
      client.request(zcodeProtocolMethods.sessionCreate, {}, undefined, {
        onDispatch: () => {
          dispatched = true;
        },
      }),
      /connection interrupted/,
    );
    assert.equal(dispatched, true);
    assert.equal(client.pendingRequestCount, 0);
  } finally {
    client.dispose();
    messages.dispose();
    closes.dispose();
  }
});

test("shared import commit acknowledgement accepts only own exact fields for the dispatched session", () => {
  assert.equal(
    readSharedImportCommitStatus(
      { data: { sharedImportCommit: { sessionId: "A", committed: true } } },
      "A",
    ),
    true,
  );
  assert.equal(
    readSharedImportCommitStatus(
      { data: { sharedImportCommit: { sessionId: "A", committed: false } } },
      "A",
    ),
    false,
  );
  for (const error of [
    { data: { sharedImportCommit: { sessionId: "B", committed: true } } },
    { data: { sharedImportCommit: { sessionId: "A", committed: "true" } } },
    { data: { sharedImportCommit: { sessionId: "A", committed: true, extra: true } } },
    { data: { sharedImportCommit: Object.create({ sessionId: "A", committed: true }) } },
    { data: Object.create({ sharedImportCommit: { sessionId: "A", committed: true } }) },
    Object.create({ data: { sharedImportCommit: { sessionId: "A", committed: true } } }),
    new Error("transport interrupted"),
  ])
    assert.equal(readSharedImportCommitStatus(error, "A"), null);
  assert.equal(
    readSharedImportCommitStatus(
      { data: { sharedImportCommit: { sessionId: "A", committed: true } } },
      undefined,
    ),
    null,
  );
});
