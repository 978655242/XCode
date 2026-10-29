import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runServerCli } from "../src/cli.js";
import { resolveServerLayout } from "../src/runtime/paths.js";
import { writeStableLauncher } from "../src/runtime/stableLauncher.js";
import { createDaemonServiceDescriptor } from "../src/platform/serviceManager.js";
import { ensureServerInstallOwnership } from "../src/runtime/installationOwnership.js";
import { runProxyStdio } from "../src/server-core/proxyStdio.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function layout() {
  const root = await mkdtemp(join(tmpdir(), "aiscoo-server-brand-"));
  roots.push(root);
  return resolveServerLayout(join(root, "server"));
}

describe("Aiscoo Server CLI display", () => {
  it("keeps status and version machine identity intact", async () => {
    const paths = await layout();
    let output = "";
    const io = {
      stdout: {
        write: (value: string) => {
          output += value;
        },
      },
    };
    expect(await runServerCli(["status", "--server-root", paths.serverRoot], io)).toBe(0);
    expect(JSON.parse(output).state).toBe("stopped");
    output = "";
    expect(await runServerCli(["--version", "--json"], io)).toBe(0);
    expect(JSON.parse(output).product).toBe("zcode-server");
  });

  it("brands generated service descriptions and launcher errors, preserving service names and commands", async () => {
    const paths = await layout();
    const descriptor = createDaemonServiceDescriptor({ platform: "linux", layout: paths });
    expect(descriptor.content).toContain("Description=Aiscoo Server");
    expect(descriptor.name).toMatch(/^com\.zhipu\.zcode\.server\./);
    expect(descriptor.content).toContain("/bin/zcode'");
    for (const platform of ["linux", "win32"] as const) {
      const launcherPath = await writeStableLauncher(paths, platform);
      expect(launcherPath).toBe(
        join(paths.stableBinDir, platform === "win32" ? "zcode.cmd" : "zcode"),
      );
      const launcher = await readFile(launcherPath, "utf8");
      expect(launcher).toContain("No current Aiscoo Server release");
      expect(launcher).toContain("Invalid current Aiscoo Server release");
      expect(launcher).toContain("server-cli.js");
    }
    expect((await ensureServerInstallOwnership(paths)).product).toBe("zcode-server");
  });

  it("brands proxy diagnostics without writing into the protocol byte stream", async () => {
    const paths = await layout();
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    await expect(runProxyStdio({ layout: paths, input, output })).rejects.toMatchObject({
      code: "daemon-not-ready",
      message: "Aiscoo Server daemon is not ready for proxy-stdio",
    });
    expect(chunks).toEqual([]);
  });
});
