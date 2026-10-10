import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderConfigResolver,
  ProviderConfigMap,
  ModelConfigRules,
  resolveEffectiveModelSelection,
} from "@zcode/provider";
import { createNewApiProviderAnchors, createNodeModelSelectionFacade } from "@zcode/provider-node";
import { resolveNewApiAccountProviders } from "../src/new-api/newApiAccountProviderResolution.js";
import { owner, catalog, entitlements } from "./newApiRegistryFixtures.js";

test("Native selections retain exact transport while old official Plan selection requires reselect", () => {
  const account = resolveNewApiAccountProviders({ owner, catalog, entitlements });
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
    config: {},
    sourceRevisions: { config: "builtin", account: "account" },
  };
  const facade = createNodeModelSelectionFacade({
    getView: () => registry,
    getSnapshot: () => snapshot as never,
    refresh: async () => snapshot as never,
    onDidChange: () => () => {},
  });
  const selection = {
    providerId: "account:new-api-openai-responses",
    modelId: "real-model",
    options: { reasoningLevel: "none" },
  };
  assert.deepEqual(
    facade.getView(undefined, undefined, { selection }).effectiveSelection,
    selection,
  );
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
