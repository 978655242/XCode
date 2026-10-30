import type { Server, Socket } from "node:net";

interface LocalWebEntryDependencies<
  Factory extends { dispose(): Promise<void> },
  Channel,
  Peers extends { getChannel(request: unknown): Channel },
  Services,
  WorkspaceIdentityMapper,
> {
  zcodeBuiltinProviderConfigFilePath: string;
  createLocalWebNewApiAccountFactory(options: { origin: string }): Promise<Factory>;
  createTopicResourcePeers(): Peers;
  resolveHttpServerId(): string;
  createServerHostServices(options: {
    topicResourceRelayChannel(request: unknown): Channel;
    sourceServerId: string;
    zcodeBuiltinProviderConfigFilePath: string;
    providerProvisioningTargetEnabled: boolean;
    newApiAccountFactory: NoInfer<Factory>;
  }): Promise<{
    services: Services;
    workspaceIdentityMapper: WorkspaceIdentityMapper;
    migrationFailedPathCount: number;
  }>;
  createHttpServer(
    services: Services,
    port: number,
    options: {
      serverId: string;
      workspaceIdentityMapper: WorkspaceIdentityMapper;
      migrationFailedPathCount: number;
      virtualProjects: boolean;
      topicResourcePeers: NoInfer<Peers>;
      host: string;
      staticRoot?: string;
      spaFallback?: boolean;
      localWeb: { allowedOrigins: string[] };
    },
  ): Server;
  disposeServiceResourcesAndWait(services: Services): Promise<void>;
}

/** Owns the local Web factory, Host and HTTP connections until shutdown completes. */
export async function startAiscooLocalWebHttpEntry<
  Factory extends { dispose(): Promise<void> },
  Channel,
  Peers extends { getChannel(request: unknown): Channel },
  Services,
  WorkspaceIdentityMapper,
>(
  dependencies: LocalWebEntryDependencies<
    Factory,
    Channel,
    Peers,
    Services,
    WorkspaceIdentityMapper
  >,
): Promise<void> {
  const port = Number(process.env["PORT"]) || 3030;
  const configuredHost = process.env["ZCODE_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim();
  const host = configuredHost || "127.0.0.1";
  const staticRoot = process.env["ZCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["ZCODE_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const localWebOrigins =
    process.env["AISCOO_LOCAL_WEB_ORIGINS"]
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("本机 Web Server 端口无效");
  }
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("本机 Web Server 只能监听回环地址");
  }
  if (authToken || localWebOrigins.length === 0) {
    throw new Error("本机 Web 需要配置可信来源，且不能同时启用旧 token 模式");
  }

  let localWebNewApi: Factory | undefined;
  let services: Services | undefined;
  let server: Server | undefined;
  const sockets = new Set<Socket>();
  let startupComplete = false;
  let shutdownRequested = false;
  let shutdownStarted = false;
  let exitCode = 0;
  const shutdown = (code = 0) => {
    exitCode = Math.max(exitCode, code);
    shutdownRequested = true;
    if (!startupComplete || shutdownStarted) return;
    shutdownStarted = true;
    void (async () => {
      if (server) {
        try {
          await new Promise<void>((resolve, reject) => {
            server!.close((error) => {
              // 尚未监听成功或已收到 close 时，Node 报此错误但无需再次关闭。
              if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
                reject(error);
              } else {
                resolve();
              }
            });
            // Node 的 close 不关闭 WebSocket；先切断已有连接，避免关闭永久等待。
            for (const socket of sockets) socket.destroy();
          });
        } catch (error) {
          exitCode = 1;
          console.error("[zcode-server:http] server close failed", error);
        }
      }
      try {
        await localWebNewApi?.dispose();
      } catch (error) {
        exitCode = 1;
        console.error("[zcode-server:http] factory cleanup failed", error);
      }
      try {
        if (services) await dependencies.disposeServiceResourcesAndWait(services);
      } catch (error) {
        exitCode = 1;
        console.error("[zcode-server:http] service cleanup failed", error);
      }
      process.exit(exitCode);
    })();
  };

  // 装配期间也可能收到 SIGTERM；先记录请求，待已创建的资源可被持有后清理。
  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
  try {
    localWebNewApi = await dependencies.createLocalWebNewApiAccountFactory({
      origin: process.env["NEW_API_BASE_URL"] ?? "",
    });
    if (shutdownRequested) return;
    const topicResourcePeers = dependencies.createTopicResourcePeers();
    const serverId = dependencies.resolveHttpServerId();
    const hostServices = await dependencies.createServerHostServices({
      topicResourceRelayChannel: (request) => topicResourcePeers.getChannel(request),
      sourceServerId: serverId,
      zcodeBuiltinProviderConfigFilePath: dependencies.zcodeBuiltinProviderConfigFilePath,
      providerProvisioningTargetEnabled: Boolean(authToken),
      newApiAccountFactory: localWebNewApi,
    });
    services = hostServices.services;
    if (shutdownRequested) return;
    server = dependencies.createHttpServer(services, port, {
      serverId,
      workspaceIdentityMapper: hostServices.workspaceIdentityMapper,
      migrationFailedPathCount: hostServices.migrationFailedPathCount,
      virtualProjects: true,
      topicResourcePeers,
      host,
      ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
      localWeb: { allowedOrigins: localWebOrigins },
    });
    // 端口冲突由 Node 异步触发 error，不能仅依靠 main 的异常处理。
    server.on("error", (error) => {
      console.error("[zcode-server:http] server error", error);
      shutdown(1);
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    server.once("close", () => shutdown());
  } catch (error) {
    console.error("[zcode-server:http] startup failed", error);
    shutdown(1);
  } finally {
    startupComplete = true;
    if (shutdownRequested) shutdown();
  }
}
