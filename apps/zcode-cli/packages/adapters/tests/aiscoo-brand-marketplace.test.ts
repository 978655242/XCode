import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDefaultPluginMarketplaces } from "../src/plugins/index.js";

describe("Aiscoo marketplace branding", () => {
  it("seeds the current product name and preserves an existing third-party marketplace", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiscoo-marketplace-brand-"));
    const file = join(root, "known_marketplaces.json");
    const thirdParty = {
      id: "custom-market",
      name: "XWork third-party marketplace",
      description: "XWork content owned by a third party",
      source: { source: "directory", path: join(root, "custom") },
      addedAt: "2026-01-01T00:00:00.000Z",
      pluginCount: 1,
    };
    try {
      await writeFile(file, JSON.stringify({ version: 1, marketplaces: [thirdParty] }));
      const marketplaces = ensureDefaultPluginMarketplaces(root);
      expect(
        marketplaces.find((marketplace) => marketplace.id === "zcode-plugins-official"),
      ).toMatchObject({
        name: "zcode-plugins-official",
        description:
          "Official Aiscoo plugins marketplace: built-in and community plugins for Aiscoo.",
      });
      expect(marketplaces.find((marketplace) => marketplace.id === thirdParty.id)).toEqual(
        thirdParty,
      );
      expect(JSON.parse(await readFile(file, "utf8")).marketplaces).toContainEqual(thirdParty);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not rewrite an existing official record", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiscoo-existing-marketplace-"));
    const file = join(root, "known_marketplaces.json");
    const original = {
      id: "zcode-plugins-official",
      name: "zcode-plugins-official",
      description: "Official XWork plugins marketplace: built-in and community plugins for XWork.",
      source: { source: "url", url: "https://example.invalid/marketplace.json" },
      addedAt: "2026-01-01T00:00:00.000Z",
      pluginCount: 4,
    };
    try {
      await writeFile(file, JSON.stringify({ version: 1, marketplaces: [original] }));
      const marketplaces = ensureDefaultPluginMarketplaces(root);
      expect(marketplaces.find((marketplace) => marketplace.id === original.id)).toEqual(original);
      expect(JSON.parse(await readFile(file, "utf8")).marketplaces).toContainEqual(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
