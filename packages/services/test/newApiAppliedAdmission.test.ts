import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import {
  createAccountProviderConfigSnapshot,
  ModelConfigRules,
  ProviderConfigMap,
  ProviderConfigResolver,
  projectModelSelectionProviderView,
} from "@zcode/provider";
import { createNewApiProviderAnchors } from "@zcode/provider-node";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";
import { createZCodeAgentConnectionScope } from "../src/zcode-agent/zcodeAgentConnectionScope.js";
import { setDataBaseDir } from "../src/paths.js";
import { resolveNewApiAccountProviders } from "../src/new-api/newApiAccountProviderResolution.js";
import { owner, catalog, entitlements, modelConfig } from "./newApiRegistryFixtures.js";

for (const mode of ["desktop-continuous", "web-remote-replayable"] as const) {
  for (const type of ["sendText", "createSession"] as const) {
    test(
      `${mode} ${type} waits for applied config and retries without consuming command identity`,
      { timeout: 20_000 },
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "xwork-applied-admission-"));
        setDataBaseDir(dir);
        const transcriptPath = join(dir, "transcript.jsonl");
        const workerPath = join(dir, "worker.mjs");
        const transportUrl = new URL(
          "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/transport.ts",
          import.meta.url,
        ).href;
        const sharedUrl = new URL("../../shared/src/index.ts", import.meta.url).href;
        await writeFile(
          workerPath,
          `
import { appendFile } from "node:fs/promises";
import { ZCodeProtocolNdjsonConnection } from ${JSON.stringify(transportUrl)};
import { zcodeProtocolMethods, zcodeProviderUpdateAccountConfigParamsSchema } from ${JSON.stringify(sharedUrl)};
let updates = 0;
const connection = new ZCodeProtocolNdjsonConnection({
  input: process.stdin, output: process.stdout,
  handleMessage: async (message) => {
    if (!("id" in message) || !("method" in message)) throw new Error("Unexpected notification");
    await appendFile(${JSON.stringify(transcriptPath)}, JSON.stringify(message) + "\\n");
    if (message.method === zcodeProtocolMethods.providerUpdateAccountConfig) {
      const snapshot = zcodeProviderUpdateAccountConfigParamsSchema.parse(message.params);
      updates++;
      return { id: message.id, result: {
        receivedRevision: snapshot.revision,
        appliedRevision: updates === 1 ? "old-applied-revision" : snapshot.revision,
        providerCount: Object.keys(snapshot.providers).length,
        status: updates === 1 ? "received" : "unchanged",
      }};
    }
    if (message.method === zcodeProtocolMethods.providerRefreshRegistry) {
      return { id: message.id, result: { refreshed: true } };
    }
    if (message.method === "v4/command") {
      return { id: message.id, result: {
        commandId: message.params.commandId,
        status: "accepted", revisionAtDecision: 1,
      }};
    }
    throw new Error("Unexpected method: " + message.method);
  },
});
connection.start();
await connection.waitForClose();
`,
        );
        const native = resolveNewApiAccountProviders({
          owner,
          catalog: {
            ...catalog,
            models: [{ ...catalog.models[0]!, api_type: "openai-chat-completions" }],
          },
          entitlements,
          configRevision: "builtin-1",
        });
        const snapshot = createAccountProviderConfigSnapshot(
          "builtin-1",
          native.providers,
          native.states,
          native,
        );
        let currentSnapshot = snapshot;
        let heldRead: (() => Promise<void>) | undefined;
        let releaseHeldRead: (() => void) | undefined;
        let reads = 0;
        const pendingAdmissions: Promise<unknown>[] = [];
        const resolution = new ProviderConfigResolver().resolve({
          zcodeBuiltinProviders: createNewApiProviderAnchors(owner.origin),
          personalProviders: ProviderConfigMap.empty(),
          personalModels: ModelConfigRules.empty(),
          zcodeBuiltinModelRules: ModelConfigRules.empty(),
          accountProviders: native.providers,
          accountModelConfigs: native.modelConfigs,
          accountStates: native.states,
        });
        const agent = createZCodeAgentService({
          commandResolver: () => ({
            command: process.execPath,
            args: ["--import", import.meta.resolve("tsx"), workerPath],
            cwd: dir,
            env: { TSX_TSCONFIG_PATH: fileURLToPath(new URL("./tsconfig.json", import.meta.url)) },
          }),
          requestTimeoutMs: 5_000,
          accountProviderConfigSource: {
            read: async () => {
              reads++;
              const accepted = currentSnapshot;
              const hold = heldRead;
              heldRead = undefined;
              if (hold) await hold();
              return accepted;
            },
            onDidChange: () => () => {},
          },
          modelSelectionReadinessSource: {
            getView: async () => ({
              revision: 1,
              providers: resolution.registryProviders
                .filter((provider) => provider.config.visibility !== "hidden")
                .map(projectModelSelectionProviderView),
            }),
          },
        });
        const scope = createZCodeAgentConnectionScope(agent, {
          connectionId: `${mode}-${type}`,
          clientMode: mode,
        });
        const envelope = {
          commandId: "retry-same-command",
          clientId: "isolated-consumer",
          sessionId: type === "createSession" ? null : "isolated-session",
          type,
          payload:
            type === "createSession"
              ? { workspaceId: "isolated-workspace" }
              : { text: "isolated input" },
          issuedAt: Date.now(),
        };
        const params = { workspacePath: dir, envelope };
        const transcript = async () =>
          (await readFile(transcriptPath, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        try {
          await assert.rejects(
            scope.service.sendConversationCommandV4(params),
            /helloRequired|handshakeRequired/,
          );
          const hello = await scope.service.helloConversationV4();
          await scope.service.initializeConversationV4({
            kind: "clientHello",
            protocolVersion: hello.protocolVersion,
            clientId: envelope.clientId,
            appVersion: "isolated-test",
          });
          await assert.rejects(
            scope.service.sendConversationCommandV4({
              ...params,
              envelope: { ...envelope, clientId: "wrong-consumer" },
            }),
            /clientMismatch/,
          );
          await assert.rejects(
            scope.service.sendConversationCommandV4(params),
            /Account Config 尚未在 Worker Registry 应用或回执版本不一致/,
          );
          assert.deepEqual(
            (await transcript()).map((entry) => entry.method),
            ["provider/updateAccountConfig"],
          );
          const accepted = await scope.service.sendConversationCommandV4(params);
          assert.equal(accepted.status, "accepted");
          assert.equal(accepted.commandId, envelope.commandId);
          const admitted = await transcript();
          assert.deepEqual(
            admitted.map((entry) => entry.method),
            [
              "provider/updateAccountConfig",
              "provider/updateAccountConfig",
              "provider/refreshRegistry",
              "v4/command",
            ],
          );
          const forwarded = admitted[3].params;
          assert.equal(forwarded.commandId, envelope.commandId);
          assert.equal(forwarded.clientId, envelope.clientId);
          assert.equal(forwarded.sessionId, envelope.sessionId);
          if (type === "sendText") assert.equal(forwarded.payload.text, "isolated input");
          else assert.equal(forwarded.payload.workspaceId, "isolated-workspace");
          await scope.service.sendConversationCommandV4({
            ...params,
            envelope: { ...envelope, commandId: "next-command" },
          });
          assert.deepEqual(
            (await transcript()).map((entry) => entry.method),
            [
              "provider/updateAccountConfig",
              "provider/updateAccountConfig",
              "provider/refreshRegistry",
              "v4/command",
              "provider/refreshRegistry",
              "v4/command",
            ],
          );

          const revisions = [9000, 10000].map((contextWindow) => {
            const next = resolveNewApiAccountProviders({
              owner,
              entitlements,
              configRevision: "builtin-1",
              catalog: {
                ...catalog,
                catalog_revision: `catalog-context-${contextWindow}`,
                models: [
                  {
                    ...catalog.models[0]!,
                    api_type: "openai-chat-completions",
                    model_config: {
                      ...modelConfig,
                      properties: { ...modelConfig.properties, contextWindow },
                    },
                  },
                ],
              },
            });
            return createAccountProviderConfigSnapshot(
              "builtin-1",
              next.providers,
              next.states,
              next,
            );
          });
          const readEntered = Promise.withResolvers<void>();
          const releaseRead = Promise.withResolvers<void>();
          releaseHeldRead = () => releaseRead.resolve();
          const beforeHeldRead = reads;
          currentSnapshot = revisions[0]!;
          heldRead = async () => {
            readEntered.resolve();
            await releaseRead.promise;
          };
          pendingAdmissions.push(
            scope.service.sendConversationCommandV4({
              ...params,
              envelope: { ...envelope, commandId: "held-first" },
            }),
          );
          await readEntered.promise;
          currentSnapshot = revisions[1]!;
          pendingAdmissions.push(
            scope.service.sendConversationCommandV4({
              ...params,
              envelope: { ...envelope, commandId: "held-second" },
            }),
          );
          await setImmediate();
          assert.equal(
            reads,
            beforeHeldRead + 1,
            "second read cannot overtake the first queued read",
          );
          releaseRead.resolve();
          await Promise.all(pendingAdmissions);
          const accountUpdates = (await transcript()).filter(
            (entry) => entry.method === "provider/updateAccountConfig",
          );
          assert.deepEqual(
            accountUpdates.slice(-2).map((entry) => entry.params.revision),
            revisions.map((revision) => revision.revision),
          );
        } finally {
          releaseHeldRead?.();
          await Promise.allSettled(pendingAdmissions);
          await scope.dispose();
          await agent.disposeAllAndWait();
          setDataBaseDir(null);
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  }
}
