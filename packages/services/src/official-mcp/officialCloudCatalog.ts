import {
  ModelConfigRules,
  ProviderConfigMap,
  ProviderConfigResolver,
  resolveAccountProviderConfigs,
  projectModelSelectionProviderView,
  type ModelSelectionView,
} from "@zcode/provider";
import {
  NodeZCodeBuiltinProviderConfigSource,
  ZCodeBuiltinRemoteSynchronizer,
  resolveZCodeBuiltinCachePaths,
  resolveZCodeBuiltinClientPlatform,
} from "@zcode/provider-node";
import {
  buildRuntimeZCodeApiUrl,
  ZCODE_VERSION,
  buildRuntimeZaiBusinessUrl,
  resolveBigModelApiOrigin,
  type ProjectAccessTokenClient,
  type ProjectAccessTokenMaterial,
  type ApiClient,
  type ZCodeAccountAccess,
} from "@zcode/shared";
import type { OfficialCloudCatalog, OfficialCloudFamily } from "@zcode/shared";
import { AccountProviderApiClient } from "../model-provider/accountProviderApiClient.js";
import {
  fetchPersonalCodingPlanEntitlement,
  fetchTeamCodingPlanEntitlement,
} from "../bigmodel/codingPlanEntitlement.js";
import { createAccountProjectTokenClient } from "../model-provider/accountProjectTokenClient.js";
import { z } from "zod";
import { getAppConfigDir } from "../paths.js";
import { fetchZCodeBuiltinRemoteRelease } from "../model-provider/zcodeBuiltinRemoteConfig.js";

export interface OfficialCloudMaterial {
  access: ZCodeAccountAccess | null;
  catalog: OfficialCloudCatalog;
}
export interface OfficialCloudLoginCredentials {
  family: OfficialCloudFamily;
  accessToken: string;
  jwt: string;
}
export function createOfficialCloudCatalogSource(
  zcodeBuiltinFilePath: string,
  apiClient?: ApiClient,
) {
  const origin = new URL(buildRuntimeZCodeApiUrl(process.env, "/")).origin;
  const platform = resolveZCodeBuiltinClientPlatform();
  const paths = resolveZCodeBuiltinCachePaths({
    environmentConfigRoot: getAppConfigDir(),
    platform,
    appVersion: ZCODE_VERSION,
    zcodeEndpointOrigin: origin,
  });
  const source = new NodeZCodeBuiltinProviderConfigSource({
    bundledFilePath: zcodeBuiltinFilePath,
    activeFilePath: paths.activeFilePath,
    watch: false,
  });
  const synchronizer = apiClient
    ? new ZCodeBuiltinRemoteSynchronizer({
        source,
        controlFilePath: paths.controlFilePath,
        resolveEndpointKey: () => origin,
        fetchRelease: (_endpoint, signal) =>
          fetchZCodeBuiltinRemoteRelease({
            apiClient,
            endpointOrigin: origin,
            appVersion: ZCODE_VERSION,
            platform,
            signal,
          }),
      })
    : null;
  return async (access: ZCodeAccountAccess | null): Promise<ModelSelectionView> => {
    // Official remote failure uses its own official bundled/LKG, never a Native catalog.
    await synchronizer?.refresh().catch(() => undefined);
    const config = await source.read();
    const connections = config.providers.entries().flatMap(([providerId, provider]) => {
      if (provider.access?.type !== "zhipu-account") return [];
      const available = Boolean(
        access &&
        provider.access.accountType === access.family &&
        (provider.access.mode === access.planKind || provider.access.mode === "off-peak"),
      );
      return [
        { providerId, status: available ? ("available" as const) : ("unavailable" as const) },
      ];
    });
    const resolved = new ProviderConfigResolver().resolve({
      zcodeBuiltinProviders: config.providers,
      zcodeBuiltinProviderTemplates: config.providerTemplates,
      zcodeBuiltinModelRules: config.models,
      personalProviders: new ProviderConfigMap(),
      personalModels: new ModelConfigRules(),
      accountProviders: resolveAccountProviderConfigs({
        configuredProviders: config.providers,
        previousProviders: new ProviderConfigMap(),
        connections,
      }),
    });
    return {
      revision: Number(config.revision.split(":")[1]),
      providers: resolved.registryProviders
        .filter(
          (provider) =>
            provider.config.access.type === "zhipu-account" &&
            provider.config.access.entitled &&
            provider.config.access.accountType === access?.family,
        )
        .map(projectModelSelectionProviderView),
    };
  };
}

export function toOfficialCloudCatalog(view: ModelSelectionView): OfficialCloudCatalog {
  return {
    revision: view.revision,
    providers: view.providers.map((provider) => ({
      providerId: provider.providerId,
      ...(provider.providerName ? { providerName: provider.providerName } : {}),
      modelIds: provider.models.map((model) => model.modelId),
    })),
  };
}
const customerSchema = z.object({
  organizations: z
    .array(
      z.object({
        organizationId: z.string(),
        projects: z
          .array(
            z.object({
              projectId: z.string(),
              projectType: z.union([z.number(), z.string()]).nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
});

/** Reuses real official key/entitlement adapters; an absent Plan is never inferred from Native. */
export function createOfficialCloudMaterialLoader(options: {
  apiClient: ApiClient;
  readModelView: (access: ZCodeAccountAccess | null) => Promise<ModelSelectionView>;
  tokenClient?: ProjectAccessTokenClient;
}) {
  const remote = new AccountProviderApiClient(options.apiClient);
  const tokens = options.tokenClient ?? createAccountProjectTokenClient(options.apiClient);
  return async (credentials: OfficialCloudLoginCredentials): Promise<OfficialCloudMaterial> => {
    const family = credentials.family;
    const host =
      family === "zai"
        ? new URL(buildRuntimeZaiBusinessUrl(process.env, "/")).origin
        : resolveBigModelApiOrigin(process.env);
    const authorization =
      family === "zai" ? `Bearer ${credentials.accessToken}` : credentials.accessToken;
    const customer = customerSchema.parse(
      await remote.fetchRemoteData(`${host}/api/biz/customer/getCustomerInfo`, {
        method: "GET",
        // XCODE: 与上游项目 Token resolver 共用 customerInfo 裸业务 token 契约，不能套 Z.ai Key 管理的 Bearer。
        headers: { Authorization: credentials.accessToken },
      }),
    );
    let access: ZCodeAccountAccess | null = null;
    if (
      (customer.organizations ?? []).some((organization) =>
        (organization.projects ?? []).some(
          (project) => String(project.projectType ?? "").trim() !== "2",
        ),
      )
    ) {
      const material = await tokens.resolve({
        origin: host,
        family,
        loginToken: credentials.accessToken,
        accountId: family,
      });
      const personal = await fetchPersonalCodingPlanEntitlement({
        apiClient: options.apiClient,
        authorization: material.token,
        url: `${host}/api/biz/subscription/list`,
        timeoutMs: 15_000,
      });
      if (personal.kind === "available")
        access = { type: "zhipu-account", family, planKind: "individual-coding-plan" };
    }
    if (!access) {
      for (const organization of customer.organizations ?? []) {
        for (const project of organization.projects ?? []) {
          if (String(project.projectType) !== "2") continue;
          const teamContext = {
            organizationId: organization.organizationId,
            projectId: project.projectId,
          };
          const entitlement = await fetchTeamCodingPlanEntitlement({
            apiClient: options.apiClient,
            authorization,
            host,
            teamContext,
            timeoutMs: 15_000,
          });
          if (entitlement.kind !== "available" || !entitlement.subscription.productId) continue;
          await tokens.resolve({
            origin: host,
            family,
            loginToken: credentials.accessToken,
            accountId: family,
            team: teamContext,
          });
          access = {
            type: "zhipu-account",
            family,
            planKind: "team-coding-plan",
            ...teamContext,
            productId: entitlement.subscription.productId,
          };
          break;
        }
        if (access) break;
      }
    }
    return {
      access,
      catalog: toOfficialCloudCatalog(await options.readModelView(access)),
    };
  };
}

export function resolveOfficialCloudCatalogDependencies(dependencies: {
  apiClient?: ApiClient;
  zcodeBuiltinFilePath?: string;
  readModelView?: (access: OfficialCloudMaterial["access"]) => Promise<ModelSelectionView>;
  loadCloud?: (credentials: OfficialCloudLoginCredentials) => Promise<OfficialCloudMaterial>;
  resolveCodingPlanMaterial?: (
    credentials: OfficialCloudLoginCredentials & {
      access: ZCodeAccountAccess | null;
      accountIdentity: string;
    },
    rejectedProjectTokenFingerprint?: string,
  ) => Promise<ProjectAccessTokenMaterial | null>;
}) {
  const tokenClient = dependencies.apiClient
    ? createAccountProjectTokenClient(dependencies.apiClient)
    : null;
  const readModelView =
    dependencies.readModelView ??
    (dependencies.zcodeBuiltinFilePath
      ? createOfficialCloudCatalogSource(dependencies.zcodeBuiltinFilePath, dependencies.apiClient)
      : null);
  const loadCloud =
    dependencies.loadCloud ??
    (dependencies.apiClient && readModelView
      ? createOfficialCloudMaterialLoader({
          apiClient: dependencies.apiClient,
          readModelView,
          tokenClient: tokenClient!,
        })
      : null);
  if (!loadCloud)
    throw new Error("Official cloud requires the original official catalog and API client");
  const resolveCodingPlanMaterial =
    dependencies.resolveCodingPlanMaterial ??
    (async (
      credentials: OfficialCloudLoginCredentials & {
        access: ZCodeAccountAccess | null;
        accountIdentity: string;
      },
      rejectedProjectTokenFingerprint?: string,
    ): Promise<ProjectAccessTokenMaterial | null> => {
      if (!tokenClient) throw new Error("Official cloud project token client unavailable");
      const access = credentials.access;
      if (!access || access.planKind === "start-plan") return null;
      return tokenClient.resolve({
        origin:
          credentials.family === "zai"
            ? new URL(buildRuntimeZaiBusinessUrl(process.env, "/")).origin
            : resolveBigModelApiOrigin(process.env),
        family: credentials.family,
        loginToken: credentials.accessToken,
        accountId: credentials.accountIdentity,
        rejectedProjectTokenFingerprint,
        ...(access.planKind === "team-coding-plan"
          ? { team: { organizationId: access.organizationId, projectId: access.projectId } }
          : {}),
      });
    });
  return {
    readModelView,
    loadCloud,
    resolveCodingPlanMaterial,
    clearCodingPlanMaterial: () => tokenClient?.clear(),
  };
}
