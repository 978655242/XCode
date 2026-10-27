import { useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { PluginStoreDetailView } from "@/settings/PluginStoreDetailView.js";
import { resolveItemDisplayName } from "@/settings/pluginStoreListing.js";
import { PluginGuideReader } from "./PluginGuideReader.js";
import type { XWorkPluginStoreDetailViewProps } from "./contract.js";

export function XWorkPluginStoreDetailView({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  guideService,
  ...detail
}: XWorkPluginStoreDetailViewProps) {
  const { intl, locale } = useZCodeIntl();
  const services = useOptionalServices();
  const [openTarget, setOpenTarget] = useState<string | null>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const targetIdentity = JSON.stringify([
    workspaceIdentity?.trim() || workspacePath,
    remoteSessionId,
    detail.item.id,
    locale,
  ]);
  const open = openTarget === targetIdentity;
  const service = guideService === undefined ? services?.pluginGuideService : guideService;
  const version =
    detail.item.info?.version ??
    detail.item.installedMeta?.version ??
    detail.item.summary?.version ??
    (detail.describeEntry?.status === "loaded"
      ? detail.describeEntry.data?.metadata?.version
      : undefined);
  return (
    <>
      <div hidden={open}>
        <PluginStoreDetailView
          {...detail}
          headerActions={
            <>
              {detail.headerActions}
              <Button
                ref={entry}
                type="button"
                variant="outline"
                size="lg"
                data-testid="plugin-guide-open"
                onClick={() => setOpenTarget(targetIdentity)}
              >
                <BookOpen className="size-3.5" aria-hidden="true" />
                {intl.formatMessage({ id: "settings.plugins.guide.open" })}
              </Button>
            </>
          }
        />
      </div>
      {open ? (
        <PluginGuideReader
          key={targetIdentity}
          service={service}
          target={
            workspacePath
              ? {
                  workspacePath,
                  ...(workspaceIdentity?.trim()
                    ? { workspaceIdentity: workspaceIdentity.trim() }
                    : {}),
                  ...(remoteSessionId ? { remoteSessionId } : {}),
                  pluginName: detail.item.name,
                  marketplace: detail.item.marketplace,
                  locale,
                  ...(version ? { version } : {}),
                }
              : null
          }
          displayName={resolveItemDisplayName(detail.item, locale)}
          onBack={() => {
            setOpenTarget(null);
            requestAnimationFrame(() => entry.current?.focus());
          }}
        />
      ) : null}
    </>
  );
}
