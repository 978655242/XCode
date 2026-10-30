import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

test("ordinary Host keeps remote configuration, legacy migration and spawn-time personal path", async () => {
  const root = await mkdtemp(join(tmpdir(), "aiscoo-default-provider-regression-"));
  const home = join(root, "home");
  const source = `
    import assert from "node:assert/strict";
    import { mkdir, readFile, writeFile } from "node:fs/promises";
    import { Socket } from "node:net";
    import { join } from "node:path";
    import { setTimeout as delay } from "node:timers/promises";
    const root = process.env.AISCOO_TEST_ROOT;
    const initial = join(root, "initial");
    const later = join(root, "later");
    const capture = join(root, "worker-env.json");
    await Promise.all([initial, later].map((path) => mkdir(path, { recursive: true })));
    Socket.prototype.connect = function () { throw new Error("network blocked by isolated test"); };
    const requests = [];
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ origin: url.origin, path: url.pathname });
      return new Response("{}", { status: 503 });
    };
    const { ApiKeyAccessConfig, ModelConfigRules, ProviderConfig, ProviderConfigMap } = await import(${JSON.stringify(resolve("packages/provider/src/index.ts"))});
    const { NodePersonalProviderConfigRepository } = await import(${JSON.stringify(resolve("packages/provider-node/src/personal-provider-config-repository.ts"))});
    const { createLocalServices, disposeServiceResourcesAndWait, getProviderProvisioningSource, setDataBaseDir } = await import(${JSON.stringify(resolve("packages/services/src/node.ts"))});
    const { IModelSelectionService, IProviderSettingsService } = await import(${JSON.stringify(resolve("packages/services/src/model-provider/providerFacadeServices.ts"))});
    const { IZCodeAgentService } = await import(${JSON.stringify(resolve("packages/services/src/zcode-agent/zcodeAgent.ts"))});
    const initialConfig = join(initial, ".zcode", "v2", "provider_config.json");
    const personal = new NodePersonalProviderConfigRepository({ filePath: initialConfig, pollingIntervalMs: false });
    await personal.update(() => ({
      providers: new ProviderConfigMap([{
        providerId: "bigmodel-api", templateId: "bigmodel-api",
        config: new ProviderConfig({ group: "standard-personal", access: new ApiKeyAccessConfig({ apiKey: "synthetic-default-key" }) }),
      }]),
      models: ModelConfigRules.empty(),
      defaultModelSelection: { providerId: "bigmodel-api", modelId: "GLM-5.3", options: { reasoningLevel: "disabled" } },
    }));
    personal.dispose();
    setDataBaseDir(initial);
    const workerScript = 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ personal: process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, builtin: process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE }))';
    const services = createLocalServices({
      serviceAuthorityMode: "standalone-server",
      zcodeBuiltinProviderConfigFilePath: ${JSON.stringify(resolve("config/provider/zcode-builtin.json"))},
      zcodeAgentCommandResolver: () => ({ command: process.execPath, args: ["-e", workerScript, capture] }),
    });
    try {
      const view = await services.get(IModelSelectionService).getView();
      assert.ok(view.providers.some((provider) => provider.providerId === "bigmodel-api"));
      const synced = await getProviderProvisioningSource(services).read("default-regression");
      assert.ok(synced.personalConfig.providerConfigRules.providerRules.some((rule) => rule.providerId === "bigmodel-api"));
      for (let i = 0; i < 30 && !requests.some((request) => request.path === "/api/v1/client/configs"); i++) await delay(50);
      assert.ok(requests.some((request) => request.path === "/api/v1/client/configs"));
      setDataBaseDir(later);
      await assert.rejects(services.get(IZCodeAgentService).testModelConnectivity({
        workspacePath: process.env.HOME,
        selection: { providerId: "bigmodel-api", modelId: "GLM-5.3" },
      }));
      const workerEnv = JSON.parse(await readFile(capture, "utf8"));
      assert.equal(workerEnv.personal, join(later, ".zcode", "v2", "provider_config.json"));
    } finally {
      await disposeServiceResourcesAndWait(services);
    }
    const legacy = join(root, "legacy");
    const legacyDir = join(legacy, ".zcode", "v2");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "config.json"), JSON.stringify({ provider: {
      "legacy-custom": { kind: "openai-compatible", options: { apiKey: "synthetic-legacy-key", baseURL: "http://127.0.0.1:49100/v1" }, models: { "legacy-model": {} } },
    }}));
    setDataBaseDir(legacy);
    const ordinary = createLocalServices({
      serviceAuthorityMode: "standalone-server",
      zcodeBuiltinProviderConfigFilePath: ${JSON.stringify(resolve("config/provider/zcode-builtin.json"))},
    });
    try {
      const view = await ordinary.get(IProviderSettingsService).getView();
      assert.ok(view.providers.some((provider) => provider.providerId === "legacy-custom"));
      assert.match(await readFile(join(legacyDir, "provider_config.json"), "utf8"), /legacy-custom/);
    } finally {
      await disposeServiceResourcesAndWait(ordinary);
      setDataBaseDir(null);
    }
    process.stdout.write("ORDINARY_HOST_DEFAULTS_VERIFIED\\n");
    process.exit(0);
  `;
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOME: home,
          USERPROFILE: home,
          APPDATA: join(root, "appdata"),
          LOCALAPPDATA: join(root, "localappdata"),
          XDG_CONFIG_HOME: join(root, "xdg-config"),
          XDG_DATA_HOME: join(root, "xdg-data"),
          XDG_CACHE_HOME: join(root, "xdg-cache"),
          TMPDIR: root,
          TMP: root,
          TEMP: root,
          ZCODE_DATA_BASE_DIR: home,
          ZCODE_STORAGE_DIR: join(root, "storage"),
          ZCODE_SESSION_DB_PATH: join(root, "storage", "session.db"),
          ZCODE_SESSION_DB: join(root, "storage", "session.db"),
          ZCODE_LOG_DIR: join(root, "logs"),
          ZCODE_CREDENTIAL_SECRET: "synthetic-default-secret",
          AISCOO_TEST_ROOT: root,
        },
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    assert.match(stdout, /ORDINARY_HOST_DEFAULTS_VERIFIED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local Web isolates provider files and does not refresh the official catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "aiscoo-web-provider-isolation-"));
  const home = join(root, "home");
  const source = `
    import assert from "node:assert/strict";
    import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
    import { Socket } from "node:net";
    import { join } from "node:path";
    import { setTimeout as delay } from "node:timers/promises";
    const root = process.env.AISCOO_TEST_ROOT;
    const appRoot = join(root, "web-app-config");
    const desktopRoot = join(process.env.HOME, ".zcode", "v2");
    const desktopFile = join(desktopRoot, "provider_config.json");
    const captureFile = join(root, "worker-env.json");
    await mkdir(desktopRoot, { recursive: true });
    Socket.prototype.connect = function () { throw new Error("network blocked by isolated test"); };
    const requests = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ origin: url.origin, path: url.pathname, method: init?.method ?? "GET" });
      return new Response("{}", { status: 503 });
    };
    const { ApiKeyAccessConfig, ModelConfigRules, ProviderConfig, ProviderConfigMap } = await import(${JSON.stringify(resolve("packages/provider/src/index.ts"))});
    const { NodePersonalProviderConfigRepository } = await import(${JSON.stringify(resolve("packages/provider-node/src/personal-provider-config-repository.ts"))});
    const { createLocalWebNewApiAccountFactory, createLocalServices, disposeServiceResourcesAndWait, getProviderProvisioningSource } = await import(${JSON.stringify(resolve("packages/services/src/node.ts"))});
    const { IOAuthService } = await import(${JSON.stringify(resolve("packages/services/src/oauth/oauth.ts"))});
    const { IModelSelectionService, IProviderSettingsService } = await import(${JSON.stringify(resolve("packages/services/src/model-provider/providerFacadeServices.ts"))});
    const { IZCodeAgentService } = await import(${JSON.stringify(resolve("packages/services/src/zcode-agent/zcodeAgent.ts"))});
    const { startProcessProviderRegistryRuntime } = await import(${JSON.stringify(resolve("apps/zcode-cli/packages/bootstrap/src/app/process-provider-registry-runtime.ts"))});
    const { modelConfig } = await import(${JSON.stringify(resolve("packages/services/test/newApiRegistryFixtures.ts"))});
    const desktop = new NodePersonalProviderConfigRepository({ filePath: desktopFile, pollingIntervalMs: false });
    await desktop.update(() => ({
      providers: new ProviderConfigMap([{
        providerId: "bigmodel-api", templateId: "bigmodel-api",
        config: new ProviderConfig({ group: "standard-personal", access: new ApiKeyAccessConfig({ apiKey: "synthetic-desktop-key" }) }),
      }]),
      models: ModelConfigRules.empty(),
      defaultModelSelection: { providerId: "bigmodel-api", modelId: "GLM-5.3", options: { reasoningLevel: "disabled" } },
    }));
    desktop.dispose();
    const originalDesktop = await readFile(desktopFile, "utf8");
    const legacyFile = join(desktopRoot, "config.json");
    const originalLegacy = JSON.stringify({ provider: { "legacy-custom": { kind: "openai-compatible", options: { apiKey: "synthetic-legacy-key", baseURL: "http://127.0.0.1:49001/v1" }, models: { "old-model": {} } } } });
    await writeFile(legacyFile, originalLegacy);
    let key = null;
    const factory = await createLocalWebNewApiAccountFactory({
      origin: "http://127.0.0.1:49002", dataDirectory: appRoot,
      keyStore: { async read() { return key; }, async write(value) { key = value; } },
    });
    const workerScript = 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ personal: process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, builtin: process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, origin: process.env.NEW_API_BASE_URL }))';
    const startHost = (accountFactory) => createLocalServices({
      serviceAuthorityMode: "standalone-server", newApiAccountFactory: accountFactory,
      zcodeBuiltinProviderConfigFilePath: ${JSON.stringify(resolve("config/provider/zcode-builtin.json"))},
      zcodeAgentCommandResolver: () => ({ command: process.execPath, args: ["-e", workerScript, captureFile] }),
    });
    const services = startHost(factory);
    let customId;
    try {
      const oauth = services.get(IOAuthService);
      const models = services.get(IModelSelectionService);
      const settings = services.get(IProviderSettingsService);
      assert.equal(await oauth.getActiveProvider(), null);
      const initial = await models.getView();
      assert.equal(initial.providers.some((p) => p.providerId === "bigmodel-api" || p.providerId === "legacy-custom"), false);
      assert.notEqual(initial.preferredSelection?.providerId, "bigmodel-api");
      assert.deepEqual(factory.providerConfigPaths, {
        personalFilePath: join(appRoot, "local-web", "new-api", "provider", "provider_config.json"),
        zcodeBuiltinActiveFilePath: join(appRoot, "local-web", "new-api", "provider", "zcode-builtin.json"),
      });
      const created = await settings.createPersonalProvider();
      customId = created.providerId;
      await settings.savePersonalProviderOverlay(created.providerId, {
        access: { type: "api-key", apiKey: "synthetic-web-key" },
        api: { type: "openai-chat-completions", baseUrl: "http://127.0.0.1:49003/v1" },
      });
      await settings.addPersonalModel(created.providerId, "web-model", modelConfig);
      const view = await models.getView();
      assert.ok(view.providers.find((p) => p.providerId === created.providerId)?.models.some((m) => m.modelId === "web-model"));
      const privateFile = factory.providerConfigPaths.personalFilePath;
      assert.match(await readFile(privateFile, "utf8"), /synthetic-web-key/);
      if (process.platform !== "win32") {
        assert.equal((await stat(privateFile)).mode & 0o777, 0o600);
        assert.equal((await stat(join(appRoot, "local-web", "new-api", "provider"))).mode & 0o777, 0o700);
      }
      const provisioned = await getProviderProvisioningSource(services).read("synthetic-isolation");
      assert.ok(provisioned.personalConfig.providerConfigRules.providerRules.some((r) => r.providerId === created.providerId));
      await settings.refresh("synthetic-manual-refresh");
      const agent = services.get(IZCodeAgentService);
      await assert.rejects(agent.testModelConnectivity({ workspacePath: process.env.HOME, selection: { providerId: created.providerId, modelId: "web-model" } }));
      const workerEnv = JSON.parse(await readFile(captureFile, "utf8"));
      assert.equal(workerEnv.personal, privateFile);
      assert.equal(workerEnv.builtin, factory.providerConfigPaths.zcodeBuiltinActiveFilePath);
      assert.equal(workerEnv.origin, "http://127.0.0.1:49002");
      const worker = await startProcessProviderRegistryRuntime({
        ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: workerEnv.personal,
        ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: workerEnv.builtin,
        NEW_API_BASE_URL: workerEnv.origin,
      });
      try {
        assert.ok(worker.runtime.registryService.getProvider(created.providerId));
        assert.equal(worker.runtime.registryService.getProvider("bigmodel-api"), undefined);
      } finally { worker.dispose(); }
      await delay(200);
      assert.deepEqual(requests.filter((r) => r.path === "/api/v1/client/configs"), []);
      assert.equal(await readFile(desktopFile, "utf8"), originalDesktop);
      assert.equal(await readFile(legacyFile, "utf8"), originalLegacy);
    } finally {
      await factory.dispose();
      await disposeServiceResourcesAndWait(services);
    }
    const reopenedFactory = await createLocalWebNewApiAccountFactory({
      origin: "http://127.0.0.1:49002", dataDirectory: appRoot,
      keyStore: { async read() { return key; }, async write(value) { key = value; } },
    });
    const reopened = startHost(reopenedFactory);
    try {
      const view = await reopened.get(IModelSelectionService).getView();
      assert.ok(view.providers.find((p) => p.providerId === customId)?.models.some((m) => m.modelId === "web-model"));
      assert.equal(view.providers.some((p) => p.providerId === "bigmodel-api"), false);
      assert.equal(await reopened.get(IOAuthService).getActiveProvider(), null);
    } finally {
      await reopenedFactory.dispose();
      await disposeServiceResourcesAndWait(reopened);
    }
    await rm(desktopFile);
    const freshRoot = join(root, "fresh-web-config");
    const freshFactory = await createLocalWebNewApiAccountFactory({
      origin: "http://127.0.0.1:49002", dataDirectory: freshRoot,
      keyStore: { async read() { return null; }, async write() {} },
    }).catch(() => null);
    assert.equal(freshFactory, null, "unavailable keystore must fail closed");
    let freshKey = null;
    const isolatedFactory = await createLocalWebNewApiAccountFactory({
      origin: "http://127.0.0.1:49002", dataDirectory: join(root, "new-web-config"),
      keyStore: { async read() { return freshKey; }, async write(value) { freshKey = value; } },
    });
    const isolated = startHost(isolatedFactory);
    try {
      const view = await isolated.get(IProviderSettingsService).getView();
      assert.equal(view.providers.some((p) => p.providerId === "legacy-custom"), false);
      assert.equal(await readFile(legacyFile, "utf8"), originalLegacy);
      assert.deepEqual(requests.filter((r) => r.path === "/api/v1/client/configs"), []);
    } finally {
      await isolatedFactory.dispose();
      await disposeServiceResourcesAndWait(isolated);
    }
    process.stdout.write("PROVIDER_ISOLATION_VERIFIED\\n");
    process.exit(0);
  `;
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOME: home,
          USERPROFILE: home,
          APPDATA: join(root, "appdata"),
          LOCALAPPDATA: join(root, "localappdata"),
          XDG_CONFIG_HOME: join(root, "xdg-config"),
          XDG_DATA_HOME: join(root, "xdg-data"),
          XDG_CACHE_HOME: join(root, "xdg-cache"),
          TMPDIR: root,
          TMP: root,
          TEMP: root,
          ZCODE_DATA_BASE_DIR: home,
          ZCODE_STORAGE_DIR: join(root, "storage"),
          ZCODE_SESSION_DB_PATH: join(root, "storage", "session.db"),
          ZCODE_SESSION_DB: join(root, "storage", "session.db"),
          ZCODE_LOG_DIR: join(root, "logs"),
          ZCODE_CREDENTIAL_SECRET: "synthetic-desktop-test-key",
          AISCOO_TEST_ROOT: root,
        },
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    assert.match(stdout, /PROVIDER_ISOLATION_VERIFIED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
