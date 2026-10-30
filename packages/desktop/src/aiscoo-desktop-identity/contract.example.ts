import { buildAiscooDesktopStorageEnv } from "./index.js";

export function exampleAiscooDesktopRuntime(dataBaseDir: string): Record<string, string> {
  return buildAiscooDesktopStorageEnv(dataBaseDir, {});
}
