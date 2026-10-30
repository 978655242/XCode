import { join } from "node:path";
import {
  createServerHostServices,
  createTopicResourcePeers,
  getAppConfigDir,
  // XCODE: 本机 Web 只注入自身账号工厂与清理能力。
  createLocalWebNewApiAccountFactory,
  disposeServiceResourcesAndWait,
} from "@zcode/services/node";
import {
  materializeBundledZCodeBuiltinProviderConfig,
  readBundledZCodeBuiltinProviderConfig,
} from "./bundledZCodeBuiltinProviderConfig.js";
import { createHttpServer, resolveHttpServerId } from "./http.js";
// XCODE: 本机 Web 生命周期由下游模块持有，普通 Server 保留原启动路径。
import { startAiscooLocalWebHttpEntry } from "./aiscoo-local-web/index.js";

async function main(): Promise<void> {
  const zcodeBuiltinProviderConfigFilePath = await materializeBundledZCodeBuiltinProviderConfig({
    // 修复原因：CLI SEA 使用共享 bundled 路径，并发物化会覆盖运行中进程的基线。
    environmentConfigRoot:
      process.env["AISCOO_LOCAL_WEB"] === "1"
        ? join(getAppConfigDir(), "local-web", "new-api")
        : getAppConfigDir(),
    content: readBundledZCodeBuiltinProviderConfig(),
  });
  // XCODE: 仅显式启用时使用本机 Web 的独立装配和关闭生命周期。
  if (process.env["AISCOO_LOCAL_WEB"] === "1") {
    return startAiscooLocalWebHttpEntry({
      zcodeBuiltinProviderConfigFilePath,
      createLocalWebNewApiAccountFactory,
      createTopicResourcePeers,
      resolveHttpServerId,
      createServerHostServices,
      createHttpServer,
      disposeServiceResourcesAndWait,
    });
  }
  const port = Number(process.env["PORT"]) || 3030;
  const host = process.env["ZCODE_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["ZCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["ZCODE_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const topicResourcePeers = createTopicResourcePeers();
  const serverId = resolveHttpServerId();
  const { services, workspaceIdentityMapper, migrationFailedPathCount } =
    await createServerHostServices({
      topicResourceRelayChannel: (request) => topicResourcePeers.getChannel(request),
      sourceServerId: serverId,
      zcodeBuiltinProviderConfigFilePath,
      providerProvisioningTargetEnabled: Boolean(authToken),
    });

  createHttpServer(services, port, {
    serverId,
    workspaceIdentityMapper,
    migrationFailedPathCount,
    virtualProjects: true,
    topicResourcePeers,
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[zcode-server:http] startup failed", error);
  process.exitCode = 1;
});
