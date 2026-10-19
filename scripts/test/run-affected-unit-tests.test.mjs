import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { selectDefaultBranchRef } from "../affected-unit-test-baseline.mjs";

test("prefers origin/staging as the default affected-test baseline", () => {
  const availableRefs = new Set(["origin/staging", "origin/main"]);

  const selected = selectDefaultBranchRef({
    originHead: "origin/main",
    hasCommit: (ref) => availableRefs.has(ref),
  });

  assert.equal(selected, "origin/staging");
});

test("prefers origin/release over origin/main when XCode has no staging", () => {
  const availableRefs = new Set(["origin/release", "origin/main"]);

  const selected = selectDefaultBranchRef({
    originHead: "origin/main",
    hasCommit: (ref) => availableRefs.has(ref),
  });

  assert.equal(selected, "origin/release");
});

test("does not force a full unit run based on changed file names", async () => {
  const runnerSource = await readFile(
    new URL("../run-affected-unit-tests.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(runnerSource, /isFullRunTrigger/u);
});
