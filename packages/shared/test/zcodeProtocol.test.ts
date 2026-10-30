// XCODE: Aiscoo 专属回归；上游 App 业务套件已退役，仅保留下游差异的断言。
import { describe, expect, it } from "vitest";
import { zcodeSessionEventSchema } from "../src/zcode-protocol/index.js";

describe("Aiscoo strict tool and queue metadata", () => {
  // XCODE: 真实 Bot Worker 的 started 能力字段曾被 Host strict schema 当未知字段丢掉。
  describe.each(["desktop-continuous", "web-remote-replayable"])(
    "started tool capability metadata (%s)",
    (deliveryKind) => {
      const event = {
        eventId: "evt_started_capability",
        seq: 2,
        sessionId: "sess_capability",
        timestamp: 2,
        traceId: "trace_capability",
        turnId: "turn_capability",
        deliveryKind,
        type: "tool.updated",
        payload: {
          kind: "started",
          toolCallId: "call_capability",
          toolName: "Bash",
          startedAt: 2,
        },
      };
      const mcpDisplay = {
        kind: "mcp_tool",
        serverName: "fixture-mcp",
        toolName: "show_dashboard",
        description: "Open the fixture dashboard",
        ui: {
          pluginId: "fixture-plugin",
          resourceUri: "ui://fixture/dashboard.html",
          preferredDisplayMode: "inline",
          prefersBorder: false,
          csp: {
            connectDomains: ["https://api.example.com"],
            resourceDomains: ["https://assets.example.com"],
            frameDomains: ["https://frames.example.com"],
            baseUriDomains: ["https://base.example.com"],
          },
          surface: "dashboard",
          showInline: true,
        },
      };

      // XCODE: executor 在 MCP handler 前就发送 display，不能只修能力字段后仍丢弃插件 started。
      it.each([
        {
          kind: "mcp_tool",
          serverName: "fixture-mcp",
          toolName: "show_dashboard",
        },
        mcpDisplay,
      ])(
        "retains actual MCP started display and resolved capability fields: %j",
        (display) => {
          const payload = {
            ...event.payload,
            toolName: "mcp__fixture-mcp__show_dashboard",
            readOnly: false,
            sideEffectScope: "network",
            display,
          };
          expect(zcodeSessionEventSchema.parse({ ...event, payload })).toEqual({
            ...event,
            payload,
          });
        },
      );

      it.each([
        null,
        { ...mcpDisplay, unknownDisplayField: true },
        { ...mcpDisplay, serverName: "" },
        { ...mcpDisplay, toolName: "x".repeat(257) },
        { ...mcpDisplay, description: "x".repeat(4097) },
        { ...mcpDisplay, ui: { ...mcpDisplay.ui, resourceUri: "" } },
        { ...mcpDisplay, ui: { ...mcpDisplay.ui, prefersBorder: "false" } },
        {
          ...mcpDisplay,
          ui: { ...mcpDisplay.ui, preferredDisplayMode: "popup" },
        },
        { ...mcpDisplay, ui: { ...mcpDisplay.ui, unknownUiField: true } },
        {
          ...mcpDisplay,
          ui: { ...mcpDisplay.ui, csp: { connectDomains: [42] } },
        },
        {
          ...mcpDisplay,
          ui: {
            ...mcpDisplay.ui,
            csp: { ...mcpDisplay.ui.csp, unknownCspField: true },
          },
        },
      ])(
        "rejects malformed or unknown nested MCP display fields: %j",
        (display) => {
          expect(
            zcodeSessionEventSchema.safeParse({
              ...event,
              payload: {
                ...event.payload,
                readOnly: false,
                sideEffectScope: "network",
                display,
              },
            }).success,
          ).toBe(false);
        },
      );

      it.each([
        "none",
        "workspace",
        "git",
        "network",
        "system",
        "session",
        "userInteraction",
      ])(
        "retains resolved capability metadata for scope %s",
        (sideEffectScope) => {
          for (const readOnly of [true, false]) {
            const payload = { ...event.payload, readOnly, sideEffectScope };
            expect(
              zcodeSessionEventSchema.parse({ ...event, payload }),
            ).toEqual({
              ...event,
              payload,
            });
          }
        },
      );

      it.each([
        {},
        { readOnly: true },
        { readOnly: false },
        { sideEffectScope: "workspace" },
      ])(
        "accepts independently omitted capability fields without adding defaults: %j",
        (capability) => {
          const payload = { ...event.payload, ...capability };
          expect(
            zcodeSessionEventSchema.parse({ ...event, payload }).payload,
          ).toEqual(payload);
        },
      );

      it.each([
        { readOnly: "true" },
        { readOnly: 1 },
        { readOnly: null },
        { sideEffectScope: "" },
        { sideEffectScope: "filesystem" },
        { sideEffectScope: "user_interaction" },
        { sideEffectScope: 1 },
        { sideEffectScope: null },
        { unknownCapability: true },
      ])("rejects malformed or unknown capability fields: %j", (invalid) => {
        expect(
          zcodeSessionEventSchema.safeParse({
            ...event,
            payload: {
              ...event.payload,
              readOnly: false,
              sideEffectScope: "workspace",
              ...invalid,
            },
          }).success,
        ).toBe(false);
      });

      it.each(["scheduled", "progress"])(
        "rejects started-only metadata on %s",
        (kind) => {
          expect(
            zcodeSessionEventSchema.safeParse({
              ...event,
              payload: {
                kind,
                toolCallId: "call_capability",
                toolName: "Bash",
                readOnly: false,
                sideEffectScope: "workspace",
              },
            }).success,
          ).toBe(false);
        },
      );
    },
  );

  // XCODE: CLI 抢占式输入在 turn.steerQueued 上携带 inputPresentation；漏声明会让 Host 丢弃整条队列事实。
  it.each([
    "user_steer",
    "coordinator_steer",
    "coordinator_input",
    "subagent_reply_steer",
    "subagent_reply",
    "task_notification_steer",
    "task_notification",
  ])("retains turn.steerQueued inputPresentation %s", (inputPresentation) => {
    const event = zcodeSessionEventSchema.parse({
      eventId: "evt_steer_presentation",
      seq: 9,
      sessionId: "sess_1",
      timestamp: 10,
      type: "turn.steerQueued",
      payload: {
        pendingInputId: "pending_1",
        input: "继续",
        inputPreview: "继续",
        inputSize: 2,
        inputPresentation,
        targetTurnId: "turn_1",
        queueLength: 1,
      },
    });
    expect(event.payload).toMatchObject({ inputPresentation });
  });

  it.each(["", "user", "USER_STEER", 1, null])(
    "rejects invalid turn.steerQueued inputPresentation %j",
    (inputPresentation) => {
      expect(
        zcodeSessionEventSchema.safeParse({
          eventId: "evt_steer_presentation_bad",
          seq: 9,
          sessionId: "sess_1",
          timestamp: 10,
          type: "turn.steerQueued",
          payload: {
            pendingInputId: "pending_1",
            input: "继续",
            inputPreview: "继续",
            inputSize: 2,
            inputPresentation,
            targetTurnId: "turn_1",
            queueLength: 1,
          },
        }).success,
      ).toBe(false);
    },
  );
});
