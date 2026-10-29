import { join } from "node:path";
import { getAppConfigDir } from "../paths.js";
import type { PluginGuideAgentPort, PluginGuideServiceDependencies } from "./contract.js";
import { createPluginGuideService } from "./app/service.js";
import { createPluginGuideFileRepository } from "./adapters/repository.js";
export { createPluginGuideAgentExtension } from "./adapters/agent.js";
export function createNodePluginGuideService(input: {
  agent: PluginGuideAgentPort;
  readModelSelectionView: PluginGuideServiceDependencies["readModelSelectionView"];
  storageDirectory?: string;
}) {
  return createPluginGuideService({
    repository: createPluginGuideFileRepository(
      input.storageDirectory ?? join(getAppConfigDir(), "plugin-guides"),
    ),
    readSource: (target, mode, signal) =>
      input.agent.readPluginGuideSource({ ...target, mode, signal }),
    readModelSelectionView: input.readModelSelectionView,
    streamText: (params) => input.agent.streamWorkspaceModelText(params),
  });
}
