import { Root } from "@/Root.js";
import type { RootProps } from "@/root/types.js";
import { restoreDraftContext } from "./restoreDraftContext.js";

export function XWorkRoot(props: RootProps) {
  return <Root {...props} restoreDraftContext={restoreDraftContext} />;
}
