import { updateWorkspaceState, useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import type { RestoredDraftContext } from "./contract.js";

export function restoreDraftContext(context: RestoredDraftContext): void {
  useZCodeSessionStore.setState((state) => {
    const next = updateWorkspaceState(
      state,
      context.workspacePath,
      (current) => {
        // 启动水合不能伪造 New Task 意图，也不能覆盖用户已选择或初始化的上下文。
        if (
          current.activeTaskId !== null ||
          current.draftFocusVersion > 0 ||
          current.draftProjectId !== undefined
        )
          return current;
        return {
          ...current,
          draftProjectId: context.projectId,
          draftTaskGroupId: context.taskGroupId,
          draftRuntimeInvalidationVersion: current.draftRuntimeInvalidationVersion + 1,
        };
      },
      context.workspaceIdentity,
    );
    return next.workspaces === state.workspaces ? state : next;
  });
}
