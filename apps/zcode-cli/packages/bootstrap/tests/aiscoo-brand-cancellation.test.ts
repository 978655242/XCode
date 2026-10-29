import { describe, expect, it } from "vitest";
import { SessionEventType, type MessageWithParts } from "@zcode/contracts";
import { synthesizeEventsFromMessages } from "../src/zcode-protocol-v4/transcript-hydration.js";

describe("downstream brand cancellation compatibility", () => {
  it.each(["Aiscoo", "XWork", "XCode", "ZCode"])("treats persisted %s session stop as user cancellation", (product) => {
    const messages = [{
      info: { id: "user", sessionID: "session", role: "user", time: { created: 1 }, agent: "default", modelSelection: { providerId: "p", modelId: "m" } },
      parts: [{ id: "user-text", sessionID: "session", messageID: "user", type: "text", text: "stop" }],
    }, {
      info: { id: "assistant", sessionID: "session", role: "assistant", time: { created: 2, completed: 3 }, parentID: "user", modelId: "m", providerId: "p", mode: "default", agent: "default", path: { cwd: "/", root: "/" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, error: { name: "Error", data: { message: `${product} Protocol session stopped` } } },
      parts: [{ id: "assistant-text", sessionID: "session", messageID: "assistant", type: "text", text: "partial" }],
    }] as unknown as MessageWithParts[];
    const events = synthesizeEventsFromMessages(messages, { sessionId: "session" });
    expect(events.some((event) => event.type === SessionEventType.TurnError)).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: SessionEventType.TurnComplete, payload: expect.objectContaining({ resultType: "cancelled" }) }));
  });
});
