import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderConfigResolver,
  ProviderConfigMap,
  ModelConfigRules,
  resolveEffectiveModelSelection,
  ProviderSettingsFacade,
} from "@zcode/provider";
import { createNewApiProviderAnchors, createNodeModelSelectionFacade } from "@zcode/provider-node";
import { resolveNewApiAccountProviders } from "../src/new-api/newApiAccountProviderResolution.js";
import { owner, catalog, entitlements } from "./newApiRegistryFixtures.js";

test("XWork selects only Chat Completions and requires reselect for hidden or old official refs", () => {
  const account = resolveNewApiAccountProviders({
    owner,
    catalog: {
      ...catalog,
      models: [
        ...catalog.models,
        { ...catalog.models[0]!, model_id: "chat-model", api_type: "openai-chat-completions" },
      ],
    },
    entitlements,
  });
  const resolution = new ProviderConfigResolver().resolve({
    zcodeBuiltinProviders: createNewApiProviderAnchors(owner.origin),
    personalProviders: ProviderConfigMap.empty(),
    personalModels: ModelConfigRules.empty(),
    zcodeBuiltinModelRules: ModelConfigRules.empty(),
    accountProviders: account.providers,
    accountModelConfigs: account.modelConfigs,
    accountStates: account.states,
  });
  const registry = { revision: 1, providers: resolution.registryProviders };
  const snapshot = {
    registry,
    resolution,
    account,
    config: {
      zcodeBuiltinProviders: createNewApiProviderAnchors(owner.origin),
      personalProviders: ProviderConfigMap.empty(),
      personalModels: ModelConfigRules.empty(),
    },
    sourceRevisions: { config: "builtin", account: "account" },
  };
  const facade = createNodeModelSelectionFacade({
    getView: () => registry,
    getSnapshot: () => snapshot as never,
    refresh: async () => snapshot as never,
    onDidChange: () => () => {},
  });
  const selection = {
    providerId: "account:new-api-openai-chat-completions",
    modelId: "chat-model",
    options: { reasoningLevel: "none" },
  };
  assert.deepEqual(
    facade.getView(undefined, undefined, { selection }).effectiveSelection,
    selection,
  );
  assert.deepEqual(
    facade.getView().providers.map((provider) => provider.providerId),
    ["account:new-api-openai-chat-completions"],
  );
  const settings = new ProviderSettingsFacade({
    getView: () => registry,
    getSnapshot: () => snapshot as never,
    refresh: async () => snapshot as never,
    onDidChange: () => () => {},
  }).getView();
  assert.deepEqual(
    settings.providers.map((provider) => provider.providerId),
    ["account:new-api-openai-chat-completions"],
  );
  const hidden = facade.getView(undefined, undefined, {
    selection: {
      ...selection,
      providerId: "account:new-api-openai-responses",
      modelId: "real-model",
    },
  });
  assert.equal(hidden.effectiveSelection, null);
  assert.equal(hidden.selectionIssue, "provider-not-found");
  const old = { ...selection, providerId: "account:zai-individual-coding-plan" };
  const result = facade.getView(undefined, undefined, { selection: old });
  assert.equal(result.effectiveSelection, null);
  assert.equal(result.selectionIssue, "provider-not-found");
  assert.equal(old.providerId, "account:zai-individual-coding-plan");
  assert.equal(
    resolveEffectiveModelSelection({
      selection: { ...selection, providerId: "account:new-api-anthropic-messages" },
      registry,
      classifyProvider: () => "ordinary",
    }).effectiveSelection,
    null,
  );
});
