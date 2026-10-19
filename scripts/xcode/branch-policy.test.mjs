import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const policy = fileURLToPath(new URL("./branch-policy.mjs", import.meta.url));
const zero = "0".repeat(40);

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "xcode-branch-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Branch policy test",
    GIT_AUTHOR_EMAIL: "policy@example.invalid",
    GIT_COMMITTER_NAME: "Branch policy test",
    GIT_COMMITTER_EMAIL: "policy@example.invalid",
    GIT_AUTHOR_DATE: "2026-10-19T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-10-19T00:00:00Z",
    GIT_TERMINAL_PROMPT: "0",
    GITHUB_ACTIONS: "",
    GITHUB_STEP_SUMMARY: "",
    UPSTREAM_URL: cwd,
  });
  function git(args, input) {
    const result = spawnSync("git", args, { cwd, env, input, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  }
  git(["init", "--quiet", "--initial-branch=main", "--template="]);
  const emptyTree = git(["mktree"], "");
  function logTree(content) {
    const blob = git(["hash-object", "-w", "--stdin"], content);
    const xcode = git(["mktree"], `100644 blob ${blob}\tupstream-sync-log.md\n`);
    const docs = git(["mktree"], `040000 tree ${xcode}\txcode\n`);
    return git(["mktree"], `040000 tree ${docs}\tdocs\n`);
  }
  function commit(parents, subject, tree = emptyTree) {
    return git(["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])], subject);
  }
  function ref(name, sha) {
    git(["update-ref", name, sha]);
  }
  const root = commit([], "root");
  const previous = commit([root], "previous reviewed baseline");
  const release = commit([previous], "product change");
  const reviewedUpstream = commit([root], "reviewed upstream change");
  const tree = logTree("Reviewed upstream change\n");
  const reviewed = commit([previous, reviewedUpstream], "sync: reviewed upstream", tree);
  const unreviewed = commit([reviewedUpstream], "unreviewed upstream change");
  ref("refs/heads/main", unreviewed);
  ref("refs/remotes/origin/main", unreviewed);
  ref("refs/remotes/origin/release", release);
  ref("refs/remotes/origin/XCode-main", reviewed);
  function run(command, variables = {}, input = "") {
    const result = spawnSync(process.execPath, [policy, command], {
      cwd,
      env: { ...env, ...variables },
      input,
      encoding: "utf8",
    });
    assert.ifError(result.error);
    return result;
  }
  function pr(sha, head = "sync/promote-20261019", base = "release") {
    return run("pr", { HEAD_SHA: sha, HEAD_REF: head, BASE_REF: base });
  }
  function promote() {
    return commit([release, reviewed], "sync: promote reviewed upstream", tree);
  }
  return {
    commit,
    ref,
    run,
    pr,
    promote,
    logTree,
    root,
    previous,
    release,
    reviewedUpstream,
    reviewed,
    unreviewed,
    tree,
  };
}

function accepts(result) {
  assert.equal(result.status, 0, result.stderr);
}

function rejects(result, reason) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, reason);
}

test("promotion accepts reviewed merge and subsequent linear conflict repairs", (t) => {
  const repo = repository(t);
  const merge = repo.promote();
  accepts(repo.pr(merge));
  accepts(repo.pr(repo.commit([merge], "fix: conflict resolution", repo.tree)));
});

test("promotion can merge newer release and reviewed XCode-main baselines", (t) => {
  const repo = repository(t);
  const merge = repo.promote();
  const release = repo.commit([repo.release], "new product change");
  const reviewed = repo.commit([repo.reviewed], "reviewed adaptation", repo.tree);
  repo.ref("refs/remotes/origin/release", release);
  repo.ref("refs/remotes/origin/XCode-main", reviewed);
  const updated = repo.commit([merge, release], "sync: update release", repo.tree);
  accepts(repo.pr(repo.commit([updated, reviewed], "sync: update reviewed baseline", repo.tree)));
});

test("promotion rejects XCode-main and main PR targets", (t) => {
  const repo = repository(t);
  for (const base of ["XCode-main", "main"]) {
    rejects(repo.pr(repo.promote(), "sync/promote-20261019", base), /release/);
  }
});

test("promotion requires the current release and current reviewed XCode-main", (t) => {
  const repo = repository(t);
  rejects(repo.pr(repo.reviewed), /origin\/release/);
  const missingReviewed = repo.commit([repo.release, repo.reviewedUpstream], "sync: incomplete");
  rejects(repo.pr(missingReviewed), /origin\/XCode-main/);
  const stale = repo.promote();
  repo.ref("refs/remotes/origin/release", repo.commit([repo.release], "release advanced"));
  rejects(repo.pr(stale), /origin\/release/);
  repo.ref("refs/remotes/origin/release", repo.release);
  repo.ref("refs/remotes/origin/XCode-main", repo.commit([repo.reviewed], "review advanced"));
  rejects(repo.pr(stale), /origin\/XCode-main/);
});

test("promotion rejects upstream history not yet reviewed in XCode-main", (t) => {
  const repo = repository(t);
  const extra = repo.commit([repo.promote(), repo.unreviewed], "sync: sneak in upstream");
  rejects(repo.pr(extra), /未审核.*上游/);
});

test("promotion rejects third-party side history and octopus merges", (t) => {
  const repo = repository(t);
  const foreign = repo.commit([repo.reviewed], "third-party branch");
  rejects(repo.pr(repo.commit([repo.promote(), foreign], "sync: foreign merge")), /第三方/);
  rejects(repo.pr(repo.commit([repo.release, repo.reviewed, foreign], "sync: octopus")), /双亲/);
});

test("promotion must begin on release ancestry with its own genuine reviewed merge", (t) => {
  const repo = repository(t);
  const backwards = repo.commit([repo.reviewed, repo.release], "sync: reversed promotion");
  rejects(repo.pr(backwards), /release.*双亲 merge/);
  const local = repo.commit([repo.release], "feature before promotion");
  rejects(
    repo.pr(repo.commit([local, repo.reviewed], "sync: product mixed in")),
    /release.*双亲 merge/,
  );
  const alreadyPromoted = repo.promote();
  repo.ref("refs/remotes/origin/release", alreadyPromoted);
  const redundant = repo.commit([alreadyPromoted, repo.reviewed], "sync: redundant merge");
  rejects(repo.pr(redundant), /真实双亲 merge/);
  repo.ref("refs/remotes/origin/release", repo.previous);
  rejects(repo.pr(repo.commit([repo.reviewed], "fix: copied promotion")), /双亲 merge/);
  rejects(repo.pr(repo.reviewed), /双亲 merge/);
});

test("ordinary feature branches still cannot carry upstream history or edit the sync log", (t) => {
  const repo = repository(t);
  rejects(repo.pr(repo.promote(), "feature/sneak-upstream"), /尚未进入 release 的上游/);
  const feature = repo.commit([repo.release], "feat: normal product change");
  accepts(repo.pr(feature, "feature/product"));
  const logEdit = repo.commit([repo.release], "docs: edit sync log", repo.tree);
  rejects(repo.pr(logEdit, "fix/log"), /只能在上游同步 PR/);
});

test("direct XCode-main promotion still accepts only reviewed history", (t) => {
  const repo = repository(t);
  accepts(repo.pr(repo.reviewed, "XCode-main"));
  rejects(
    repo.pr(repo.commit([repo.reviewed], "unreviewed adaptation"), "XCode-main"),
    /只能包含已合入/,
  );
});

test("upstream sync keeps its base, mirror and sync-log requirements", (t) => {
  const repo = repository(t);
  const tree = repo.logTree("Reviewed upstream change and next upstream change\n");
  const sync = repo.commit([repo.reviewed, repo.unreviewed], "sync: next upstream", tree);
  accepts(repo.pr(sync, "sync/upstream-20261019", "XCode-main"));
  rejects(repo.pr(sync, "sync/upstream-20261019"), /只能合入 XCode-main/);
  const noLog = repo.commit([repo.reviewed, repo.unreviewed], "sync: missing log", repo.tree);
  rejects(repo.pr(noLog, "sync/upstream-20261019", "XCode-main"), /必须更新/);
  repo.ref("refs/remotes/origin/main", repo.reviewedUpstream);
  rejects(repo.pr(sync, "sync/upstream-20261019", "XCode-main"), /镜像中还没有/);
});

test("push accepts named promotion branches but still protects long-lived branches", (t) => {
  const repo = repository(t);
  const push = (branch, remote = zero) =>
    repo.run("push", {}, `refs/heads/${branch} ${repo.release} refs/heads/${branch} ${remote}\n`);
  for (const branch of ["sync/promote-20261019", "sync/upstream-20261019", "feature/product"]) {
    accepts(push(branch));
  }
  for (const branch of ["sync/promote-latest", "sync/promote-2026101", "sync/other-20261019"]) {
    rejects(push(branch), /分支名/);
  }
  rejects(push("release", repo.release), /禁止直接推送/);
  rejects(push("XCode-main"), /禁止直接推送/);
  rejects(push("main", repo.reviewedUpstream), /非上游提交/);
});

test("merge guard still rejects squashed synchronization and accepts merge commits", (t) => {
  const repo = repository(t);
  const merge = repo.promote();
  accepts(repo.run("guard-merge", { BEFORE: repo.release, AFTER: merge }));
  const squash = repo.commit([repo.release], "sync: promote squashed upstream", repo.tree);
  rejects(repo.run("guard-merge", { BEFORE: repo.release, AFTER: squash }), /单父提交/);
});
