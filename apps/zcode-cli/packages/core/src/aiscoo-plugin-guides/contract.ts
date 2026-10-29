import type { AgentRuntime } from "../runtime.js";
import type {
  WorkspaceGenerateTextInput,
  WorkspaceGenerateTextResult,
} from "../runtime/methods/workspace-generate-text.js";

export interface WorkspaceModelTextStreamOptions {
  abortSignal?: AbortSignal;
  onDelta: (text: string) => void | Promise<void>;
}
export type WorkspaceModelTextStream = (
  runtime: AgentRuntime,
  input: WorkspaceGenerateTextInput,
  options: WorkspaceModelTextStreamOptions,
) => Promise<WorkspaceGenerateTextResult>;
