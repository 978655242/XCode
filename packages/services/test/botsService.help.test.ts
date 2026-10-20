import { describe, expect, it } from "vitest";
import * as f from "./botsService.fixtures.js";

const actor = {
  provider: "webhook" as const,
  botId: "webhook-1",
  providerUserId: "user-1",
  chatType: "private" as const,
};

describe("botsService help", () => {
  it("shows command help after binding succeeds", async () => {
    const repo = f.createMemoryRepo(f.baseConfig);
    const service = f.createBotsService({
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
      legacyTaskService: f.createLegacyTaskService(),
      repo: repo as never,
    });

    const code = await service.createBindCode({ botId: "webhook-1" });
    const replies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: `/bind ${code.code}`,
      actor,
    });

    expect(replies[0]?.text).toContain("/帮助");
    service.disposeAll();
  });

  it("returns concise Chinese command help for /帮助", async () => {
    const repo = f.createMemoryRepo(f.baseConfig);
    const service = f.createBotsService({
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
      legacyTaskService: f.createLegacyTaskService(),
      repo: repo as never,
    });

    const code = await service.createBindCode({ botId: "webhook-1" });
    await service.handleInboundMessage({
      botId: "webhook-1",
      text: `/bind ${code.code}`,
      actor,
    });
    const replies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/帮助",
      actor,
    });

    for (const command of [
      "/帮助",
      "/状态",
      "/新建",
      "/clear",
      "/项目",
      "/模型",
      "/模式",
      "/思考",
      "/回复",
      "/bind",
    ]) {
      expect(replies[0]?.text).toContain(command);
    }
    service.disposeAll();
  });

  it("returns English command help with new or clear wording", async () => {
    const repo = f.createMemoryRepo(f.baseConfig);
    const service = f.createBotsService({
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
      legacyTaskService: f.createLegacyTaskService(),
      repo: repo as never,
      settingService: f.createSettingService({
        locale: "en-US",
        lastWorkspaceSession: [
          {
            kind: "remote",
            workspacePath: "/tmp/workspace",
            workspaceIdentity: "remote:server:test-owner:/tmp/workspace",
          },
        ],
      }),
    });

    const code = await service.createBindCode({ botId: "webhook-1" });
    await service.handleInboundMessage({
      botId: "webhook-1",
      text: `/bind ${code.code}`,
      actor,
    });
    const replies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/help",
      actor,
    });

    expect(replies[0]?.text).toContain("/new or /clear — Start a new task draft");
    service.disposeAll();
  });
});
