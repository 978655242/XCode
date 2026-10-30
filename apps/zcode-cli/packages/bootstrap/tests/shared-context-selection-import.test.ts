import { describe, expect, it, vi } from "vitest";
import type { SessionStorePort } from "@zcode/contracts";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";
import { createSessionRecordForV4, closeSession } from "../src/zcode-protocol/server-operations.js";
import {
  ProtocolRequestError,
  toProtocolError,
  type ZCodeProtocolAgentServerContext,
} from "../src/zcode-protocol/server-types.js";
import { getSessionLifecycle } from "../src/zcode-protocol/session-residency.js";
import { createFakeApp } from "./helpers/fake-zcode-app.js";

describe("分享上下文导入与当前选择合同", () => {
  it.each(["", "account:zai-individual-coding-plan/GLM-5.3"])(
    "导入保留完整上下文，不要求可执行模型：%s",
    async (model) => {
      const commitSharedContextImportBundle = vi.fn<
        NonNullable<SessionStorePort["commitSharedContextImportBundle"]>
      >(async () => {});
      const resume = vi.fn(async () => undefined);
      const server = new ZCodeProtocolAgentServer({
        sessionStore: {
          commitSharedContextImportBundle,
          getSession: async () => null,
        } as unknown as SessionStorePort,
        createZCodeApp: (options) => createFakeApp(options, { getModel: () => model, resume }),
      });
      const context = (server as unknown as { context: ZCodeProtocolAgentServerContext }).context;
      const sessionId = "shared-context-model-test";
      try {
        await expect(
          createSessionRecordForV4(context, {
            sessionId,
            workspace: { workspacePath: "/fixture", workspaceKey: "/fixture" },
            importedHistory: {
              source: "sharedContext",
              title: "来自分享：测试",
              markdown: "保留分享上下文",
              provenance: {
                shareId: "share-test",
                projectionSha256: "a".repeat(64),
                artifactSetSha256: "b".repeat(64),
                markdownSha256: "c".repeat(64),
                formatterVersion: 1,
                installedArtifacts: [],
              },
            },
          }),
        ).resolves.toEqual({ sessionId });
        expect(commitSharedContextImportBundle).toHaveBeenCalledTimes(1);
        const bundle = commitSharedContextImportBundle.mock.calls[0]![0] as unknown as Parameters<
          NonNullable<SessionStorePort["commitSharedContextImportBundle"]>
        >[0];
        expect(bundle.contextMessage.info).not.toHaveProperty("model");
        expect(bundle.contextMessage.info).toMatchObject({
          visibility: "model-only",
          source: "shared_context",
        });
        if (model) {
          expect(bundle.contextMessage.info).toHaveProperty("modelSelection", {
            providerId: "account:zai-individual-coding-plan",
            modelId: "GLM-5.3",
          });
        } else {
          expect(bundle.contextMessage.info).not.toHaveProperty("modelSelection");
        }
        expect(bundle.contextMessage.parts[0]).toMatchObject({ text: "保留分享上下文" });
        expect(resume).toHaveBeenCalledTimes(1);
      } finally {
        if (context.sessions.has(sessionId)) await closeSession(context, { sessionId });
      }
    },
  );

  it("物化期间 owner 换号不提交分享，生命周期只关闭一次", async () => {
    let current = true;
    const close = vi.fn(async () => {});
    const commitSharedContextImportBundle = vi.fn(async () => {});
    const server = new ZCodeProtocolAgentServer({
      sessionStore: {
        commitSharedContextImportBundle,
        getSession: async () => null,
      } as unknown as SessionStorePort,
      isAccountScopeCurrent: () => current,
      createZCodeApp: (options) => {
        current = false;
        return createFakeApp(options, { close });
      },
    });
    const context = (server as unknown as { context: ZCodeProtocolAgentServerContext }).context;
    context.requestClient = vi.fn(async () => ({ ok: true })) as typeof context.requestClient;
    const params = scopedImportParams("shared-owner-change");

    await expect(createSessionRecordForV4(context, params)).rejects.toMatchObject({
      code: -32003,
      data: { sharedImportCommit: { sessionId: params.sessionId, committed: false } },
    });
    expect(commitSharedContextImportBundle).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(context.sessions.has(params.sessionId)).toBe(false);
    expect(context.sessionLifecycle?.isReady(params.sessionId)).toBe(false);
  });

  it.each([false, true])(
    "已提交分享恢复失败保留提交事实，close 失败=%s 时沿生命周期隔离",
    async (closeFails) => {
      const resumeError = new Error("resume failed");
      const closeError = new Error("close failed");
      const close = vi.fn(async () => {
        if (closeFails) throw closeError;
      });
      const commitSharedContextImportBundle = vi.fn<
        NonNullable<SessionStorePort["commitSharedContextImportBundle"]>
      >(async (bundle) => bundle.assertCurrent?.());
      const server = new ZCodeProtocolAgentServer({
        sessionStore: {
          commitSharedContextImportBundle,
          getSession: async () => null,
        } as unknown as SessionStorePort,
        isAccountScopeCurrent: () => true,
        createZCodeApp: (options) =>
          createFakeApp(options, {
            close,
            resume: async () => {
              throw resumeError;
            },
          }),
      });
      const context = (server as unknown as { context: ZCodeProtocolAgentServerContext }).context;
      context.requestClient = vi.fn(async () => ({ ok: true })) as typeof context.requestClient;
      const params = scopedImportParams(`shared-committed-${closeFails}`);
      let failure: unknown;
      try {
        await createSessionRecordForV4(context, params);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(ProtocolRequestError);
      expect(toProtocolError(failure)).toMatchObject({
        code: -32003,
        data: { sharedImportCommit: { sessionId: params.sessionId, committed: true } },
      });
      expect(commitSharedContextImportBundle).toHaveBeenCalledTimes(1);
      expect(commitSharedContextImportBundle.mock.calls[0]?.[0].assertCurrent).toBeTypeOf("function");
      expect(close).toHaveBeenCalledTimes(1);
      expect(context.sessions.has(params.sessionId)).toBe(false);
      if (closeFails) {
        expect((failure as Error).cause).toBeInstanceOf(AggregateError);
        const cleanupFailure = ((failure as Error).cause as AggregateError).errors[1];
        expect(cleanupFailure).toBeInstanceOf(AggregateError);
        expect(cleanupFailure.errors).toEqual([closeError]);
        await expect(getSessionLifecycle(context).ensureReady(params.sessionId)).rejects.toMatchObject({
          code: "recoveryRequired",
        });
        expect(close).toHaveBeenCalledTimes(1);
      }
    },
  );
});

function scopedImportParams(sessionId: string) {
  return {
    sessionId,
    officialInvocationScope: "fixture-owner-scope",
    workspace: { workspacePath: "/fixture", workspaceKey: "/fixture" },
    importedHistory: {
      source: "sharedContext",
      title: "来自分享：测试",
      markdown: "保留分享上下文",
      provenance: {
        shareId: "share-test",
        projectionSha256: "a".repeat(64),
        artifactSetSha256: "b".repeat(64),
        markdownSha256: "c".repeat(64),
        formatterVersion: 1,
        installedArtifacts: [],
      },
    },
  };
}
