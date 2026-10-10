import type { AiSdkModelAdapter } from "@zcode/adapters/model";
import type { Model } from "@zcode/contracts";
import type { AgentRuntimeDeps } from "@zcode/core";
import {
  type ModelSelection,
  type ModelSelectionValidation,
  type Provider,
  type ProviderModel,
  type ProviderRegistryView,
} from "@zcode/provider";
import { createRegistrySelectionProtocolError } from "./provider-registry-selection.js";

export type RuntimeModelFactory = NonNullable<AgentRuntimeDeps["modelFactory"]>;

export interface ProviderRegistryModelSource {
  getView(): ProviderRegistryView;
  getProvider(providerId: string): Provider | undefined;
  getModel(providerId: string, modelId: string): ProviderModel | undefined;
  validateSelection(selection: ModelSelection): ModelSelectionValidation;
  onDidChange(listener: () => void): () => void;
}

type ApiProviderModelAdapter = Pick<AiSdkModelAdapter, "createModel">;

interface ApiProviderModelRuntimeOptions {
  readonly registry: ProviderRegistryModelSource;
  readonly modelAdapter: ApiProviderModelAdapter;
}

/**
 * 从业务 Registry 精确查找一次完整事实，并直接创建冻结静态配置的 Model。
 */
export class ApiProviderModelRuntime {
  readonly #registry: ProviderRegistryModelSource;
  readonly #modelAdapter: ApiProviderModelAdapter;
  #started = false;
  #registryUnsubscribe?: () => void;
  #nativeExecution: { owner: NonNullable<Provider["accountOwner"]>; revision: string; controller: AbortController } | null = null;
  readonly #officialExecutions = new Map<string, { identity: string; controller: AbortController }>();

  constructor(options: ApiProviderModelRuntimeOptions) {
    this.#registry = options.registry;
    this.#modelAdapter = options.modelAdapter;
  }

  readonly modelFactory: RuntimeModelFactory = (target): Model => {
    if (!this.#started) throw new Error("ApiProviderModelRuntime 必须先 start() 再创建 Model");
    const validation = this.#registry.validateSelection(target.selection);
    if (!validation.ok) throw createRegistrySelectionProtocolError(validation);
    const providerId = target.selection.providerId;
    const modelId = target.selection.modelId;
    const provider = this.#registry.getProvider(providerId);
    if (!provider) throw new Error("Registry Selection 校验与 Provider 索引结果不一致");
    const registryModel = this.#registry.getModel(providerId, modelId);
    if (!registryModel) throw new Error("Registry Selection 校验与 Model 索引结果不一致");
    return this.#createRegistryModel(provider, registryModel, target);
  };

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#registryUnsubscribe = this.#registry.onDidChange(() => {
      const active = this.#nativeExecution;
      if (active && !this.#registry.getView().providers.some((provider) =>
        provider.config.access.type === "new-api-account" && this.#matchesNativeExecution(provider))) {
        active.controller.abort(new DOMException("Native account authorization changed", "AbortError"));
      }
      // XCODE: 闲时凭据冻结于执行；连接代际失效后必须中止流及全部后续 attempt。
      for (const [providerId, execution] of this.#officialExecutions) {
        if (this.#registry.getProvider(providerId)?.accountConnectionKey !== execution.identity) {
          execution.controller.abort(new DOMException("Official cloud authorization changed", "AbortError"));
          this.#officialExecutions.delete(providerId);
        }
      }
    });
  }

  dispose(): void {
    this.#started = false;
    this.#registryUnsubscribe?.();
    this.#registryUnsubscribe = undefined;
    this.#nativeExecution?.controller.abort(new DOMException("Model runtime disposed", "AbortError"));
    this.#nativeExecution = null;
    for (const execution of this.#officialExecutions.values())
      execution.controller.abort(new DOMException("Model runtime disposed", "AbortError"));
    this.#officialExecutions.clear();
  }

  #matchesNativeExecution(provider: Provider): boolean {
    const active = this.#nativeExecution;
    const owner = provider.accountOwner;
    return active !== null && owner !== undefined && provider.accountRevision === active.revision &&
      owner.origin === active.owner.origin && owner.userId === active.owner.userId &&
      owner.sid === active.owner.sid && owner.authGeneration === active.owner.authGeneration;
  }

  #nativeExecutionSignal(provider: Provider): AbortSignal {
    if (!provider.accountOwner || !provider.accountRevision)
      throw new Error("Native account execution identity unavailable");
    let active = this.#nativeExecution;
    // XCODE: Registry 换 owner/revision 立即终止旧请求；自定义模型不共享这个生命周期。
    if (!active || !this.#matchesNativeExecution(provider) || active.controller.signal.aborted) {
      active?.controller.abort(new DOMException("Native account authorization changed", "AbortError"));
      active = { owner: provider.accountOwner, revision: provider.accountRevision, controller: new AbortController() };
      this.#nativeExecution = active;
    }
    return active.controller.signal;
  }

  #officialExecutionSignal(provider: Provider, identity: string | undefined): AbortSignal | undefined {
    const current = provider.accountConnectionKey;
    // XCODE: 未配置私有网关的原官方路径不要求 Native 连接身份；私有路径缺身份则拒绝。
    if (!identity && !current?.startsWith("official-cloud:sha256:")) return undefined;
    if (!identity || current !== identity) throw new Error("Official cloud execution identity changed");
    let execution = this.#officialExecutions.get(provider.providerId);
    if (!execution || execution.identity !== identity || execution.controller.signal.aborted) {
      execution?.controller.abort(new DOMException("Official cloud authorization changed", "AbortError"));
      execution = { identity, controller: new AbortController() };
      this.#officialExecutions.set(provider.providerId, execution);
    }
    return execution.controller.signal;
  }

  #createRegistryModel(
    provider: Provider,
    registryModel: ProviderModel,
    target: Parameters<RuntimeModelFactory>[0],
  ): Model {
    const config = registryModel.config;
    // 输出预算属于单次请求，由 Agent 执行链显式决定，不能在 ModelFactory 中静默绑定。
    // Selection 已在上面的 Registry 边界完成校验，Factory 不再承担任何缺省修复。
    const normalReasoningLevel = target.selection.options!.reasoningLevel!;
    return this.#modelAdapter.createModel({
      providerId: provider.providerId,
      modelId: registryModel.modelId,
      ...(registryModel.displayName !== undefined ? { displayName: registryModel.displayName } : {}),
      providerConfig: provider.config,
      modelConfig: config,
      ...(provider.config.access.type === "new-api-account"
        ? { accountAccess: { ...provider.config.access.toJSON(), owner: provider.accountOwner, accountRevision: provider.accountRevision },
          executionLifetimeSignal: this.#nativeExecutionSignal(provider) }
        : {}),
      ...(provider.config.access.type === "zhipu-account" &&
      provider.config.access.mode === "off-peak"
        ? {
            executionLifetimeSignal: this.#officialExecutionSignal(provider, target.requestDependencies?.requestAuth?.executionIdentity),
            requestDependencies: {
              requestAuth: {
                source: target.requestDependencies?.requestAuth?.source,
                executionIdentity: target.requestDependencies?.requestAuth?.executionIdentity,
              },
            },
          }
        : {}),
      options: {
        reasoningLevel: normalReasoningLevel,
      },
    });
  }
}
