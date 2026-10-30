import assert from "node:assert/strict";
import test from "node:test";

import { selectDefaultBranchRef } from "../architecture/default-branch.mjs";

test("retains origin/staging fallback when release is unavailable", () => {
  const availableRefs = new Set(["origin/staging", "origin/main"]);

  const selected = selectDefaultBranchRef({
    originHead: "origin/main",
    hasCommit: (ref) => availableRefs.has(ref),
  });

  assert.equal(selected, "origin/staging");
});

// XCODE: 同时存在镜像 main 和产品 release 时，不能将已评审产品历史误算为新变更。
test("prefers the Aiscoo release branch over mirror and staging refs", () => {
  const availableRefs = new Set(["origin/release", "origin/staging", "origin/main"]);
  assert.equal(
    selectDefaultBranchRef({
      originHead: "origin/main",
      hasCommit: (ref) => availableRefs.has(ref),
    }),
    "origin/release",
  );
});
