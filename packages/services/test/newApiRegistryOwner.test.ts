import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AccountProviderService,
  MutableAccountProviderConfigSource,
  ProviderRegistryService,
  ProviderConfigMap,
  ProviderTemplateMap,
  ModelConfigRules,
  createAccountProviderConfigSnapshot,
  createFailClosedAccountProviderConfigSnapshot,
  ProviderConfig,
  ZhipuAccountAccessConfig,
  ModelSelectionFacade,
  ProviderSettingsFacade,
  type ProviderConfigSnapshot,
} from "@zcode/provider";
import {
  createNewApiProviderAnchors,
  NodeProviderConfigRuntime,
  materializeZCodeBuiltinProviderConfig,
} from "@zcode/provider-node";
import { resolveNewApiAccountProviders } from "../src/new-api/newApiAccountProviderResolution.js";
import { owner, catalog, entitlements } from "./newApiRegistryFixtures.js";

function config(): ProviderConfigSnapshot {
  return {
    revision: "config-1",
    zcodeBuiltinRevision: "builtin-1",
    personalRevision: "personal-1",
    zcodeBuiltinProviders: createNewApiProviderAnchors(owner.origin),
    zcodeBuiltinProviderTemplates: ProviderTemplateMap.empty(),
    personalProviders: ProviderConfigMap.empty(),
    zcodeBuiltinModelRules: ModelConfigRules.empty(),
    personalModels: ModelConfigRules.empty(),
  };
}

test("builtin fence admits no new owner and immediately revokes the old owner execution", async () => {
  let current = config();
  const configSource = { read: async () => current, onDidChange: () => () => {} };
  const source = new MutableAccountProviderConfigSource();
  const native = resolveNewApiAccountProviders({
    owner,
    catalog,
    entitlements,
    configRevision: "builtin-1",
  });
  source.replace(
    createAccountProviderConfigSnapshot("builtin-1", native.providers, native.states, native),
  );
  const registry = new ProviderRegistryService({ configSource, accountSource: source });
  try {
    await registry.start();
    assert.ok(registry.getModel("account:new-api-openai-responses", "real-model"));
    current = { ...current, revision: "config-2", zcodeBuiltinRevision: "builtin-2" };
    const replacement = resolveNewApiAccountProviders({
      owner: { ...owner, sid: "other-owner", authGeneration: 2 },
      catalog,
      entitlements,
      configRevision: "builtin-1",
    });
    source.replace(
      createAccountProviderConfigSnapshot(
        "builtin-1",
        replacement.providers,
        replacement.states,
        replacement,
      ),
    );
    await registry.refresh("owner-switch");
    assert.equal(registry.getModel("account:new-api-openai-responses", "real-model"), undefined);
    const matching = resolveNewApiAccountProviders({
      owner: { ...owner, sid: "other-owner", authGeneration: 2 },
      catalog,
      entitlements,
      configRevision: "builtin-2",
    });
    source.replace(
      createAccountProviderConfigSnapshot(
        "builtin-2",
        matching.providers,
        matching.states,
        matching,
      ),
    );
    await registry.refresh("matching-builtin");
    assert.equal(
      registry.getProvider("account:new-api-openai-responses")?.accountOwner?.sid,
      "other-owner",
    );
  } finally {
    registry.dispose();
  }
});

test("Native revisions and Renderer projections never serialize the private owner", async () => {
  let currentOwner = owner;
  let configRevision = "builtin-1";
  let currentCatalog = catalog;
  const source = new AccountProviderService({
    configSource: {
      read: async () => ({ ...config(), zcodeBuiltinRevision: configRevision }),
      onDidChange: () => () => {},
    },
    resolve: async (input) =>
      resolveNewApiAccountProviders({
        owner: currentOwner,
        catalog: currentCatalog,
        entitlements,
        configRevision: input.configRevision,
      }),
  });
  const registry = new ProviderRegistryService({
    configSource: {
      read: async () => ({ ...config(), zcodeBuiltinRevision: configRevision }),
      onDidChange: () => () => {},
    },
    accountSource: source,
  });
  try {
    await registry.start();
    const first = await source.read();
    assert.match(first.revision, /^account:sha256:[a-f0-9]{64}$/);
    assert.equal(
      registry.getProvider("account:new-api-openai-responses")?.accountOwner?.sid,
      owner.sid,
    );
    assert.equal(
      registry.getProvider("account:new-api-openai-responses")?.accountRevision,
      first.revision,
    );
    assert.equal(
      registry.getModel("account:new-api-openai-responses", "real-model")?.displayName,
      "Real",
    );
    for (const projected of [
      new ModelSelectionFacade(registry).getView(),
      new ProviderSettingsFacade(registry).getView(),
    ]) {
      assert.equal(JSON.stringify(projected).includes('"accountOwner"'), false);
      for (const field of ["userId", "sid", "authGeneration"])
        assert.equal(JSON.stringify(projected).includes(`"${field}"`), false);
    }
    for (const field of ["origin", "userId", "sid", "authGeneration"])
      assert.equal(first.revision.includes(field), false);
    assert.equal(first.revision.includes(owner.origin), false);
    assert.equal(first.revision.includes(owner.sid), false);
    assert.equal((await source.refresh("same-facts")).revision, first.revision);
    configRevision = "builtin-2";
    const changedBuiltin = await source.refresh("builtin-change");
    assert.notEqual(changedBuiltin.revision, first.revision);
    currentCatalog = { ...catalog, authorization_revision: "8" };
    await assert.rejects(source.refresh("mismatch"), /revision/i);
    const denied = await source.read();
    assert.equal(denied.owner, null);
    assert.equal(denied.revision.includes(owner.sid), false);
    currentCatalog = catalog;
    currentOwner = { ...owner, authGeneration: 2 };
    const replacement = await source.refresh("generation-change");
    assert.notEqual(replacement.revision, changedBuiltin.revision);
  } finally {
    registry.dispose();
    source.dispose();
  }
});

test("initial Native denial and resolver errors do not leak origin through revision", async () => {
  const current = { ...config(), zcodeBuiltinRevision: `builtin:native:${owner.origin}` };
  const initial = createFailClosedAccountProviderConfigSnapshot(current);
  assert.equal(initial.revision.includes(owner.origin), false);
  assert.equal(initial.owner, null);
  const native = resolveNewApiAccountProviders({
    owner,
    catalog,
    entitlements,
    configRevision: current.zcodeBuiltinRevision,
  });
  const { revision: _revision, ...plaintextDetails } = native;
  assert.throws(
    () =>
      createAccountProviderConfigSnapshot(
        current.zcodeBuiltinRevision,
        native.providers,
        native.states,
        plaintextDetails,
      ),
    /opaque/,
  );
  const source = new AccountProviderService({
    configSource: { read: async () => current, onDidChange: () => () => {} },
    resolve: async () => {
      throw new Error("catalog unavailable");
    },
  });
  try {
    const denied = await source.read();
    assert.equal(denied.revision.includes(owner.origin), false);
    assert.equal(denied.owner, null);
    assert.equal(denied.providers.get("account:new-api-openai-responses")?.access?.entitled, false);
  } finally {
    source.dispose();
  }
});

test("account source synchronous invalidation removes Native models and issues before catalog IO", async () => {
  const source = new AccountProviderService({
    configSource: { read: async () => config(), onDidChange: () => () => {} },
    resolve: async (input) =>
      resolveNewApiAccountProviders({
        owner,
        catalog,
        entitlements,
        configRevision: input.configRevision,
      }),
  });
  try {
    assert.equal((await source.read()).catalogIssues?.length, 2);
    source.invalidateNative();
    const denied = await source.read();
    assert.equal(denied.owner, null);
    assert.deepEqual(denied.catalogIssues, []);
    assert.deepEqual(denied.providers.get("account:new-api-openai-responses")?.builtinModelIds, []);
    assert.equal(denied.providers.get("account:new-api-openai-responses")?.access?.entitled, false);
  } finally {
    source.dispose();
  }
});

test("primary owner loss revokes hidden cloud models, unlike a Native read failure", async () => {
  const id = "account:off-peak-zai";
  const source = new AccountProviderService({
    configSource: { read: async () => config(), onDidChange: () => () => {} },
    resolve: async (input) => {
      const native = resolveNewApiAccountProviders({
        owner,
        catalog,
        entitlements,
        configRevision: input.configRevision,
      });
      return {
        ...native,
        providers: native.providers.set(
          id,
          new ProviderConfig({
            access: new ZhipuAccountAccessConfig({
              accountType: "zai",
              mode: "off-peak",
              entitled: true,
            }),
            builtinModelIds: ["cloud-only-model"],
          }),
        ),
        states: {
          ...native.states,
          [id]: { availability: "available", entitled: true, current: true },
        },
      };
    },
  });
  try {
    await source.read();
    source.invalidateNative();
    assert.equal((await source.read()).providers.get(id)?.access?.entitled, true);
    source.invalidateNative(true);
    const denied = await source.read();
    assert.equal(denied.providers.get(id)?.access?.entitled, false);
    assert.deepEqual(denied.providers.get(id)?.builtinModelIds, []);
    assert.equal(denied.states?.[id]?.availability, "unavailable");
  } finally {
    source.dispose();
  }
});

test("materialized and refreshed CDN config keep the three explicit-origin local anchors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "native-anchors-"));
  const content = (revision: number) =>
    JSON.stringify({
      schemaVersion: 1,
      revision,
      config: {
        providerConfigRules: { templateRules: [], providerRules: [] },
        modelConfigRules: ModelConfigRules.empty().toZCodeBuiltinJSON(),
      },
    });
  const builtin = await materializeZCodeBuiltinProviderConfig({
    environmentConfigRoot: dir,
    content: content(1),
    newApiOrigin: owner.origin,
  });
  const runtime = new NodeProviderConfigRuntime({
    zcodeBuiltinFilePath: builtin,
    newApiOrigin: owner.origin,
    personalFilePath: join(dir, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
  });
  try {
    const first = await runtime.configService.read();
    assert.equal(first.zcodeBuiltinProviders.keys().length, 3);
    assert.equal(
      first.zcodeBuiltinProviders.get("account:new-api-anthropic-messages")?.api?.baseUrl,
      owner.origin,
    );
    await writeFile(builtin, content(2));
    const refreshed = await runtime.configService.read();
    assert.equal(refreshed.zcodeBuiltinProviders.keys().length, 3);
    assert.equal(
      refreshed.zcodeBuiltinProviders.get("account:new-api-openai-responses")?.api?.baseUrl,
      `${owner.origin}/v1`,
    );
    assert.notEqual(refreshed.zcodeBuiltinRevision, first.zcodeBuiltinRevision);
  } finally {
    runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Registry readiness survives a superseded initial account failure", async () => {
  let rejectFirst!: (error: Error) => void;
  let entered!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = new Promise<never>((_, reject) => {
    rejectFirst = reject;
  });
  let reads = 0;
  const configSource = { read: async () => config(), onDidChange: () => () => {} };
  const source = new AccountProviderService({
    configSource,
    resolve: async (input) => {
      if (++reads === 1) {
        entered();
        await first;
      }
      return resolveNewApiAccountProviders({
        owner,
        catalog,
        entitlements,
        configRevision: input.configRevision,
      });
    },
  });
  const registry = new ProviderRegistryService({ configSource, accountSource: source });
  try {
    const ready = registry.start();
    await firstEntered;
    const replacement = source.refresh("newer-account-state");
    rejectFirst(new Error("superseded network failure"));
    await ready;
    await replacement;
    assert.equal(
      registry.getModel("account:new-api-openai-responses", "real-model")?.displayName,
      "Real",
    );
  } finally {
    registry.dispose();
    source.dispose();
  }
});
