import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireFromUi = createRequire(new URL("../package.json", import.meta.url));

async function manifest(
  url: URL,
): Promise<{ exports?: Record<string, string>; scripts?: Record<string, string> }> {
  return JSON.parse(await readFile(url, "utf8"));
}

describe("Aiscoo legacy public entrypoints", () => {
  it("preserves the original package export targets and resolves both names", async () => {
    const cases = [
      [
        "../../services/package.json",
        "@zcode/services",
        "./xwork-plugin-guides",
        "./src/xwork-plugin-guides/index.ts",
        "./aiscoo-plugin-guides",
      ],
      [
        "../../shared/package.json",
        "@zcode/shared",
        "./xwork-plugin-guides",
        "./src/xwork-plugin-guides/index.ts",
        "./aiscoo-plugin-guides",
      ],
      [
        "../../shared/package.json",
        "@zcode/shared",
        "./xwork-brand",
        "./src/xwork-brand/runtime.js",
        "./aiscoo-brand",
      ],
      [
        "../package.json",
        "@zcode/ui",
        "./xwork-brand",
        "./src/xwork/brand/index.ts",
        "./aiscoo-brand",
      ],
      [
        "../package.json",
        "@zcode/ui",
        "./xwork-startup-context",
        "./src/xwork/startup-context/index.ts",
        "./aiscoo-startup-context",
      ],
    ] as const;
    for (const [file, packageName, legacy, target, current] of cases) {
      const pkg = await manifest(new URL(file, import.meta.url));
      expect(pkg.exports?.[legacy]).toBe(target);
      expect(pkg.exports?.[current]).toBeDefined();
      expect(requireFromUi.resolve(`${packageName}/${legacy.slice(2)}`)).toBeTruthy();
      expect(requireFromUi.resolve(`${packageName}/${current.slice(2)}`)).toBeTruthy();
    }
  });

  it("shares the original runtime values for brand and plugin guide contracts", async () => {
    const pairs = [
      [await import("@zcode/shared/xwork-brand"), await import("@zcode/shared/aiscoo-brand")],
      [
        await import("@zcode/shared/xwork-plugin-guides"),
        await import("@zcode/shared/aiscoo-plugin-guides"),
      ],
      [
        await import("@zcode/services/xwork-plugin-guides"),
        await import("@zcode/services/aiscoo-plugin-guides"),
      ],
      [await import("@zcode/ui/xwork-brand"), await import("@zcode/ui/aiscoo-brand")],
    ] as const;
    for (const [legacy, current] of pairs) {
      expect(Object.keys(legacy).sort()).toEqual(Object.keys(current).sort());
      for (const key of Object.keys(current)) {
        expect(legacy[key as keyof typeof legacy]).toBe(current[key as keyof typeof current]);
      }
    }
  });

  it("preserves the renamed startup function as the same implementation", async () => {
    const legacy = await import("@zcode/ui/xwork-startup-context");
    const current = await import("@zcode/ui/aiscoo-startup-context");
    expect(legacy.createXWorkRoot).toBe(current.createAiscooRoot);
    expect(legacy.createAiscooRoot).toBe(current.createAiscooRoot);
    expect(legacy.restoreDraftContext).toBe(current.restoreDraftContext);
  });

  it("keeps the existing CLI test hook and offers one new-name alias", async () => {
    const cli = await manifest(
      new URL("../../../apps/zcode-cli/packages/cli/package.json", import.meta.url),
    );
    expect(cli.scripts?.posttest).toBe("pnpm run test:xwork");
    expect(cli.scripts?.["test:xwork"]).toBe(
      "node --disable-warning=DEP0205 --import tsx --test tests/zen-login.test.ts tests/sea-keyring-runtime.test.ts tests/sea-keyring-assets.test.mjs src/sea-keyring/contract.test.ts",
    );
    expect(cli.scripts?.["test:aiscoo"]).toBe("pnpm run test:xwork");
  });
});
