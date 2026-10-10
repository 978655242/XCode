import {
  BIGMODEL_PROVIDER_ID,
  type OAuthProviderId,
  type ProviderFamilyDomain,
  type ZCodeAccountAccess,
  type ZCodeProviderAccountAccess,
  ZAI_PROVIDER_ID,
} from "@zcode/shared";
import type { NewApiAccountService } from "../new-api/newApiAccountService.js";
import type { AccountProviderConfigSnapshot, ProviderSource } from "@zcode/provider";
import { isNewApiModelProviderId, isBuiltinModelProviderId } from "@zcode/shared";

export interface AccountRequestAuthMaterial {
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface AccountRequestAuthInput {
  providerId: string;
  modelId?: string;
  accountAccess: ZCodeProviderAccountAccess | ZCodeAccountAccess;
  reason: "model-request" | "off-peak" | "usage";
}

export interface AccountAccessIdentityInput {
  providerId: string;
  accountAccess: ZCodeProviderAccountAccess | ZCodeAccountAccess;
}

export class AccountRequestCredentialUnavailableError extends Error {
  constructor(readonly providerId: string) {
    super(`Account request credential is unavailable: ${providerId}`);
    this.name = "AccountRequestCredentialUnavailableError";
  }
}

export interface AccountRequestAuthResolver {
  resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null>;
  resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
  assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}

interface AccountProviderRequestAuthServiceOptions {
  resolveCurrentAccountAccess(
    access: ZCodeProviderAccountAccess,
  ): Promise<ZCodeAccountAccess | null>;
  loadOAuthTokenSet(providerId: OAuthProviderId): Promise<{
    accessToken?: string | null;
    zcodeJwtToken?: string | null;
  } | null>;
  loadIndividualPlanApiKey(
    providerId: string,
    family: ProviderFamilyDomain,
  ): Promise<string | null>;
  resolveTeamPlanApiKey(
    access: Extract<ZCodeAccountAccess, { planKind: "team-coding-plan" }>,
  ): Promise<string | null>;
}

class AccountProviderRequestAuthService implements AccountRequestAuthResolver {
  readonly #options: AccountProviderRequestAuthServiceOptions;

  constructor(options: AccountProviderRequestAuthServiceOptions) {
    this.#options = options;
  }

  resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null> {
    return this.#options.resolveCurrentAccountAccess(access);
  }

  async resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial> {
    const providerId = input.providerId.trim();
    if (input.accountAccess.type === "new-api-account")
      throw new Error("XCODE_PRIVATE_REQUEST_AUTH_UNCONFIGURED");
    const access = await this.#resolveAccess(input.accountAccess);
    if (!access) throw new AccountRequestCredentialUnavailableError(providerId);

    if (access.planKind === "start-plan") {
      const tokenSet = await this.#options.loadOAuthTokenSet(resolveOAuthProviderId(access.family));
      return { apiKey: requireApiKey(tokenSet?.zcodeJwtToken, providerId) };
    }

    if (access.planKind === "individual-coding-plan") {
      const apiKey = await this.#options.loadIndividualPlanApiKey(providerId, access.family);
      return { apiKey: requireApiKey(apiKey, providerId) };
    }

    const apiKey = await this.#options.resolveTeamPlanApiKey(access);
    return { apiKey: requireApiKey(apiKey, providerId) };
  }

  async assertCurrent(input: AccountAccessIdentityInput): Promise<void> {
    if (!(await this.#resolveAccess(input.accountAccess))) {
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    }
  }

  #resolveAccess(
    access: ZCodeProviderAccountAccess | ZCodeAccountAccess,
  ): Promise<ZCodeAccountAccess | null> {
    if (access.type === "new-api-account") return Promise.resolve(null);
    return "mode" in access
      ? this.#options.resolveCurrentAccountAccess(access)
      : Promise.resolve(access);
  }
}

function resolveOAuthProviderId(family: ProviderFamilyDomain): OAuthProviderId {
  return family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
}

function requireApiKey(value: string | null | undefined, providerId: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new AccountRequestCredentialUnavailableError(providerId);
  }
  return normalized;
}

export function createAccountProviderRequestAuthService(
  options: AccountProviderRequestAuthServiceOptions,
): AccountProviderRequestAuthService {
  return new AccountProviderRequestAuthService(options);
}

/** Request-period Native credentials are bound to the exact accepted account snapshot. */
export function createNewApiAccountRequestAuthResolver(options: {
  account: Pick<NewApiAccountService, "isCurrent" | "getRelayCredential">;
  accountSource: ProviderSource<AccountProviderConfigSnapshot>;
  official: AccountRequestAuthResolver;
}): AccountRequestAuthResolver {
  const assertNative = async (input: AccountAccessIdentityInput) => {
    const access = input.accountAccess;
    if (access.type !== "new-api-account")
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    const snapshot = await options.accountSource.read();
    const providerAccess = snapshot.providers.get(input.providerId)?.access;
    if (
      !isNewApiModelProviderId(input.providerId) ||
      !access.owner ||
      !access.accountRevision ||
      !options.account.isCurrent(access.owner) ||
      !snapshot.owner ||
      !options.account.isCurrent(snapshot.owner) ||
      access.accountRevision !== snapshot.revision ||
      providerAccess?.type !== "new-api-account" ||
      providerAccess.entitled !== true ||
      snapshot.states?.[input.providerId]?.current !== true
    ) {
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    }
    return { snapshot, owner: access.owner };
  };
  return {
    resolveAccessCurrent: (access) => {
      if (access.type === "new-api-account") throw new Error("XCODE_PRIVATE_REMOTE_UNSUPPORTED");
      return options.official.resolveAccessCurrent(access);
    },
    assertCurrent: async (input) => {
      if (input.accountAccess.type === "new-api-account") {
        await assertNative(input);
        return;
      }
      await options.official.assertCurrent(input);
    },
    resolveCurrent: async (input) => {
      if (input.accountAccess.type !== "new-api-account") {
        if (input.reason === "model-request" && isBuiltinModelProviderId(input.providerId))
          throw new Error("XCODE_LEGACY_OFFICIAL_SELECTION_RESELECT_REQUIRED");
        return options.official.resolveCurrent(input);
      }
      if (input.reason !== "model-request")
        throw new Error(
          `XCODE_PRIVATE_${input.reason === "off-peak" ? "OFF_PEAK" : "USAGE_AUTH"}_UNSUPPORTED`,
        );
      const { snapshot, owner } = await assertNative(input);
      if (
        !input.modelId ||
        !snapshot.providers.get(input.providerId)?.builtinModelIds?.includes(input.modelId) ||
        snapshot.modelConfigs?.[input.providerId]?.[input.modelId]?.enabled !== true
      )
        throw new AccountRequestCredentialUnavailableError(input.providerId);
      const credential = await options.account.getRelayCredential(owner);
      // A logout/config publication can cross the await; no stale secret is released.
      await assertNative(input);
      return { apiKey: credential.token };
    },
  };
}
