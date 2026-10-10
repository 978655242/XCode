import type { ZCodeAccountAccess, ZCodeProviderAccountAccess } from "@zcode/shared";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { resolveUsageAccountScope } from "@/lib/usageAccountScope.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";

export function useUsageAccountScope(
  providerId?: string,
  accountAccess?: ZCodeProviderAccountAccess | ZCodeAccountAccess,
) {
  const settings = useProviderSettingsView();
  const signedIn = useZCodeStoreWithDefault((state) => state.user !== null, false);
  const authSessionSeq = useZCodeStoreWithDefault((state) => state.authSessionSeq, 0);
  return resolveUsageAccountScope({
    providerId,
    accountAccess,
    view: settings.state.status === "ready" ? settings.state.view : null,
    signedIn,
    authSessionSeq,
  });
}
