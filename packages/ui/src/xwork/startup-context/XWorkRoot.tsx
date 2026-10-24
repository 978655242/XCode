import type { ComponentType } from "react";
import type { RootProps } from "@/root/types.js";
import { restoreDraftContext } from "./restoreDraftContext.js";

export function createXWorkRoot(Root: ComponentType<RootProps>) {
  return function XWorkRoot(props: RootProps) {
    return <Root {...props} restoreDraftContext={restoreDraftContext} />;
  };
}
