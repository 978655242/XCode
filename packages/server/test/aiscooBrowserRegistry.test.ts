import { expect, it, vi } from "vitest";
import {
  AccountProviderService,
  ModelConfigRules,
  ProviderConfigMap,
  ProviderRegistryService,
  ProviderTemplateMap,
  type ProviderConfigSnapshot,
} from "../../provider/src/index.js";
import { createNewApiProviderAnchors } from "../../provider-node/src/new-api-provider-anchors.js";
import { ChannelClient, ChannelServer, createQueuePair, Emitter, Event } from "@zcode/rpc";
import type { NewApiOwner } from "@zcode/shared";
import { createNewApiAccountProviderResolver } from "../../services/src/new-api/newApiAccountProviderResolution.js";
import { createNewApiAccountRequestAuthResolver } from "../../services/src/model-provider/accountProviderRequestAuthService.js";
import {
  catalog,
  entitlements,
  modelConfig,
  owner as fixtureOwner,
} from "../../services/test/newApiRegistryFixtures.js";
import {
  BROWSER_ACCOUNT_CHANNEL,
  createBrowserAccountBridge,
  type BrowserAccountSessionEvent,
} from "../src/aiscoo-browser-account/index.js";

it.each(["session", "detach"] as const)(
  "browser authority feeds Chat Registry/request auth and revokes on %s",
  async (invalidation) => {
    const owner: NewApiOwner = { ...fixtureOwner, origin: "https://browser-account.example.test" };
    const control = "synthetic-browser-control";
    const relay = { token: "sk-synthetic-browser-relay", expiresAt: Date.now() + 60_000 };
    const browserCatalog = {
      ...catalog,
      models: [
        {
          ...catalog.models[0]!,
          api_type: "openai-chat-completions" as const,
          model_config: modelConfig,
        },
      ],
    };
    const config: ProviderConfigSnapshot = {
      revision: "browser-config-1",
      zcodeBuiltinRevision: "builtin-1",
      personalRevision: "personal-1",
      zcodeBuiltinProviders: createNewApiProviderAnchors(owner.origin),
      zcodeBuiltinProviderTemplates: ProviderTemplateMap.empty(),
      personalProviders: ProviderConfigMap.empty(),
      zcodeBuiltinModelRules: ModelConfigRules.empty(),
      personalModels: ModelConfigRules.empty(),
    };
    const configSource = { read: async () => config, onDidChange: () => () => {} };
    let accountSource: AccountProviderService;
    const bridge = createBrowserAccountBridge(owner.origin, {
      onOwnerChanged: () => accountSource.invalidateNative(true),
    });
    const client = {
      getEntitlements: vi.fn(async (token: string) => {
        expect(token).toBe(control);
        return entitlements;
      }),
      getModels: vi.fn(async (token: string) => {
        expect(token).toBe(control);
        return browserCatalog;
      }),
    };
    accountSource = new AccountProviderService({
      configSource,
      resolve: createNewApiAccountProviderResolver({ account: bridge.authority, client }),
    });
    const registry = new ProviderRegistryService({ configSource, accountSource });
    const changes = new Emitter<BrowserAccountSessionEvent>();
    const [browserProtocol, hostProtocol] = createQueuePair();
    const browser = new ChannelServer(browserProtocol, "browser");
    const host = new ChannelClient(hostProtocol);
    const relayStarted = Promise.withResolvers<void>();
    let delayedRelay: ReturnType<typeof Promise.withResolvers<typeof relay>> | undefined;
    const commands: string[] = [];
    browser.registerChannel(BROWSER_ACCOUNT_CHANNEL, {
      async call<T>(_ctx: string, command: string, arg?: { owner: NewApiOwner }): Promise<T> {
        commands.push(command);
        if (command === "restore")
          return {
            owner,
            session: {
              status: "authenticated",
              userInfo: {
                id: owner.userId,
                username: "synthetic",
                displayName: "Synthetic",
              },
            },
          } as T;
        expect(arg?.owner).toEqual(owner);
        if (command === "control") return { owner, accessToken: control } as T;
        if (command === "relay") {
          if (delayedRelay) {
            relayStarted.resolve();
            return (await delayedRelay.promise) as T;
          }
          return relay as T;
        }
        throw new Error("Unexpected browser command");
      },
      listen<T>(_ctx: string, event: string) {
        expect(event).toBe("session");
        return changes.event as Event<T>;
      },
    });
    try {
      const attachment = bridge.attach(host);
      await attachment.ready;
      expect(bridge.authority.getOwner()).toEqual(owner);
      await registry.start();
      const snapshot = await accountSource.read();
      expect(snapshot.owner).toEqual(owner);
      expect(client.getEntitlements).toHaveBeenCalledWith(control);
      expect(client.getModels).toHaveBeenCalledWith(control);
      const providerId = "account:new-api-openai-chat-completions";
      const provider = registry.getProvider(providerId)!;
      const model = registry.getModel(providerId, "real-model")!;
      expect(model).toMatchObject({ modelId: "real-model", displayName: "Real" });
      expect(provider.config.api.baseUrl).toBe(`${owner.origin}/v1`);
      expect(Object.isFrozen(provider)).toBe(true);
      const access = provider.config.access;
      if (access.type !== "new-api-account") throw new Error("Expected Native Registry access");
      const request = Object.freeze({
        providerId: provider.providerId,
        modelId: model.modelId,
        reason: "model-request" as const,
        accountAccess: Object.freeze({
          ...access,
          owner: provider.accountOwner,
          authorizationRevision: provider.accountAuthorizationRevision,
        }),
      });
      const unexpectedOfficial = vi.fn(async (): Promise<never> => {
        throw new Error("Unexpected official auth");
      });
      const auth = createNewApiAccountRequestAuthResolver({
        account: bridge.authority,
        accountSource,
        official: {
          resolveAccessCurrent: unexpectedOfficial,
          assertCurrent: unexpectedOfficial,
          resolveCurrent: unexpectedOfficial,
        },
      });
      await expect(auth.resolveCurrent(request)).resolves.toEqual({ apiKey: relay.token });
      expect(commands).toEqual(["restore", "control", "relay"]);
      for (const secret of [control, relay.token])
        expect(JSON.stringify(snapshot)).not.toContain(secret);
      delayedRelay = Promise.withResolvers<typeof relay>();
      const inFlight = auth.resolveCurrent(request);
      const rejected = expect(inFlight).rejects.toThrow("XCODE_STALE_OWNER");
      await relayStarted.promise;
      if (invalidation === "session") {
        const signedOut = Event.toPromise(bridge.authority.oauth.onDidChangeSession);
        changes.fire({ owner: null });
        expect(await signedOut).toBe("signed-out");
      } else attachment.dispose();
      expect(bridge.authority.getOwner()).toBeNull();
      expect((await accountSource.read()).owner).toBeNull();
      delayedRelay.resolve(relay);
      await rejected;
      await registry.refresh("browser-owner-invalidated");
      expect(registry.getModel(providerId, model.modelId)).toBeUndefined();
      expect(registry.validateSelection({ providerId, modelId: model.modelId }).ok).toBe(false);
      await expect(auth.resolveCurrent(request)).rejects.toThrow(
        "Account request credential is unavailable",
      );
      expect(commands.filter((command) => command === "relay")).toHaveLength(2);
      expect(unexpectedOfficial).not.toHaveBeenCalled();
    } finally {
      registry.dispose();
      bridge.dispose();
      accountSource.dispose();
      host.dispose();
      browser.dispose();
      changes.dispose();
    }
  },
);
