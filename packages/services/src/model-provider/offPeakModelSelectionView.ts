import {
  projectModelSelectionProviderView,
  type ModelSelectionView,
  type ProviderRegistryView,
} from "@zcode/provider";
import { OFF_PEAK_PROVIDER_IDS, type OfficialCloudFamily } from "@zcode/shared";

/** Non-private hosts retain their original official Registry projection. */
export function buildOffPeakModelSelectionView(registry: ProviderRegistryView): ModelSelectionView {
  const providers = registry.providers.filter(
    (candidate) =>
      (candidate.providerId === OFF_PEAK_PROVIDER_IDS.zai ||
        candidate.providerId === OFF_PEAK_PROVIDER_IDS.bigmodel) &&
      candidate.config.visibility === "hidden",
  );
  return Object.freeze({
    revision: registry.revision,
    providers: Object.freeze(providers.map(projectModelSelectionProviderView)),
  });
}

/** Only an independently loaded original official view may enter the cloud task selector. */
export function buildOfficialOffPeakModelSelectionView(
  officialView: ModelSelectionView,
  family: OfficialCloudFamily,
): ModelSelectionView {
  const providerId = OFF_PEAK_PROVIDER_IDS[family];
  return Object.freeze({
    revision: officialView.revision,
    providers: Object.freeze(
      officialView.providers.filter((candidate) => {
        const access = candidate.config.access;
        return (
          candidate.providerId === providerId &&
          candidate.config.visibility === "hidden" &&
          access?.type === "zhipu-account" &&
          access.accountType === family &&
          access.entitled
        );
      }),
    ),
  });
}
