import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { createConnection, type AddressInfo, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFactory: vi.fn(),
  createHost: vi.fn(),
  disposeHost: vi.fn(),
  createHttpServer: vi.fn(),
}));

vi.mock("@zcode/services/node", () => ({
  createLocalWebNewApiAccountFactory: mocks.createFactory,
  createServerHostServices: mocks.createHost,
  createTopicResourcePeers: () => ({ getChannel: vi.fn() }),
  disposeServiceResourcesAndWait: mocks.disposeHost,
  getAppConfigDir: () => "/test/config",
}));
vi.mock("../src/bundledZCodeBuiltinProviderConfig.js", () => ({
  materializeBundledZCodeBuiltinProviderConfig: vi.fn().mockResolvedValue("/test/provider.json"),
  readBundledZCodeBuiltinProviderConfig: () => "{}",
}));
vi.mock("../src/http.js", () => ({
  createHttpServer: mocks.createHttpServer,
  resolveHttpServerId: () => "test-server",
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

describe("Aiscoo local Web HTTP entry lifecycle", () => {
  const servers = new Set<Server>();
  const sockets = new Set<Socket>();
  const services = {};
  let signals: EventEmitter;
  let factory: { dispose: ReturnType<typeof vi.fn> };
  let exit: ReturnType<typeof vi.spyOn>;
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.createFactory.mockReset();
    mocks.createHost.mockReset();
    mocks.disposeHost.mockReset();
    mocks.createHttpServer.mockReset();
    vi.stubEnv("AISCOO_LOCAL_WEB", "1");
    vi.stubEnv("AISCOO_LOCAL_WEB_ORIGINS", "http://127.0.0.1:5174");
    vi.stubEnv("NEW_API_BASE_URL", "http://127.0.0.1:3001");
    vi.stubEnv("ZCODE_SERVER_HOST", "127.0.0.1");
    vi.stubEnv("HOST", "");
    vi.stubEnv("ZCODE_SERVER_AUTH_TOKEN", "");
    vi.stubEnv("PORT", "3030");
    factory = { dispose: vi.fn().mockResolvedValue(undefined) };
    mocks.createFactory.mockResolvedValue(factory);
    mocks.createHost.mockResolvedValue({
      services,
      workspaceIdentityMapper: {},
      migrationFailedPathCount: 0,
    });
    mocks.disposeHost.mockResolvedValue(undefined);
    signals = new EventEmitter();
    const originalOn = process.on.bind(process);
    vi.spyOn(process, "on").mockImplementation(((
      event: string | symbol,
      listener: (...args: never[]) => void,
    ) => {
      if (event === "SIGTERM" || event === "SIGINT") {
        signals.on(event, listener);
        return process;
      }
      return originalOn(event, listener);
    }) as typeof process.on);
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createHttpServer.mockImplementation(
      (_services, port: number, options: { host?: string }) => {
        const server = createServer((_request, response) => response.end("ok"));
        // A test observer prevents the pre-fix unhandled error from killing the Vitest worker.
        server.on("error", () => {});
        servers.add(server);
        server.listen(port, options.host);
        return server;
      },
    );
  });

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await Promise.all(
      [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    servers.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });

  it("cleans up the factory when Host creation fails", async () => {
    const failure = new Error("host initialization failed");
    mocks.createHost.mockRejectedValue(failure);

    await import("../src/entry-http.js");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(factory.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.disposeHost).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("startup failed"), failure);
    expect(mocks.createHttpServer).not.toHaveBeenCalled();
  });

  it("reports a real port collision and disposes both owners", async () => {
    const occupied = createServer();
    servers.add(occupied);
    vi.stubEnv("PORT", String(await listen(occupied)));

    await import("../src/entry-http.js");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(factory.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.disposeHost).toHaveBeenCalledExactlyOnceWith(services);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("server error"),
      expect.objectContaining({ code: "EADDRINUSE" }),
    );
  });

  it("cleans up both owners when HTTP server creation throws", async () => {
    const failure = new Error("HTTP setup failed");
    mocks.createHttpServer.mockImplementation(() => {
      throw failure;
    });

    await import("../src/entry-http.js");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(factory.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.disposeHost).toHaveBeenCalledExactlyOnceWith(services);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("startup failed"), failure);
  });

  it("closes live connections and awaits factory then Host on repeated SIGTERM", async () => {
    const freePort = createServer();
    servers.add(freePort);
    const port = await listen(freePort);
    await new Promise<void>((resolve) => freePort.close(() => resolve()));
    vi.stubEnv("PORT", String(port));
    const factoryDone = deferred<void>();
    const hostDone = deferred<void>();
    const order: string[] = [];
    factory.dispose.mockImplementation(async () => {
      order.push("factory");
      await factoryDone.promise;
    });
    mocks.disposeHost.mockImplementation(async () => {
      order.push("host");
      await hostDone.promise;
    });

    await import("../src/entry-http.js");
    await vi.waitFor(() => expect(mocks.createHttpServer).toHaveBeenCalledTimes(1));
    const server = mocks.createHttpServer.mock.results[0]!.value as Server;
    if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
    const socket = createConnection({ host: "127.0.0.1", port });
    sockets.add(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    signals.emit("SIGTERM");
    signals.emit("SIGTERM");
    signals.emit("SIGINT");

    await vi.waitFor(() => expect(factory.dispose).toHaveBeenCalledTimes(1));
    expect(server.listening).toBe(false);
    await vi.waitFor(() => expect(socket.destroyed).toBe(true));
    expect(mocks.disposeHost).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    factoryDone.resolve();
    await vi.waitFor(() => expect(mocks.disposeHost).toHaveBeenCalledTimes(1));
    expect(exit).not.toHaveBeenCalled();
    hostDone.resolve();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(order).toEqual(["factory", "host"]);
  });

  it("cleans up when the HTTP server closes independently", async () => {
    const freePort = createServer();
    servers.add(freePort);
    const port = await listen(freePort);
    await new Promise<void>((resolve) => freePort.close(() => resolve()));
    vi.stubEnv("PORT", String(port));

    await import("../src/entry-http.js");
    await vi.waitFor(() => expect(mocks.createHttpServer).toHaveBeenCalledTimes(1));
    const server = mocks.createHttpServer.mock.results[0]!.value as Server;
    if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(factory.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.disposeHost).toHaveBeenCalledExactlyOnceWith(services);
  });

  it("continues cleanup and reports each failure with a nonzero exit", async () => {
    const factoryError = new Error("factory cleanup failed");
    const hostError = new Error("host cleanup failed");
    factory.dispose.mockRejectedValue(factoryError);
    mocks.disposeHost.mockRejectedValue(hostError);
    const freePort = createServer();
    servers.add(freePort);
    const port = await listen(freePort);
    await new Promise<void>((resolve) => freePort.close(() => resolve()));
    vi.stubEnv("PORT", String(port));

    await import("../src/entry-http.js");
    await vi.waitFor(() => expect(mocks.createHttpServer).toHaveBeenCalledTimes(1));
    signals.emit("SIGTERM");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(factory.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.disposeHost).toHaveBeenCalledExactlyOnceWith(services);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("factory"), factoryError);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("service"), hostError);
  });

  it("waits for Host creation before cleaning up a signal during startup", async () => {
    const host = deferred<{
      services: object;
      workspaceIdentityMapper: object;
      migrationFailedPathCount: number;
    }>();
    mocks.createHost.mockReturnValue(host.promise);

    await import("../src/entry-http.js");
    await vi.waitFor(() => expect(mocks.createHost).toHaveBeenCalledTimes(1));
    signals.emit("SIGTERM");
    expect(exit).not.toHaveBeenCalled();
    expect(factory.dispose).not.toHaveBeenCalled();
    host.resolve({ services, workspaceIdentityMapper: {}, migrationFailedPathCount: 0 });

    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(mocks.createHttpServer).not.toHaveBeenCalled();
    expect(factory.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.disposeHost).toHaveBeenCalledExactlyOnceWith(services);
  });

  it("waits for the factory before cleaning up a signal during factory initialization", async () => {
    const pendingFactory = deferred<typeof factory>();
    mocks.createFactory.mockReturnValue(pendingFactory.promise);

    await import("../src/entry-http.js");
    await vi.waitFor(() => expect(mocks.createFactory).toHaveBeenCalledTimes(1));
    signals.emit("SIGTERM");
    expect(exit).not.toHaveBeenCalled();
    pendingFactory.resolve(factory);

    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(factory.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.createHost).not.toHaveBeenCalled();
    expect(mocks.createHttpServer).not.toHaveBeenCalled();
  });

  it.each([
    ["non-loopback host", { ZCODE_SERVER_HOST: "0.0.0.0" }],
    ["legacy token", { ZCODE_SERVER_AUTH_TOKEN: "token" }],
    ["missing page origins", { AISCOO_LOCAL_WEB_ORIGINS: "" }],
    ["invalid port", { PORT: "65536" }],
  ])("fails closed before allocating resources for %s", async (_name, values) => {
    for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);

    await import("../src/entry-http.js");

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("startup failed"),
      expect.any(Error),
    );
    expect(mocks.createFactory).not.toHaveBeenCalled();
    expect(mocks.createHost).not.toHaveBeenCalled();
    expect(mocks.createHttpServer).not.toHaveBeenCalled();
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("defaults local Web to loopback and passes the configured profile to the Host", async () => {
    vi.stubEnv("ZCODE_SERVER_HOST", "");
    const freePort = createServer();
    servers.add(freePort);
    const port = await listen(freePort);
    await new Promise<void>((resolve) => freePort.close(() => resolve()));
    vi.stubEnv("PORT", String(port));

    await import("../src/entry-http.js");
    await vi.waitFor(() => expect(mocks.createHttpServer).toHaveBeenCalledTimes(1));

    expect(mocks.createFactory).toHaveBeenCalledExactlyOnceWith({
      origin: "http://127.0.0.1:3001",
    });
    expect(mocks.createHost.mock.calls[0]![0]).toMatchObject({
      newApiAccountFactory: factory,
      providerProvisioningTargetEnabled: false,
    });
    expect(mocks.createHttpServer.mock.calls[0]![2]).toMatchObject({
      host: "127.0.0.1",
      localWeb: { allowedOrigins: ["http://127.0.0.1:5174"] },
    });
    signals.emit("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
  });

  it("leaves the upstream HTTP entry lifecycle unchanged when local Web is disabled", async () => {
    vi.stubEnv("AISCOO_LOCAL_WEB", "");
    vi.stubEnv("ZCODE_SERVER_HOST", "");
    vi.stubEnv("ZCODE_WEB_STATIC_ROOT", "/test/static");
    vi.stubEnv("ZCODE_SERVER_AUTH_TOKEN", "upstream-token");
    const freePort = createServer();
    servers.add(freePort);
    const port = await listen(freePort);
    await new Promise<void>((resolve) => freePort.close(() => resolve()));
    vi.stubEnv("PORT", String(port));

    await import("../src/entry-http.js");
    await vi.waitFor(() => expect(mocks.createHttpServer).toHaveBeenCalledTimes(1));

    expect(mocks.createFactory).not.toHaveBeenCalled();
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(mocks.disposeHost).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.createHost).toHaveBeenCalledExactlyOnceWith({
      topicResourceRelayChannel: expect.any(Function),
      sourceServerId: "test-server",
      zcodeBuiltinProviderConfigFilePath: "/test/provider.json",
      providerProvisioningTargetEnabled: true,
    });
    expect(mocks.createHttpServer).toHaveBeenCalledExactlyOnceWith(services, port, {
      serverId: "test-server",
      workspaceIdentityMapper: {},
      migrationFailedPathCount: 0,
      virtualProjects: true,
      topicResourcePeers: expect.objectContaining({ getChannel: expect.any(Function) }),
      staticRoot: "/test/static",
      spaFallback: true,
      authToken: "upstream-token",
      authRequired: true,
    });
  });
});
