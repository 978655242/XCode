import { isDeepStrictEqual } from "node:util";
import {
  ProviderConfigMap,
  resolveAccountProviderConfigs,
  type AccountProviderResolver,
} from "@zcode/provider";
import {
  resolveOffPeakProviderId,
  getModelProviderFamilySpec,
  type ZCodeAccountAccess,
  type ZCodeProviderAccountAccess,
} from "@zcode/shared";
import {
  officialCloudInvocationScope,
  type OfficialCloudConnectionHost,
  type OfficialCloudCredentialSnapshot,
} from "./officialCloudConnectionService.js";
import {
  AccountRequestCredentialUnavailableError,
  type AccountRequestAuthResolver,
  type AccountAccessIdentityInput,
} from "../model-provider/accountProviderRequestAuthService.js";

/** Cached encrypted facts only; official network refresh never blocks Native inference catalog reads. */
// XCODE: 复用官方 owner 的统一 scope，Registry、MCP 与闲时执行不得各自生成代际。
export function createOfficialCloudAccountProviderResolver(
  host: Pick<OfficialCloudConnectionHost, "resolveCredentials" | "isCurrent">,
): AccountProviderResolver {
  return async ({ configuredProviders }) => {
    // Official recovery errors are still exposed by the public cloud service, not by Native inference.
    const credentials = await host.resolveCredentials().catch(() => null);
    const connections = configuredProviders.entries().flatMap(([providerId, config]) => {
      const access = config.access;
      if (
        access?.type !== "zhipu-account" ||
        access.mode !== "off-peak" ||
        (access.accountType !== "bigmodel" && access.accountType !== "zai") ||
        providerId !== resolveOffPeakProviderId(access.accountType) ||
        config.visibility !== "hidden"
      )
        return [];
      const available = Boolean(
        credentials &&
        credentials.family === access.accountType &&
        credentials.access &&
        credentials.access.planKind !== "start-plan" &&
        credentials.codingPlanApiKey,
      );
      return [
        { providerId, status: available ? ("available" as const) : ("unavailable" as const) },
      ];
    });
    const credentialCurrent =
      credentials !== null && (await host.isCurrent(credentials).catch(() => false));
    if (!credentialCurrent) {
      for (const connection of connections) connection.status = "unavailable";
    }
    const providers = resolveAccountProviderConfigs({
      configuredProviders,
      previousProviders: new ProviderConfigMap(),
      connections,
    });
    return {
      providers,
      states: Object.fromEntries(
        connections.map((connection) => [
          connection.providerId,
          {
            availability: connection.status,
            entitled: connection.status === "available",
            current: connection.status === "available",
            // XCODE: 登录身份与闲时权益分离；无 Plan 的有效官方登录仍可准入 identity-only MCP。
            ...(credentialCurrent &&
            credentials &&
            connection.providerId === resolveOffPeakProviderId(credentials.family)
              ? { connectionKey: officialCloudInvocationScope(credentials) }
              : {}),
          },
        ]),
      ),
    };
  };
}

function matchesAccess(
  input: ZCodeProviderAccountAccess | ZCodeAccountAccess,
  credentials: OfficialCloudCredentialSnapshot,
): boolean {
  const actual = credentials.access;
  if (input.type !== "zhipu-account" || !actual) return false;
  if ("mode" in input)
    return (
      input.accountType === credentials.family &&
      (input.mode === "off-peak" || input.mode === actual.planKind)
    );
  return input.family === credentials.family && isDeepStrictEqual(input, actual);
}

/** Private hosts permit explicit cloud dispatch/usage, never ordinary legacy inference. */
export function createOfficialCloudAccountRequestAuthResolver(
  host: OfficialCloudConnectionHost,
): AccountRequestAuthResolver {
  const assert = async (
    input: AccountAccessIdentityInput,
  ): Promise<OfficialCloudCredentialSnapshot> => {
    const credentials = await host.resolveCredentials();
    if (!credentials || !matchesAccess(input.accountAccess, credentials) || !credentials.access)
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    const spec = getModelProviderFamilySpec(credentials.family);
    const planProviderId =
      credentials.access.planKind === "team-coding-plan"
        ? spec.teamCodingPlanProviderId
        : spec.individualCodingPlanProviderId;
    if (
      input.providerId !== resolveOffPeakProviderId(credentials.family) &&
      input.providerId !== planProviderId
    )
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    if (!(await host.isCurrent(credentials)))
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    return credentials;
  };
  return {
    async resolveAccessCurrent(access) {
      const credentials = await host.resolveCredentials();
      if (
        !credentials ||
        !matchesAccess(access, credentials) ||
        !(await host.isCurrent(credentials))
      )
        return null;
      return credentials.access;
    },
    async assertCurrent(input) {
      await assert(input);
    },
    async resolveCurrent(input) {
      if (input.reason === "model-request")
        throw new AccountRequestCredentialUnavailableError(input.providerId);
      const credentials = await assert(input);
      if (!credentials.codingPlanApiKey || credentials.access?.planKind === "start-plan")
        throw new AccountRequestCredentialUnavailableError(input.providerId);
      if (
        input.reason === "usage" &&
        input.providerId === resolveOffPeakProviderId(credentials.family)
      )
        throw new AccountRequestCredentialUnavailableError(input.providerId);
      return { apiKey: credentials.codingPlanApiKey };
    },
  };
}
