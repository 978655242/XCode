import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectSeaKeyringAssets,
  seaKeyringManifestAssetKey,
} from "../scripts/sea-keyring-assets.mjs";
import { hostTarget } from "../scripts/sea-targets.mjs";
import { loadCliKeyringModule } from "../src/sea-keyring/contract.js";

(globalThis as { __CLI_VERSION__?: string }).__CLI_VERSION__ = "test";

async function fakeSea(tamper = false) {
  const staging = await mkdtemp(join(tmpdir(), "zcode-sea-keyring-stage-"));
  const { assets } = await collectSeaKeyringAssets({
    root: join(import.meta.dirname, "../../.."),
    stagingDirectory: staging,
    target: hostTarget(),
  });
  const bytes = new Map<string, Buffer>();
  for (const [key, path] of Object.entries(assets)) bytes.set(key, await readFile(path as string));
  return {
    staging,
    sea: {
      isSea: () => true,
      getAsset: (key: string) => bytes.get(key)!.toString("utf8"),
      getRawAsset: (key: string) => {
        const value = Buffer.from(bytes.get(key)!);
        if (tamper && key.endsWith(".node")) value[0] ^= 0xff;
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      },
    },
    manifestKey: seaKeyringManifestAssetKey,
  };
}

// SEA 下必须从内嵌资源加载真实原生绑定，而不是依赖仓库 node_modules。
test("loads the real native keychain binding from SEA assets", async () => {
  const { staging, sea } = await fakeSea();
  const cacheBase = await mkdtemp(join(tmpdir(), "zcode-sea-keyring-cache-"));
  try {
    const keyring = await loadCliKeyringModule({ sea, cacheBase });
    assert.equal(typeof keyring.AsyncEntry, "function");
    const again = await loadCliKeyringModule({ sea, cacheBase });
    assert.equal(again.AsyncEntry, keyring.AsyncEntry, "second load reuses the extracted cache");
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(cacheBase, { recursive: true, force: true });
  }
});

test("rejects tampered SEA keychain assets without leaving a partial cache", async () => {
  const { staging, sea } = await fakeSea(true);
  const cacheBase = await mkdtemp(join(tmpdir(), "zcode-sea-keyring-cache-"));
  try {
    await assert.rejects(loadCliKeyringModule({ sea, cacheBase }), /hash mismatch/);
    const { readdir } = await import("node:fs/promises");
    const leftovers = await readdir(join(cacheBase, "test", hostTarget())).catch(() => []);
    assert.deepEqual(leftovers, [], "no temporary or partial runtime directory remains");
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(cacheBase, { recursive: true, force: true });
  }
});

test("uses the normal module outside SEA", async () => {
  let imported = false;
  await loadCliKeyringModule({
    sea: { isSea: () => false, getAsset: () => "", getRawAsset: () => new ArrayBuffer(0) },
    importModule: async () => {
      imported = true;
      return {} as never;
    },
  });
  assert.equal(imported, true);
});
