import type { ComponentProps } from "react";
import type { IPluginGuideService } from "@zcode/services/xwork-plugin-guides";
import type { PluginGuideSnapshot } from "@zcode/shared/xwork-plugin-guides";
import type { ModelSelection } from "@zcode/shared";
import type { PluginStoreDetailView } from "@/settings/PluginStoreDetailView.js";

export type { IPluginGuideService };
export type { ModelSelectionView } from "@zcode/services";

export type XWorkPluginStoreDetailViewProps = ComponentProps<typeof PluginStoreDetailView> & {
  workspacePath?: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  /** Explicit null means this target Host does not expose guides; never use another Host. */
  guideService?: IPluginGuideService | null;
};
export interface PluginGuideProjection {
  snapshot: PluginGuideSnapshot | null;
  loading: boolean;
  error: string | null;
  generate(question?: string, regenerate?: boolean, selection?: ModelSelection): Promise<boolean>;
  stop(): Promise<void>;
  retrySave(): Promise<void>;
  retryRead(): Promise<void>;
}
