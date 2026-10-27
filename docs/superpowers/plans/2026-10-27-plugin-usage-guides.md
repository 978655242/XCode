# Plugin usage guides implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the integration and independent task agents for owned CLI/UI slices. Steps use checkbox syntax for tracking.

**Goal:** Deliver the approved plugin reader, uniform seven-section guide, first-open real streaming generation, host-local reuse, and an embedded question/edit interaction using existing XWork frontend components.

**Architecture:** A new Host service owns guide operations and atomic local records; Renderer consumes a typed service snapshot/event and holds only its input/navigation. Additive CLI methods resolve read-only plugin materials and stream a workspace model through existing Core ModelFactory/auth/admission/usage helpers. Reuse one shared plugin detail extension slot; preserve existing non-streaming methods and default upstream behavior.

**Tech Stack:** TypeScript, React, current AI Elements/house UI, existing RPC descriptors and protocol notifications, Node async files and file locks, Zod, Vitest and actual Electron/browser smoke.

**Spec:** `docs/xcode/specs/plugin-usage-guides.md`

## Global constraints

- Seven chapters and user questions are defined by the accepted spec; successful full revisions persist with their question/answer history.
- No new dependency, direct Renderer provider call, plugin execution, implicit install/enable, ordinary task creation, model-setting mutation, or unrelated cleanup.
- Source identity, version/content revision, locale and template version separate records; host/workspace identity routes requests and discards late UI responses.
- Upstream files receive additive registrations or generic composition points only, marked XCODE; extension implementation stays in new XWork modules.
- Reuse `text-ui-*`, Zai Light/Dark, main ChatPromptEditor / ModelConfigSelect and existing message Markdown/scroll behaviors.
- Node 24.14.0 and pnpm 10.33.2; all files must belong to declared architecture modules. Use shared package public exports.

## Review focus

- A failed, refused, truncated or cancelled replacement never destroys the previous complete saved revision.
- Cached reading works without a provider request; failure to persist can retry saving without paying for generation again.
- Untrusted docs cannot read outside an authorized plugin root, execute code, or send config credential values to the model.
- Duplicate first-open consumers share one in-flight operation; a late event for another plugin/locale/service cannot update the visible guide.
- Questions preserve the seven-section document while answering the user, and do not become ordinary chat messages or alter session settings.

## Intended files and ownership

- `packages/shared/src/xwork-plugin-guides/`: browser-safe guide/source/progress schemas, uniform section definitions and parsing contract; a public subpath.
- `apps/zcode-cli/packages/core/src/xwork-plugin-guides/`: generic auxiliary model text streaming using existing Core internals, exported through Core's public entrypoint without changing AgentRuntime methods.
- `apps/zcode-cli/packages/bootstrap/src/xwork-plugin-guides/`: source-material protocol handler and stream handler; reuse existing source resolver and app/runtime public handle.
- `packages/services/src/xwork-plugin-guides/`: typed service contract, prompt/output domain, Host operation owner and atomic filesystem repository; additive service registration and remote proxy.
- `packages/ui/src/xwork/plugin-guides/`: reader, guide interaction panel and service projection hook; injected through the common detail composition point.
- Existing shared method/notification registry, package export maps, service descriptor/accessor/node/proxy registries, CLI server switch, detail props/callers and locale catalogs: minimal additions.
- `architecture-policy.xwork.yaml`: only new XWork module registrations. `docs/xcode/specs/plugin-usage-guides.md`: product source of truth and final verification evidence.

### Task 1: Typed document and operation contract

**Files:** New shared module and its focused contract tests; additive shared exports/method names.

**Interfaces:** `PluginGuideTarget`, `PluginGuideDocument`, `PluginGuideMessage`, `PluginGuideSnapshot`, `PluginGuideSource` and streaming progress schemas; section/template constants and a parser for reply + full Markdown.

- [x] Write consumer tests rejecting missing chapters/unsupported complete output and separating source/locale keys.
- [x] Run the focused contract checks. Original red-first output was not retained, so red-first execution is not claimed as evidence.
- [x] Implement schemas and pure template/output parsing; keep schema validation at wire and file boundaries.
- [x] Verify contract tests and record exact public signatures for the dependent CLI, service and UI slices.

### Task 2: Read-only materials and real model streaming

**Files:** New CLI/Core extension modules, independent regression files and additive public/server registrations.

**Interfaces:** `xwork/plugins/guideSource` resolves identity/materials; `xwork/workspace/streamText` uses existing text input/result contract plus required operation ID; `xwork/workspace/textDelta` carries operation ID, monotonically increasing sequence and text delta. Existing cancellation controller can be reused for the new text operation.

- [x] Write tests for safe material selection, symlink/path escape, no install mutation, stream finish/error/cancellation and exact operation correlation.
- [x] Implement source handler by composing the existing source resolver; sanitized manifest projection and text docs only.
- [x] Implement Core streaming function using public app.runtime at bootstrap and existing model/auth/usage internals inside Core; reject unsupported finish reasons without a fake fallback.
- [x] Register methods/notifications and use current operation cancellation and lifecycle disposal.
- [x] Run the targeted CLI tests after slice integration; exercise the actual wire with a loopback SSE provider.

### Task 3: Host guide owner and durable revisions

**Files:** New service module and persistence adapter; additive descriptor/node/accessor/client proxy registration.

**Interfaces:** `IPluginGuideService.read(target)`, `generate({target,operationId,question?,regenerate?,selection?})`, `cancel({target,operationId})`, `retrySave(target)`, and `onDidChange` snapshot/preview union. The Host service internally injects materials, same-Host model selection View and real model-stream ports.

- [x] Write behavioral tests for first-open single flight, cache hit across owner recreation, question edits, failed/cancelled replacement, save retry and identity/locale separation.
- [x] Implement deterministic source/template identity and seven-section prompt; sanitized materials, the latest complete guide and guide-local question history form its context.
- [x] Implement Host-owned state and atomic repository with existing file locking. Preserve full old revisions until complete validation and save; pending unsaved result stays retryable.
- [x] Compose CLI methods through new adapter methods on the existing agent service; reuse current preferred-model View and account config sync. Use additive service registration and transport proxy.
- [x] Run owner/repository tests, including real temp-file restart proof.

### Task 4: Shared detail entry, reader and consistent question interaction

**Files:** New UI module, localized strings and minimal common detail slot/caller additions.

**Interfaces:** Reader consumes the new service port and `PluginGuideTarget`; no UI filesystem or raw provider access. Existing prompt/message components own their familiar interaction behavior.

- [x] Add an optional generic `headerActions` slot; inject the guide entry at the XWork composition boundary for market and management.
- [x] Render back/header/status, responsive TOC/body, copyable examples and expandable sources/FAQ.
- [x] Compose the shared main ChatPromptEditor, ModelConfigSelect and message Markdown/Conversation controls for questions, guide-local model/reasoning, send/stop, Enter/Shift+Enter, live output and retry feedback. Maintain plugin-local input and unsubscribe/stale-result guards.
- [x] Automatically generate only on a confirmed empty first read; cached/failed/stale states never trigger an unintended second request.
- [x] Add behavior-focused regression cases for question edits and target switches; preserve upstream tests unchanged.

### Task 5: End-to-end verification

- [x] Build CLI/Main/Host artifacts after integration; execute the actual SDK/service through loopback SSE and confirm question edits plus persisted cache reread.
- [x] Exercise the actual market entry and reader in Electron: first generation, follow-up question, stop/retry, reopening, complete process restart, 393px width and both themes; inspect the rendered surface. Other entry points share the reviewed wrapper; physical phone and other desktop platforms were not exercised.
- [x] Run focused regressions, `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check --changed` and changed-file format checks. Do not run the full test suite without user request.
- [x] Perform `git merge-tree` against `upstream/main`, distinguish existing release conflicts from this feature's added conflicts, and document modified upstream files/reasons below.
- [x] Update specification and contract documentation with actual evidence and limitations. Keep permanent E2E fixtures and ignored reports; remove isolated temporary runtime data. No commit, push or merge is included.

## Upstream merge rehearsal and extension inventory

On 2026-10-27, the fetched `upstream/main` was `3c5b227649371507ddc4eb46ac5133afe6db1cab`; the unchanged branch HEAD was release commit `b708137be6c331ac912746163a66181c085aa5d4`. Because this feature is uncommitted, the rehearsal used a separate temporary Git index containing only the task paths, wrote a tree, and created an unreferenced simulated commit. It did not modify the user's index, branch or refs.

- Baseline `git merge-tree --write-tree --name-only b708137b upstream/main`: exit 0, no conflicts; tree `831ba8baf431208916b52e15355c83ba2fd19378`.
- Initial corrected feature simulation `c65014f0be25b828b4e40a27459b747c9936f843`: exit 0, no conflicts; tree `32747586e5c071d438ea11d411c1af829a6809c6`.
- Final Composer/model-selection simulation `4aa0aba023547b63e7b02ce218e109609748d134`: exit 0, no conflicts; tree `88b4b156590c4025e085e3d47dc6f9ad69bf36c2`. Includes the verified main Composer, explicit selection path, relocated tests and final r3 E2E assertions.
- Added conflicts: 0. Each simulated tree contains its corresponding implementation; subsequent documentation-only evidence updates are not claimed to be in those historical trees.

The following 23 modified paths exist in upstream. New implementation modules and `architecture-policy.xwork.yaml` are XWork-owned. Each TS registration/composition change is marked `XCODE`; strict JSON export-map changes are explained individually here.

| Upstream path                                                       | Minimal addition and why it belongs at this integration point                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/zcode-cli/packages/adapters/src/plugins/index.ts`             | Expose the existing installed-root resolver, generic source-root callback and new reader through the adapter's public entry.                                 |
| `apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts`       | Add a read-only callback around the existing resolver/cleanup lifetime; reuse source verification without duplicating extraction or leaking temporary paths. |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server.ts`    | Register the two new auxiliary methods with their XWork handlers; preserve existing methods.                                                                 |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/transport.ts` | Compose the exact-method concurrency predicate at existing dispatch admission so long guide requests cannot block session commands.                          |
| `apps/zcode-cli/packages/core/src/index.ts`                         | Export the standalone auxiliary stream helper through Core's public entry; leave `workspace/generateText` unchanged.                                         |
| `apps/zcode-cli/vitest.config.ts`                                   | Append discovery for XWork module-local contract tests without altering upstream tests or their assertions.                                                  |
| `packages/client/src/remoteServiceAccess.ts`                        | Add the guide descriptor proxy and disposal to the existing service-access assembly.                                                                         |
| `packages/desktop/src/host/windowHostAttachmentRpcPolicy.ts`        | Compose the guide-only exposure helper at attachment assembly; keep the base resolver and protected-channel deny set unchanged.                              |
| `packages/services/package.json`                                    | Append the browser-safe `./xwork-plugin-guides` public subpath; JSON cannot carry an inline comment.                                                         |
| `packages/services/src/accessor.ts`                                 | Append the optional guide service to the accessor contract so Host scope is passed explicitly.                                                               |
| `packages/services/src/index.ts`                                    | Export the new service descriptor/types from the normal service entry.                                                                                       |
| `packages/services/src/node.ts`                                     | Assemble the Host owner, repository and Agent adapter using existing service lifecycle and local app-data path.                                              |
| `packages/services/src/zcode-agent/zcodeAgent.ts`                   | Append typed guide source/stream ports to the existing Agent interface.                                                                                      |
| `packages/services/src/zcode-agent/zcodeAgentService.ts`            | Delegate these ports to the new adapter while reusing existing process, model/auth synchronization and notification access.                                  |
| `packages/shared/package.json`                                      | Append the browser-safe shared protocol subpath; JSON cannot carry an inline comment.                                                                        |
| `packages/shared/src/zcode-protocol/index.ts`                       | Append the two method names and correlated text notification to the central protocol registry.                                                               |
| `packages/ui/src/i18n/locales/en-US.ts`                             | Append English guide-reader labels to the existing locale catalog.                                                                                           |
| `packages/ui/src/i18n/locales/zh-CN.ts`                             | Append Chinese guide-reader labels to the existing locale catalog.                                                                                           |
| `packages/ui/src/LexicalChatInput.tsx`                              | Add an optional generic slash-command switch; default stays enabled. Independent text inputs can avoid task command discovery/execution.                     |
| `packages/ui/src/prompt-editor/ChatPromptEditor.tsx`                | Forward the optional generic slash-command switch to the existing editor, allowing guide questions to reuse the main input shell without task commands.      |
| `packages/ui/src/settings/PluginStoreDetailView.tsx`                | Add only an optional generic `headerActions` slot with no default behavior change.                                                                           |
| `packages/ui/src/settings/PluginStorePage.tsx`                      | Compose the XWork wrapper at the existing common detail render point used by marketplace surfaces.                                                           |
| `packages/ui/src/settings/PluginsSection.tsx`                       | Compose the same wrapper and explicitly pass the resolved management Host's guide service, including `null` when unavailable.                                |

Final verification, E2E history and known environment/accounting limits are recorded in `docs/xcode/specs/plugin-usage-guides.md`.
