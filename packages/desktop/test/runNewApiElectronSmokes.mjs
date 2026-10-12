import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const requireServices = createRequire(new URL("../../services/package.json", import.meta.url));
const { build } = requireServices("esbuild");
const requireDesktop = createRequire(new URL("../package.json", import.meta.url));
const electron = requireDesktop("electron");
const temporary = await mkdtemp(join(tmpdir(), "xwork-native-electron-tests-"));
try {
  for (const name of [
    "newApiComposerContextElectron",
    "newApiPeriodDetailsElectron",
    "newApiWebHandoffElectron",
    "newApiUpgradePresentationElectron",
    "newApiModelSettingsElectron",
  ]) {
    const entry = new URL(`./${name}.mjs`, import.meta.url);
    const output = join(temporary, `${name}.mjs`);
    await build({
      entryPoints: [fileURLToPath(entry)],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      external: ["electron", requireServices.resolve("esbuild"), "ssh2", "cpu-features"],
      alias: { esbuild: requireServices.resolve("esbuild") },
      define: {
        "import.meta.url": JSON.stringify(entry.href),
        "import.meta.dirname": JSON.stringify(fileURLToPath(new URL("../out/main/", entry))),
      },
      banner: {
        js: `import { createRequire as smokeCreateRequire } from "node:module"; const require = smokeCreateRequire(${JSON.stringify(new URL("../package.json", import.meta.url).href)});`,
      },
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [output], {
      env,
      stdio: "inherit",
      timeout:
        name === "newApiUpgradePresentationElectron"
          ? process.env.XCODE_UPGRADE_SMOKE_SEED
            ? 260_000
            : 200_000
          : 60_000,
    });
    assert.equal(
      result.status,
      0,
      `${name}: ${result.error?.message ?? result.signal ?? "regression failed"}`,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
