import type { ApiClient, SelfServiceReadResult } from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import type { ICodingPlanSubscriptionService } from "./codingPlanSubscription.js";
import { BigModelCodingPlanSubscriptionProvider } from "./bigmodelCodingPlanSubscriptionProvider.js";
import type { ModelSelectionView } from "@zcode/provider";
import { ZaiCodingPlanSubscriptionProvider } from "./zaiCodingPlanSubscriptionProvider.js";
import {
  createNewApiSubscriptionReadAdapter,
  rejectNewApiSelfService,
  type NewApiSubscriptionDependencies,
} from "../new-api/newApiSubscriptionReadAdapter.js";
import type { OfficialCloudConnectionHost } from "../official-mcp/officialCloudConnectionService.js";

export interface CodingPlanSubscriptionServiceDependencies {
  apiClient: ApiClient;
  credentialService: Pick<ICredentialService, "load">;
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
  native?: NewApiSubscriptionDependencies;
  officialCloudHost?: Pick<
    OfficialCloudConnectionHost,
    "withCredentials" | "getModelSelectionView"
  >;
}

export function createCodingPlanSubscriptionService(
  dependencies: CodingPlanSubscriptionServiceDependencies,
): ICodingPlanSubscriptionService {
  const bigmodel = new BigModelCodingPlanSubscriptionProvider(dependencies);
  const zai = new ZaiCodingPlanSubscriptionProvider(dependencies);
  const native = dependencies.native && createNewApiSubscriptionReadAdapter(dependencies.native);
  const available = async <T>(operation: () => Promise<T>): Promise<SelfServiceReadResult<T>> =>
    native
      ? dependencies.native!.account.withControlSession(
          async (): Promise<SelfServiceReadResult<T>> => ({
            availability: "not-supported",
            reason: "manual_admin",
            data: null,
          }),
        )
      : { availability: "available", data: await operation() };
  const officialFeature = async <T>(
    operation: (provider: BigModelCodingPlanSubscriptionProvider) => Promise<T>,
  ): Promise<T> => {
    const host = dependencies.officialCloudHost;
    if (!host) {
      if (native) throw new Error("official_cloud_connection_required");
      return operation(bigmodel);
    }
    return host.withCredentials(async (credentials) =>
      operation(
        new BigModelCodingPlanSubscriptionProvider({
          apiClient: dependencies.apiClient,
          credentialService: {
            load: async (key) =>
              key === "zcodejwttoken"
                ? credentials.jwt
                : key === `oauth:${credentials.family}:access_token`
                  ? credentials.accessToken
                  : key === "oauth:active_provider"
                    ? credentials.family
                    : null,
          },
          resolveOffPeakModelSelectionView: () => host.getModelSelectionView(),
        }),
      ),
    );
  };
  return {
    batchPreview: (request) => (native ? native.read() : bigmodel.batchPreview(request)),
    getStaticProducts: () => (native ? native.read() : bigmodel.getStaticProducts()),
    getStaticTeamProducts: () => (native ? native.read() : bigmodel.getStaticTeamProducts()),
    getStartPlanPreview: () => (native ? native.read() : bigmodel.getStartPlanPreview()),
    createPlanWebHandoff: () =>
      native
        ? native.createPlanWebHandoff()
        : Promise.reject(new Error("XCODE_NATIVE_ACCOUNT_REQUIRED")),
    getOffPeakClientConfig: (options) =>
      officialFeature((provider) => provider.getOffPeakClientConfig(options)),
    getDynamicWorkflowClientConfig: (options) =>
      officialFeature((provider) => provider.getDynamicWorkflowClientConfig(options)),
    getModelContextBudgetStrategy: () => bigmodel.getModelContextBudgetStrategy(),
    getForceUpdateConfig: () => bigmodel.getForceUpdateConfig(),
    productInfo: (request) => (native ? native.read() : bigmodel.productInfo(request)),
    preview: (request) => (native ? native.read() : bigmodel.preview(request)),
    createSign: (request) => (native ? rejectNewApiSelfService() : bigmodel.createSign(request)),
    updateSign: (request) => (native ? rejectNewApiSelfService() : bigmodel.updateSign(request)),
    checkPayment: (request) => available(() => bigmodel.checkPayment(request)),
    checkPendingOrders: (request) => available(() => bigmodel.checkPendingOrders(request)),
    queryStripeCards: (request) => available(() => bigmodel.queryStripeCards(request)),
    bindStripeCard: (request) =>
      native ? rejectNewApiSelfService() : bigmodel.bindStripeCard(request),
    unbindStripeCard: (request) =>
      native ? rejectNewApiSelfService() : bigmodel.unbindStripeCard(request),
    payStripe: (request) => (native ? rejectNewApiSelfService() : bigmodel.payStripe(request)),
    checkPaypalSupport: (request) => available(() => bigmodel.checkPaypalSupport(request)),
    createPaypalSetupToken: (request) =>
      native ? rejectNewApiSelfService() : bigmodel.createPaypalSetupToken(request),
    subscribePaypal: (request) =>
      native ? rejectNewApiSelfService() : bigmodel.subscribePaypal(request),
    getEnterprisePricing: (request) =>
      native
        ? native.read()
        : (request?.family === "zai" ? zai : bigmodel).getEnterprisePricing(request),
    getEnterpriseBalance: () => (native ? native.read() : bigmodel.getEnterpriseBalance()),
    calculateEnterpriseOrder: (request) =>
      native ? rejectNewApiSelfService() : bigmodel.calculateEnterpriseOrder(request),
    createEnterpriseOrder: (request) =>
      native ? rejectNewApiSelfService() : bigmodel.createEnterpriseOrder(request),
    getEnterprisePendingOrders: () => available(() => bigmodel.getEnterprisePendingOrders()),
    cancelEnterpriseOrder: (request) =>
      native ? rejectNewApiSelfService() : bigmodel.cancelEnterpriseOrder(request),
    continueEnterpriseOrderPayment: (request) =>
      native ? rejectNewApiSelfService() : bigmodel.continueEnterpriseOrderPayment(request),
    checkEnterpriseOrderStatus: (request) =>
      available(() => bigmodel.checkEnterpriseOrderStatus(request)),
  };
}
