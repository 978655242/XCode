import type { OffPeakOwnerFence } from "@zcode/services/node";

let nativeOwnerKeys: readonly string[] | undefined = process.env.NEW_API_BASE_URL?.trim()
  ? []
  : undefined;
let nativeAdmissionGeneration = 0;
const nativeOwnerEpochs = new Map<string, number>();

export function requiresOffPeakOwnerAdmission(): boolean {
  return nativeOwnerKeys !== undefined;
}

export function updateOffPeakOwnerAdmission(ownerKeys: readonly string[] | undefined): void {
  if (nativeOwnerKeys !== undefined && ownerKeys !== undefined) {
    const nextKeys = [...new Set(ownerKeys)];
    for (const key of new Set([...nativeOwnerKeys, ...nextKeys])) {
      if (nativeOwnerKeys.includes(key) !== nextKeys.includes(key)) {
        nativeOwnerEpochs.set(key, (nativeOwnerEpochs.get(key) ?? 0) + 1);
      }
    }
    nativeOwnerKeys = nextKeys;
    nativeAdmissionGeneration++;
  }
}

export function captureOffPeakOwnerFence(ownerKey?: string | null): OffPeakOwnerFence {
  const generation = nativeAdmissionGeneration;
  const ownerEpoch = ownerKey ? nativeOwnerEpochs.get(ownerKey) : undefined;
  const assertCurrentSync = (): void => {
    const current = ownerKey
      ? nativeOwnerKeys?.includes(ownerKey) && nativeOwnerEpochs.get(ownerKey) === ownerEpoch
      : generation === nativeAdmissionGeneration;
    if (!current || (nativeOwnerKeys !== undefined && ownerKey === null)) {
      throw new Error("off-peak owner admission changed");
    }
  };
  return Object.assign(async () => assertCurrentSync(), {
    assertCurrentSync,
    ...(ownerKey ? { ownerKey } : { ownerKeys: nativeOwnerKeys }),
  });
}
