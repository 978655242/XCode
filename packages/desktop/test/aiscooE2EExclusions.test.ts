import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createWindowsE2EShardPlan } from "../scripts/run-windows-e2e-shards.mjs";
import { resolveAiscooUpstreamBrokenSpecExcludes } from "../scripts/aiscoo-upstream-broken-specs.mjs";

const brokenSpec =
  "./test/e2e/conversation-session/conversation-session-bash-direct-output.test.ts";
const smokeSpec = "./test/e2e/smoke.test.ts";
const desktopDir = resolve("packages/desktop");

function runnableSpecs(env: Record<string, string | undefined>): string[] {
  const assigned = env.ZCODE_E2E_SPEC?.split(",") ?? [];
  const excludes = resolveAiscooUpstreamBrokenSpecExcludes({ targeted: assigned.length > 0, env });
  return assigned.filter((spec) => !excludes.includes(spec));
}

describe("XWork E2E exclusions", () => {
  it("keeps default exclusions when full-run weighted shards assign explicit spec lists", () => {
    const plan = createWindowsE2EShardPlan({
      args: ["--shards=2"],
      desktopDir,
      env: { ZCODE_E2E_RUN_ID: "aiscoo-exclusions" },
      platform: "win32",
      repoRoot: resolve("."),
      runIdEntropy: "weighted-exclusions",
      weightedSpecBuckets: [
        { estimatedWeightMs: 2, specs: [brokenSpec, smokeSpec] },
        {
          estimatedWeightMs: 1,
          specs: [
            "./test/e2e/conversation-session/conversation-session-background-bash-output.test.ts",
          ],
        },
      ],
    });

    expect(plan.children.flatMap((child) => runnableSpecs(child.env))).toEqual([smokeSpec]);
  });

  it("still runs a deferred spec explicitly selected by the user", () => {
    const plan = createWindowsE2EShardPlan({
      args: [],
      desktopDir,
      env: { ZCODE_E2E_SPEC: brokenSpec },
      platform: "win32",
      repoRoot: resolve("."),
      runIdEntropy: "targeted-exclusions",
      weightedSpecBuckets: undefined,
    });

    expect(plan.children.flatMap((child) => runnableSpecs(child.env))).toEqual([brokenSpec]);
  });
});
