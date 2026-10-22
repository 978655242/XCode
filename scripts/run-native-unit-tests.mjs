import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { globSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL("..", import.meta.url));
const newApiTests = globSync("packages/services/test/newApi*.test.ts", { cwd }).sort();
assert.ok(newApiTests.length > 0, "Native account regressions are missing");
const root = await mkdtemp(join(tmpdir(), "xwork-native-unit-"));
try {
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(resolve(cwd, "scripts/test/native-unit-test-setup.mjs")).href,
      require.resolve("tsx/cli"),
      "--experimental-test-module-mocks",
      "--tsconfig",
      "packages/services/test/tsconfig.json",
      "--test",
      ...newApiTests,
      "packages/services/test/officialCloudOwner.test.ts",
      "packages/services/test/offPeakExecutionLifetime.test.ts",
      "packages/services/test/conversationShareOperationFence.test.ts",
      "packages/services/test/officialInvocationDispatch.test.ts",
      "packages/desktop/test/newApiOAuthRoutes.test.ts",
      "packages/desktop/test/desktopLocalDevelopmentBundle.test.ts",
      "packages/desktop/scripts/devElectronAppArgs.test.mjs",
      "scripts/test/unit-test-isolation.test.mjs",
      "scripts/test/architecture-policy-xwork.test.mjs",
    ],
    {
      cwd,
      stdio: "inherit",
      // XCODE: 数据与备份归 runner；保留系统 TMPDIR，避免 macOS 的 tsx socket 路径超限。
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        ZCODE_DATA_BASE_DIR: root,
      },
    },
  );
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
