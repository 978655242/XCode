/*
 * ZCode 官方 Server MCP 的凭证解析与身份头构造。
 *
 * 本文件与 Off-Peak 的 offPeakRuntimeModel.ts **逻辑等价但完全独立**：
 * 不复用其函数、不修改其行为。理由是两者的套餐门槛、Team 支持范围与凭证通道预期会独立演进，
 * 共享 helper 会让任一侧的调整都变成需要评估双方影响的改动。
 *
 * 与 Off-Peak 的三处有意差异：
 *   1. 显式产出 Bigmodel-Target-Type（Off-Peak 侧当前没有生产者）；
 *   2. 不存在任何 mock 凭证分支（官方 MCP 无 mock 网关，测试用依赖注入替换来源）；
 *   3. 失败原因使用 official_* 分类，不复用 Off-Peak 的 reason 字符串。
 *
 * 凭证通道：Coding Plan 凭证走 `X-Bigmodel-Authorization` + MaaS 登录 JWT，
 * 不再发送 `X-Coding-Plan-Api-Key`。服务端把 API key 通道标为"仅存量客户端兼容"，且两个头同时
 * 发送是有害的——JWT 会赢得额度查询，但 API key 的归属校验仍会照跑，一把过期 key 就能让整个
 * 请求 403。Off-Peak 仍走 API key 通道，这也是上面"逻辑等价但完全独立"的又一个理由。
 */
import {
  OFFICIAL_MCP_AUTH_HEADER_NAMES,
  getModelProviderFamilySpec,
  type OfficialMcpAuthFailureReason,
  type ZCodeAccountAccess,
  type ZCodeProviderAccountAccess,
} from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/provider";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import {
  officialCloudInvocationScope,
  type OfficialCloudConnectionHost,
} from "./officialCloudConnectionService.js";
import { resolveSelectedPlan, resolveSelectedProvider } from "./officialMcpPlanSelection.js";

const log = createServiceLogger("official-mcp");

const ZCODE_JWT_TOKEN_KEY = "zcodejwttoken";
const ACTIVE_OAUTH_PROVIDER_KEY = "oauth:active_provider";

/**
 * MaaS 登录 JWT 的凭证键（`oauth:<provider>:access_token`，见 oauth/repo/oauthCredentialRepo.ts）。
 *
 * 必须按 provider family 精确选择、**禁止跨 family 回退**：拿 ZAI 的业务 JWT 去打 BigModel 的
 * Coding Plan 只会得到一次注定失败的请求，而且失败原因会指向"没有套餐"这种误导结论。
 * 这几行与 bigmodelUsageQuotaProvider 的 reset 通道逻辑等价但独立（见文件头说明）。
 */
function maasJwtCredentialKey(providerFamily: "zai" | "bigmodel"): string {
  return `oauth:${getModelProviderFamilySpec(providerFamily).oauthProviderId}:access_token`;
}

/**
 * 只为日志算出 JWT 的剩余有效期（秒）。**不参与任何控制流**，解析失败返回 undefined。
 *
 * 存在理由：MaaS JWT 没有刷新链路，过期后服务端的表现是 queryCodingPlan 上游 401，
 * 客户端却收到"需要 Coding Plan"这类文案——真实原因与提示不符。有了这个数值，
 * "神秘的 403"能一眼看出是"token 早就过期了"。只记数字，绝不记 token 本身。
 */
function readJwtExpiresInSeconds(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const decoded: unknown = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null) return undefined;
    const exp = (decoded as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return undefined;
    return Math.round(exp - Date.now() / 1000);
  } catch {
    return undefined;
  }
}

/** 凭证解析 info 日志的有效期分桶粒度（秒）；桶内不重复记录，见 createCredentialResolvedLogKey。 */
const CREDENTIAL_RESOLVED_LOG_BUCKET_SECONDS = 3600;

/**
 * 凭证解析成功日志的去重键（导出仅为可单测，无其他消费方）。
 *
 * 生产日志保留 JWT 有效期分桶，帮助区分凭据过期与套餐不可用，不记录凭据原文。
 * resolver 只合并正在执行的请求，没有时间缓存；因此按小时分桶去重，避免每次
 * MCP 调用都产生 info 日志。凭据有效期跨桶、进入 expired 或切换套餐类型时重新记录。
 */
export function createCredentialResolvedLogKey(input: {
  providerFamily: "zai" | "bigmodel";
  planTargetType: string | null;
  maasJwtExpiresInSeconds: number | undefined;
}): string {
  const expires = input.maasJwtExpiresInSeconds;
  const expiryBucket =
    expires === undefined
      ? "unparsable"
      : expires <= 0
        ? "expired"
        : `t${Math.floor(expires / CREDENTIAL_RESOLVED_LOG_BUCKET_SECONDS)}`;
  return `${input.providerFamily}|${input.planTargetType ?? "none"}|${expiryBucket}`;
}

let lastCredentialResolvedLogKey: string | undefined;

export interface OfficialMcpCredentialResolverDeps {
  accountRequestAuthService: {
    resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null>;
  };
  credentialService: { load(key: string): Promise<string | null | undefined> };
  modelSelectionService: {
    getView(): Promise<ModelSelectionView>;
  };
}

type OfficialMcpCredentialInput =
  | OfficialMcpCredentialResolverDeps
  | {
      officialCloudHost: Pick<
        OfficialCloudConnectionHost,
        "resolveCredentials" | "isCurrent" | "captureOwnerFence" | "captureRequestFence"
      >;
    };

export type OfficialMcpPlanScope =
  | { targetType: "PERSONAL" }
  | { targetType: "TEAM"; organizationId: string; projectId: string };

export type OfficialMcpWireScope = OfficialMcpPlanScope | null;

/** 解析成功后的凭证快照。仅在 host/service 进程内存活，脱敏后才允许过 RPC。 */
export interface OfficialMcpCredentialSnapshot {
  jwt: string;
  /**
   * MaaS 登录 JWT（`oauth:<family>:access_token` 的原文，**不带 Bearer 前缀**）。
   * 前缀在 buildOfficialMcpAuthHeaders 里加，与 reset / usage 通道的既有约定一致。
   */
  codingPlanAuthorization?: string;
  providerFamily: "zai" | "bigmodel";
  /** 当前选中连接的产品/额度归属；畸形旧 Team key 无法精确归属时为 null。 */
  planScope: OfficialMcpPlanScope | null;
  /** 实际发往 Server MCP 的身份头 scope；ZAI Team 与 Off-Peak 一致为 null。 */
  wireScope: OfficialMcpWireScope;
  /** XCODE: 仅非秘密代际摘要可经 worker 协议传递。 */
  invocationScope?: string;
}

export type OfficialMcpCredentialOutcome =
  | { ok: true; snapshot: OfficialMcpCredentialSnapshot }
  | { ok: false; reason: OfficialMcpAuthFailureReason };

function fail(reason: OfficialMcpAuthFailureReason): {
  ok: false;
  reason: OfficialMcpAuthFailureReason;
} {
  return { ok: false, reason };
}

/** 非秘密的选择指纹，用于解析前后比对，防止把切换前后的两代凭证拼进同一请求。 */
function createSelectionFingerprint(registry: ModelSelectionView): string {
  return JSON.stringify({ revision: registry.revision, providers: registry.providers });
}

type OfficialMcpIdentitySnapshot = {
  activeProvider: "zai" | "bigmodel";
  jwt: string;
  registry: ModelSelectionView;
  selectionFingerprint: string;
};

async function readIdentitySnapshot(
  deps: OfficialMcpCredentialResolverDeps,
): Promise<
  | { ok: true; snapshot: OfficialMcpIdentitySnapshot }
  | { ok: false; reason: OfficialMcpAuthFailureReason }
> {
  const [registry, activeProviderValue, jwtValue] = await Promise.all([
    deps.modelSelectionService.getView(),
    deps.credentialService.load(ACTIVE_OAUTH_PROVIDER_KEY),
    deps.credentialService.load(ZCODE_JWT_TOKEN_KEY),
  ]);
  const activeProvider = activeProviderValue?.trim();
  const jwt = jwtValue?.trim() ?? "";
  if ((activeProvider !== "zai" && activeProvider !== "bigmodel") || !jwt) {
    return fail("official_auth_unavailable");
  }
  return {
    ok: true,
    snapshot: {
      activeProvider,
      jwt,
      registry,
      selectionFingerprint: createSelectionFingerprint(registry),
    },
  };
}

function isSameIdentitySnapshot(
  before: OfficialMcpIdentitySnapshot,
  after: OfficialMcpIdentitySnapshot,
): boolean {
  return (
    before.activeProvider === after.activeProvider &&
    before.jwt === after.jwt &&
    before.selectionFingerprint === after.selectionFingerprint
  );
}

function identityOnlyOutcome(identity: OfficialMcpIdentitySnapshot): OfficialMcpCredentialOutcome {
  log.debug("official mcp identity-only credentials resolved", {
    providerFamily: identity.activeProvider,
    reason: "official_auth_plan_required",
  });
  return {
    ok: true,
    snapshot: {
      jwt: identity.jwt,
      planScope: null,
      providerFamily: identity.activeProvider,
      wireScope: null,
    },
  };
}

/**
 * 解析当前选中连接的官方 MCP 凭证。
 *
 * 防竞态：Registry、动态 Account Access、active provider、zcode JWT 与 MaaS JWT
 * 都可能在解析期间变化。这里在前后各取一次并比对，任一不一致就整轮
 * 重来，绝不拼接两代凭证——既包括"zcode JWT 来自 ZAI 而 MaaS JWT 来自 BigModel"（跨 family 混搭），
 * 也包括"旧 JWT + 新 JWT"（同 family 的 token 轮换）。两轮仍不稳定则按不可用返回。
 */
export async function resolveOfficialMcpCredentials(
  deps: OfficialMcpCredentialInput,
): Promise<OfficialMcpCredentialOutcome> {
  if ("officialCloudHost" in deps) {
    // Explicit Native mode has no legacy/global fallback, including when locked or disconnected.
    for (let attempt = 0; attempt < 2; attempt++) {
      const credentials = await deps.officialCloudHost.resolveCredentials();
      if (!credentials) return fail("official_auth_unavailable");
      const access = credentials.access;
      const planScope: OfficialMcpPlanScope | null =
        access?.planKind === "team-coding-plan"
          ? {
              targetType: "TEAM",
              organizationId: access.organizationId,
              projectId: access.projectId,
            }
          : access?.planKind === "individual-coding-plan"
            ? { targetType: "PERSONAL" }
            : null;
      if (!(await deps.officialCloudHost.isCurrent(credentials))) continue;
      return {
        ok: true,
        snapshot: {
          jwt: credentials.jwt,
          ...(planScope ? { codingPlanAuthorization: credentials.accessToken } : {}),
          invocationScope: officialCloudInvocationScope(credentials),
          providerFamily: credentials.family,
          planScope,
          wireScope:
            credentials.family === "zai" && planScope?.targetType === "TEAM" ? null : planScope,
        },
      };
    }
    return fail("official_auth_unavailable");
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const identity = await readIdentitySnapshot(deps);
    if (!identity.ok) {
      if (attempt === 0) continue;
      return identity;
    }
    const selectedProvider = resolveSelectedProvider(identity.snapshot.registry);
    if (!selectedProvider.ok) {
      const latestIdentity = await readIdentitySnapshot(deps);
      if (
        !latestIdentity.ok ||
        !isSameIdentitySnapshot(identity.snapshot, latestIdentity.snapshot)
      ) {
        continue;
      }
      return identityOnlyOutcome(identity.snapshot);
    }
    const accountAccess = await deps.accountRequestAuthService.resolveAccessCurrent(
      selectedProvider.provider.access,
    );
    const selected = resolveSelectedPlan(selectedProvider.provider, accountAccess);
    if (!selected.ok) return selected;

    // zcode JWT 是全局登录身份镜像；只校验 selectedKey 会把 ZAI JWT 与 BigModel key 拼到同一请求。
    if (identity.snapshot.activeProvider !== selected.plan.providerFamily) {
      return fail("official_auth_unavailable");
    }

    const maasJwtKey = maasJwtCredentialKey(selected.plan.providerFamily);
    const codingPlanAuthorization = (await deps.credentialService.load(maasJwtKey))?.trim() ?? "";
    if (!codingPlanAuthorization) {
      // 归类为 unavailable 而不是 plan_required：这是登录态不完整（需要重新登录），
      // 不是"没有套餐"。两个 provider adapter 在登录时都会硬性要求写入该 token，
      // 因此正常路径不会命中，主要出现在历史迁移过来的旧登录态上。
      log.warn("official mcp maas jwt missing", {
        providerFamily: selected.plan.providerFamily,
        reason: "official_auth_unavailable",
      });
      return fail("official_auth_unavailable");
    }

    const [latestIdentity, latestMaasJwt] = await Promise.all([
      readIdentitySnapshot(deps),
      deps.credentialService.load(maasJwtKey),
    ]);
    const latestSelectedProvider = latestIdentity.ok
      ? resolveSelectedProvider(latestIdentity.snapshot.registry)
      : latestIdentity;
    const latestAccountAccess = latestSelectedProvider.ok
      ? await deps.accountRequestAuthService.resolveAccessCurrent(
          latestSelectedProvider.provider.access,
        )
      : null;
    if (
      !latestIdentity.ok ||
      !isSameIdentitySnapshot(identity.snapshot, latestIdentity.snapshot) ||
      !latestSelectedProvider.ok ||
      JSON.stringify(accountAccess) !== JSON.stringify(latestAccountAccess) ||
      codingPlanAuthorization !== (latestMaasJwt?.trim() ?? "")
    ) {
      continue;
    }

    // provider 条目只作"该 Coding Plan 连接确实存在"的门槛。业务 key 本身不再是凭证
    // （已切到 MaaS JWT 通道），因此不再要求它有值——否则业务 key 正在刷新的瞬态
    // 会把一次本可成功的调用判成"没有套餐"。真正的"没有套餐"由上面两道门槛拦住：
    // API Key 模式与选中 Start Plan 连接，两者都不依赖业务 key。
    const provider = identity.snapshot.registry.providers.find(
      (candidate) => candidate.providerId === selected.plan.providerId,
    );
    if (!provider) return fail("official_auth_plan_required");

    // info 而非 debug：生产构建 debug 不落盘，而 MaaS JWT 剩余有效期是排障关键线索
    // （见 createCredentialResolvedLogKey 的说明）。只记剩余秒数，绝不记 token 本身。
    // 去重键跨桶才记录，避免日志量与官方 MCP 请求数同数量级。
    const maasJwtExpiresInSeconds = readJwtExpiresInSeconds(codingPlanAuthorization);
    const logKey = createCredentialResolvedLogKey({
      providerFamily: selected.plan.providerFamily,
      planTargetType: selected.plan.planScope?.targetType ?? null,
      maasJwtExpiresInSeconds,
    });
    if (logKey !== lastCredentialResolvedLogKey) {
      lastCredentialResolvedLogKey = logKey;
      log.info("official mcp credentials resolved", {
        maasJwtExpiresInSeconds,
        providerFamily: selected.plan.providerFamily,
        planTargetType: selected.plan.planScope?.targetType ?? null,
        wireTargetType: selected.plan.wireScope?.targetType ?? null,
      });
    }

    return {
      ok: true,
      snapshot: {
        codingPlanAuthorization,
        jwt: identity.snapshot.jwt,
        planScope: selected.plan.planScope,
        providerFamily: selected.plan.providerFamily,
        wireScope: selected.plan.wireScope,
      },
    };
  }

  return fail("official_auth_unavailable");
}

/**
 * 由凭证快照构造本次请求的身份头。
 * Team 身份成对原子性：organization/project 任一缺失时两者都不发送。
 */
export function buildOfficialMcpAuthHeaders(
  snapshot: OfficialMcpCredentialSnapshot,
): Record<string, string> {
  const headers: Record<string, string> = {
    [OFFICIAL_MCP_AUTH_HEADER_NAMES.authorization]: `Bearer ${snapshot.jwt}`,
  };
  if (snapshot.codingPlanAuthorization) {
    // 服务端会 CutPrefix("Bearer ")，裸 token 也接受；这里按 MCP 接口文档发 Bearer 形式。
    headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.codingPlanAuthorization] =
      `Bearer ${snapshot.codingPlanAuthorization}`;
  }
  const scope = snapshot.wireScope;
  if (scope) {
    headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.targetType] = scope.targetType;
    if (scope.targetType === "TEAM") {
      headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.organization] = scope.organizationId;
      headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.project] = scope.projectId;
    }
  }
  return headers;
}

/** XCODE: Host 请求上下文冻结一次调用的 owner/官方连接代际。 */
export interface OfficialMcpAuthHeadersRequestContext {
  mcpKey: string;
  pluginId: string;
  targetOrigin: string;
  workspace: { workspaceIdentity?: string; workspaceKey: string; workspacePath: string };
  scope?: string;
  captureOnly?: boolean;
  validateOnly?: boolean;
}

export type OfficialMcpAuthHeadersOutcome =
  | { ok: true; headers: Record<string, string>; scope?: string }
  | { ok: false; reason: OfficialMcpAuthFailureReason };

/**
 * XCODE: Native 每个请求独立核对捕获 scope，不能共享另一 owner 的 in-flight 结果。
 * 非私有宿主仍只合并并发的全局凭据解析，settle 后立即清空，不做时间缓存。
 */
export function createOfficialMcpAuthHeadersResolver(deps: OfficialMcpCredentialInput): {
  captureOwnerFence(): { isCurrent(): boolean };
  validateInvocationScope(scope: string): Promise<boolean>;
  resolveHeaders(
    request?: OfficialMcpAuthHeadersRequestContext,
  ): Promise<OfficialMcpAuthHeadersOutcome>;
} {
  let pending: Promise<OfficialMcpAuthHeadersOutcome> | null = null;

  return {
    captureOwnerFence: () =>
      "officialCloudHost" in deps
        ? deps.officialCloudHost.captureOwnerFence()
        : { isCurrent: () => true },
    async validateInvocationScope(scope) {
      if (!("officialCloudHost" in deps)) return false;
      const fence = await deps.officialCloudHost.captureRequestFence();
      return fence.scope === scope && (await fence.isCurrent());
    },
    async resolveHeaders(request?: OfficialMcpAuthHeadersRequestContext) {
      // XCODE: 每次解析都比对调用最初的非秘密 scope，不能把 B 当前有效当作 A 准入。
      if ("officialCloudHost" in deps) {
        const ownerFence = deps.officialCloudHost.captureOwnerFence();
        const outcome = await resolveOfficialMcpCredentials(deps);
        if (!ownerFence.isCurrent() || !outcome.ok) return fail("official_auth_scope_changed");
        const scope = outcome.snapshot.invocationScope;
        if (!scope || (request?.scope ? request.scope !== scope : !request?.captureOnly)) {
          return fail("official_auth_scope_changed");
        }
        return {
          ok: true,
          scope,
          headers:
            request?.captureOnly || request?.validateOnly
              ? {}
              : buildOfficialMcpAuthHeaders(outcome.snapshot),
        };
      }
      if (request?.scope) return fail("official_auth_scope_changed");
      if (request?.captureOnly || request?.validateOnly) return { ok: true, headers: {} };
      if (pending) return pending;
      const inFlight = (async (): Promise<OfficialMcpAuthHeadersOutcome> => {
        const outcome = await resolveOfficialMcpCredentials(deps);
        if (!outcome.ok) return { ok: false, reason: outcome.reason };
        return { ok: true, headers: buildOfficialMcpAuthHeaders(outcome.snapshot) };
      })();
      pending = inFlight;
      // 用双 handler 的 then 而非 finally：finally 会派生一个同样 reject 的 promise，
      // 调用方只 await 了 inFlight，那个派生 promise 无人处理会变成 unhandled rejection。
      // 解析抛错也必须清空 slot，否则后续请求会永久复用失败的 Promise。
      const clear = (): void => {
        if (pending === inFlight) pending = null;
      };
      inFlight.then(clear, clear);
      return inFlight;
    },
  };
}
