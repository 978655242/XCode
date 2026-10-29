import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("Aiscoo keychain smoke skipped: requires macOS safeStorage");
  process.exit(0);
}

const require = createRequire(new URL("../package.json", import.meta.url));
const electron = require("electron");
const temporary = await mkdtemp(join(tmpdir(), "aiscoo-keychain-smoke-"));
const fixture = fileURLToPath(new URL("./aiscooKeychainElectron.mjs", import.meta.url));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

try {
  for (const flavor of ["development", "production", "preview"]) {
    for (const mode of ["seed", "renamed", "compatible"]) {
      await new Promise((resolve, reject) => {
        const child = spawn(electron, [fixture, mode, flavor, temporary], {
          env,
          stdio: "inherit",
        });
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Keychain smoke timed out: ${flavor}/${mode}`));
        }, 15_000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code, signal) => {
          clearTimeout(timer);
          try {
            assert.equal(code, 0, `${flavor}/${mode} exited with ${signal ?? code}`);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
