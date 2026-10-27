// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pluginGuideTargetKey,
  type PluginGuideDocument,
  type PluginGuideSnapshot,
  type PluginGuideTarget,
} from "@zcode/shared/xwork-plugin-guides";
import { usePluginGuideModel } from "@/xwork/plugin-guides/usePluginGuideModel.js";
import type { IPluginGuideService } from "@/xwork/plugin-guides/contract.js";
import { usePluginGuide } from "@/xwork/plugin-guides/usePluginGuide.js";

const catalog = vi.hoisted(() => ({ state: {} as Record<string, unknown>, read: vi.fn() }));
vi.mock("@/hooks/useModelSelectionView.js", () => ({
  useModelSelectionView: (...args: unknown[]) => {
    catalog.read(...args);
    return { state: catalog.state, reload: vi.fn() };
  },
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
const target: PluginGuideTarget = {
  workspacePath: "/remote/project",
  workspaceIdentity: "remote:project",
  remoteSessionId: "remote-host",
  marketplace: "official",
  pluginName: "pdf",
  locale: "en-US",
};
const preferred = { providerId: "p", modelId: "m", options: { reasoningLevel: "max" } };
function view() {
  return {
    revision: 1,
    preferredSelection: preferred,
    providers: [
      {
        providerId: "p",
        providerName: "Provider",
        config: { api: { type: "openai-chat-completions" } },
        models: [
          {
            modelId: "m",
            config: { optionSpecs: { reasoningLevel: { values: ["low", "high", "max"] } } },
          },
          { modelId: "other", config: { optionSpecs: {} } },
        ],
      },
      { providerId: "empty", config: { api: { type: "openai-chat-completions" } }, models: [] },
    ],
  };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("reader-local guide model", () => {
  it("uses the target Host and lowest public effort without writing preferred selection", () => {
    catalog.state = { status: "ready", view: view() };
    const { result } = renderHook(() => usePluginGuideModel(target, undefined, true));
    expect(catalog.read).toHaveBeenCalledWith(
      target.workspacePath,
      target.remoteSessionId,
      target.workspaceIdentity,
    );
    expect(result.current.selection).toEqual({ ...preferred, options: { reasoningLevel: "low" } });
    expect(result.current.groups.map((group) => group.key)).toEqual(["registry-provider:p"]);
    expect(preferred.options.reasoningLevel).toBe("max");
  });
  it("restores a supported saved choice and preserves explicit effort through catalog refresh", () => {
    const selected = { ...preferred, options: { reasoningLevel: "high" } };
    catalog.state = { status: "ready", view: view() };
    const saved = { selection: selected } as PluginGuideDocument;
    const { result, rerender } = renderHook(() => usePluginGuideModel(target, saved, true));
    expect(result.current.selection).toEqual(selected);
    act(() => result.current.setSelection({ ...preferred, options: { reasoningLevel: "max" } }));
    const changed = view();
    catalog.state = {
      status: "ready",
      view: {
        ...changed,
        providers: changed.providers.map((provider) => ({
          ...provider,
          models: provider.models.map((model) => ({
            ...model,
            config: { optionSpecs: { reasoningLevel: { values: ["low"] } } },
          })),
        })),
      },
    };
    rerender();
    expect(result.current.selection?.options?.reasoningLevel).toBe("max");
    expect(result.current.issue).toBeTruthy();
    expect(result.current.canGenerate).toBe(false);
  });
  it("falls back from unsupported cached choices but never silently switches an initialized choice", () => {
    catalog.state = { status: "ready", view: view() };
    const { result, rerender } = renderHook(() =>
      usePluginGuideModel(
        target,
        { selection: { providerId: "gone", modelId: "m" } } as PluginGuideDocument,
        true,
      ),
    );
    expect(result.current.selection?.providerId).toBe("p");
    catalog.state = { status: "ready", view: { ...view(), providers: [] } };
    rerender();
    expect(result.current.selection?.providerId).toBe("p");
    expect(result.current.canGenerate).toBe(false);
  });
  it("waits for the saved document before pinning the default and cannot use a waiting remote", () => {
    catalog.state = { status: "ready", view: view() };
    const { result, rerender } = renderHook(
      ({ ready }) => usePluginGuideModel(target, undefined, ready),
      { initialProps: { ready: false } },
    );
    expect(result.current.selection).toBeUndefined();
    catalog.state = { status: "unavailable", reason: "remote-waiting" };
    rerender({ ready: true });
    expect(result.current.canGenerate).toBe(false);
    expect(result.current.groups).toEqual([]);
  });
});

function guidePort(phase: PluginGuideSnapshot["phase"]) {
  const snapshot: PluginGuideSnapshot = {
    key: pluginGuideTargetKey(target),
    target,
    sequence: 1,
    phase: "ready",
    document: null,
    messages: [],
    previewMarkdown: "",
    previewReply: "",
    stale: false,
  };
  const service: IPluginGuideService = {
    read: vi.fn(async () => snapshot),
    generate: vi.fn(async () => ({ ...snapshot, sequence: 2, phase })),
    cancel: vi.fn(async () => {}),
    retrySave: vi.fn(async () => snapshot),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  };
  return service;
}

describe("guide generation acceptance", () => {
  it.each(["error", "cancelled", "generating"] as const)(
    "does not accept a %s generation as a reason to clear input",
    async (phase) => {
      const service = guidePort(phase);
      const { result } = renderHook(() => usePluginGuide(service, target));
      await waitFor(() => expect(result.current.snapshot?.phase).toBe("ready"));
      await act(async () => expect(await result.current.generate("Keep this draft")).toBe(false));
    },
  );

  it.each(["ready", "unsaved"] as const)(
    "accepts a completed %s result with its local choice without resubscribing",
    async (phase) => {
      const service = guidePort(phase);
      const { result, rerender } = renderHook(() => usePluginGuide(service, { ...target }));
      await waitFor(() => expect(result.current.snapshot?.phase).toBe("ready"));
      const selection = {
        providerId: "reader-only",
        modelId: "model",
        options: { reasoningLevel: "high" },
      };
      rerender();
      await act(async () =>
        expect(await result.current.generate("Explain", false, selection)).toBe(true),
      );
      expect(service.generate).toHaveBeenCalledWith(expect.objectContaining({ selection }));
      expect(service.read).toHaveBeenCalledTimes(1);
      expect(service.onDidChange).toHaveBeenCalledTimes(1);
    },
  );
});
