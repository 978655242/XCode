import { describe, expect, it } from "vitest";
import { resolveZenAccountProviders } from "../src/zen/index.js";
import { createAccountProviderConfigSnapshot } from "@zcode/provider";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZenAccountRuntime } from "../src/zen/index.js";
import { startProcessProviderRegistryRuntime } from "../src/app/process-provider-registry-runtime.js";
import {
  NewApiCatalogSchema,
  NewApiEntitlementsSchema,
  NEW_API_MODEL_PROVIDER_IDS,
} from "@zcode/shared";

describe("Zen account model authorization", () => {
  it("publishes a restored owner through the actual standalone AccountProviderService", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zen-registry-"));
    const configPath = join(directory, "builtin.json");
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        config: {
          providerConfigRules: { providerRules: [], templateRules: [] },
          modelConfigRules: {
            modelRules: [],
            modelApiRules: [],
            providerSiteRules: [],
            templateModelRules: [],
            builtinProviderModelRules: [],
          },
        },
      }),
    );
    const user = { id: "1", username: "test", display_name: "Test", avatar_url: null };
    const now = Date.now();
    const bundle = {
      schema_version: 1,
      server_time: now,
      access_token: "control",
      access_expires_at: now + 100000,
      refresh_token: "refresh",
      refresh_expires_at: now + 200000,
      token_type: "Bearer",
      session_id: "sid",
      user,
      relay_credential: { token: "sk-test", expires_at: now + 200000 },
    };
    const account = new ZenAccountRuntime({
      client: { origin: "https://zen.example.com", me: async () => ({ user, session_id: "sid" }) },
      store: { read: async () => ({ revision: "saved", value: bundle }) },
    } as never);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) =>
      Response.json({
        success: true,
        data: String(url).endsWith("/models")
          ? {
              schema_version: 1,
              server_time: now,
              catalog_revision: "one",
              authorization_revision: "1",
              models: [],
            }
          : {
              schema_version: 1,
              server_time: now,
              status: "unassigned",
              authorization_revision: "1",
              subscription: null,
              quota: null,
              funding_policy: {
                subscription_only: true,
                wallet_fallback: false,
                other_subscription_fallback: false,
              },
              self_service_reset: false,
              purchase_mode: "manual_admin",
            },
      });
    try {
      const runtime = await startProcessProviderRegistryRuntime(
        {
          ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: configPath,
          ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(directory, "personal.json"),
          NEW_API_BASE_URL: "https://zen.example.com",
          ZCODE_DATA_BASE_DIR: directory,
        },
        {
          standalone: {
            zenAccount: account,
            legacyCliUserConfigFilePath: join(directory, "absent"),
          },
        },
      );
      expect(runtime.zenAccount?.getOwner()?.userId).toBe("1");
      expect((await runtime.accountSource.read()).owner?.userId).toBe("1");
      await runtime.refreshStandaloneAccount("test-refresh");
      expect((await runtime.accountSource.read()).revision).toMatch(
        /^account:sha256:[a-f0-9]{64}$/,
      );
      expect(await runtime.readZenModelStatus()).toMatchObject({ available: false });
      const model = {
        model_id: "zen-model",
        display_name: "Zen Test",
        api_type: "openai-chat-completions",
        enabled: true,
        disabled_reason: null,
        model_config: {
          enabled: true,
          properties: {
            contextWindow: 8192,
            requiresMfjsToolSchema: false,
            inputFormat: {
              supportsText: true,
              supportsImage: false,
              supportsVideo: false,
              supportsAudio: false,
              supportsPdf: false,
            },
            outputFormat: { supportsText: true },
            supportsToolCall: false,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
          },
          optionSpecs: {
            reasoningLevel: { values: ["none"], map: "{}" },
            maxOutputTokens: { max: 1024, map: '{"max_tokens": maxOutputTokens}' },
          },
        },
      };
      globalThis.fetch = async (url) =>
        Response.json({
          success: true,
          data: String(url).endsWith("/models")
            ? {
                schema_version: 1,
                server_time: now,
                catalog_revision: "two",
                authorization_revision: "2",
                models: [model],
              }
            : {
                schema_version: 1,
                server_time: now,
                status: "active",
                authorization_revision: "2",
                subscription: {
                  id: "1",
                  plan_id: "1",
                  plan_title: "Test",
                  source: "admin",
                  usage_scope: "xcode",
                  start_time: now,
                  end_time: null,
                },
                quota: null,
                funding_policy: {
                  subscription_only: true,
                  wallet_fallback: false,
                  other_subscription_fallback: false,
                },
                self_service_reset: false,
                purchase_mode: "manual_admin",
              },
        });
      await runtime.refreshStandaloneAccount("plan-available");
      expect(await runtime.readZenModelStatus()).toMatchObject({ available: true });
      const requestInput = {
        accountAccess: {
          type: "new-api-account" as const,
          accountType: "new-api" as const,
          mode: "private-subscription" as const,
          entitled: true,
          owner: account.getOwner()!,
          authorizationRevision: "2",
        },
        providerId: NEW_API_MODEL_PROVIDER_IDS["openai-chat-completions"],
        modelId: "zen-model",
        reason: "model-request" as const,
        sessionId: "test" as never,
        traceContext: { traceId: "test" } as never,
      };
      expect(
        await runtime.providerRuntimeHeadersPort!.refreshBeforeModelRequest(requestInput),
      ).toMatchObject({ requestAuth: { apiKey: "sk-test" } });
      globalThis.fetch = async () =>
        Response.json({ success: false, code: "XCODE_SESSION_INVALID" }, { status: 401 });
      await expect(
        runtime.providerRuntimeHeadersPort!.refreshBeforeModelRequest(requestInput),
      ).rejects.toThrow();
      await expect(
        runtime.providerRuntimeHeadersPort!.refreshBeforeModelRequest({
          accountAccess: {
            type: "new-api-account",
            accountType: "new-api",
            mode: "private-subscription",
            entitled: true,
            owner: account.getOwner()!,
            authorizationRevision: "1",
          },
          providerId: NEW_API_MODEL_PROVIDER_IDS["openai-chat-completions"],
          modelId: "missing-model",
          reason: "model-request",
          sessionId: "test" as never,
          traceContext: { traceId: "test" } as never,
        }),
      ).rejects.toThrow();
      runtime.dispose();
    } finally {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("projects only enabled complete catalog models with the current entitlement", () => {
    const owner = { origin: "https://zen.example.com", userId: "1", sid: "sid", authGeneration: 1 };
    const entitlements = NewApiEntitlementsSchema.parse({
      schema_version: 1,
      server_time: 1,
      status: "active",
      authorization_revision: "7",
      subscription: {
        id: "1",
        plan_id: "2",
        plan_title: "Assigned",
        source: "admin",
        usage_scope: "xcode",
        start_time: 1,
        end_time: null,
      },
      quota: null,
      funding_policy: {
        subscription_only: true,
        wallet_fallback: false,
        other_subscription_fallback: false,
      },
      self_service_reset: false,
      purchase_mode: "manual_admin",
    });
    const catalog = NewApiCatalogSchema.parse({
      schema_version: 1,
      server_time: 1,
      catalog_revision: "catalog-1",
      authorization_revision: "7",
      models: [
        {
          model_id: "real-model",
          display_name: "Real",
          api_type: "openai-chat-completions",
          enabled: true,
          disabled_reason: null,
          model_config: {
            enabled: true,
            properties: {
              contextWindow: 8192,
              requiresMfjsToolSchema: false,
              inputFormat: {
                supportsText: true,
                supportsImage: false,
                supportsVideo: false,
                supportsAudio: false,
                supportsPdf: false,
              },
              outputFormat: { supportsText: true },
              supportsToolCall: false,
              supportsJsonSchemaOutput: false,
              supportsNativeWebSearch: false,
              supportsMidConversationSystem: true,
            },
            optionSpecs: {
              reasoningLevel: { values: ["none"], map: "{}" },
              maxOutputTokens: { max: 1024, map: '{"max_tokens": maxOutputTokens}' },
            },
          },
        },
      ],
    });
    const result = resolveZenAccountProviders({ owner, entitlements, catalog });
    const id = NEW_API_MODEL_PROVIDER_IDS["openai-chat-completions"];
    expect(result.providers.get(id)?.builtinModelIds).toEqual(["real-model"]);
    expect(result.states[id]?.entitled).toBe(true);
    expect(result.modelConfigs[id]?.["real-model"]?.enabled).toBe(true);
    expect(result.authorizationRevision).toBe("7");
    expect(() =>
      createAccountProviderConfigSnapshot("builtin:1", result.providers, result.states, result),
    ).not.toThrow();
    expect(
      resolveZenAccountProviders({
        owner,
        entitlements: { ...entitlements, status: "unassigned", subscription: null } as never,
        catalog,
      }).states[id]?.entitled,
    ).toBe(false);
  });
  it("keeps all native providers unavailable when no account is restored", () => {
    const result = resolveZenAccountProviders({ owner: null });
    expect(result.providers.entries().length).toBeGreaterThan(0);
    for (const [, config] of result.providers.entries()) {
      expect(config.access?.entitled).toBe(false);
      expect(config.builtinModelIds).toEqual([]);
    }
  });
  it("rejects inconsistent entitlement and catalog revisions", () => {
    expect(() =>
      resolveZenAccountProviders({
        owner: { origin: "https://zen.example.com", userId: "1", sid: "sid", authGeneration: 1 },
        entitlements: { authorization_revision: "1" } as never,
        catalog: { authorization_revision: "2" } as never,
      }),
    ).toThrow("XCODE_AUTHORIZATION_REVISION_MISMATCH");
  });
});
