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
  const cwd = mkdtempSync(join(tmpdir(), "aiscoo-branch-policy-"));
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
    const aiscoo = git(["mktree"], `100644 blob ${blob}\tupstream-sync-log.md\n`);
    const docs = git(["mktree"], `040000 tree ${aiscoo}\taiscoo\n`);
    return git(["mktree"], `040000 tree ${docs}\tdocs\n`);
  }
  function commit(parents, subject, tree = emptyTree) {
    return git(["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])], subject);
  }
  function ref(name, sha) {
    git(["update-ref", name, sha]);
  }
  const root = commit([], "root");
  const release = commit([root], "product change");
  const upstream = commit([root], "upstream change");
  const tree = logTree("Upstream change\n");
  ref("refs/heads/main", upstream);
  ref("refs/remotes/origin/main", upstream);
  ref("refs/remotes/origin/release", release);
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
  function pr(sha, head, base = "release") {
    return run("pr", { HEAD_SHA: sha, HEAD_REF: head, BASE_REF: base });
  }
  function sync(syncTree = tree) {
    return commit([release, upstream], "sync: merge upstream", syncTree);
  }
  return { commit, ref, run, pr, sync, root, release, upstream, tree, emptyTree };
}

function accepts(result) {
  assert.equal(result.status, 0, result.stderr);
}

function rejects(result, reason) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, reason);
}

test("upstream sync merges into release with mirror and sync-log requirements", (t) => {
  const repo = repository(t);
  accepts(repo.pr(repo.sync(), "sync/upstream-20261019"));
  rejects(repo.pr(repo.sync(), "sync/upstream-20261019", "main"), /必须是 release/);
  rejects(repo.pr(repo.sync(repo.emptyTree), "sync/upstream-20261019"), /必须更新/);
  rejects(repo.pr(repo.release, "sync/upstream-20261019"), /没有引入新的上游/);
  rejects(
    repo.pr(
      repo.commit([repo.upstream], "sync: cut from main", repo.tree),
      "sync/upstream-20261019",
    ),
    /必须包含当前 origin\/release/,
  );
  repo.ref("refs/remotes/origin/main", repo.root);
  rejects(repo.pr(repo.sync(), "sync/upstream-20261019"), /镜像中还没有/);
});

test("ordinary branches cannot carry upstream history, edit the sync log or target main", (t) => {
  const repo = repository(t);
  rejects(repo.pr(repo.sync(), "feature/sneak-upstream"), /尚未进入 release 的上游/);
  accepts(repo.pr(repo.commit([repo.release], "feat: product"), "feature/product"));
  rejects(
    repo.pr(repo.commit([repo.release], "docs: log", repo.tree), "fix/log"),
    /只能在上游同步 PR/,
  );
  rejects(
    repo.pr(repo.commit([repo.release], "feat"), "feature/product", "main"),
    /必须是 release/,
  );
  rejects(repo.pr(repo.commit([repo.release], "feat"), "XCode-main"), /分支名/);
});

test("push validates branch names and protects release and main", (t) => {
  const repo = repository(t);
  const push = (branch, remote = zero, local = repo.release) =>
    repo.run("push", {}, `refs/heads/${branch} ${local} refs/heads/${branch} ${remote}\n`);
  for (const branch of ["sync/upstream-20261019", "feature/product"]) accepts(push(branch));
  for (const branch of ["sync/promote-20261019", "sync/upstream-latest", "XCode-main"]) {
    rejects(push(branch), /分支名/);
  }
  rejects(push("release", repo.release), /禁止直接推送/);
  rejects(push("main", repo.upstream, repo.release), /非上游提交/);
  accepts(push("main", repo.root, repo.upstream));
});

test("merge guard rejects squashed synchronization and accepts merge commits", (t) => {
  const repo = repository(t);
  accepts(repo.run("guard-merge", { BEFORE: repo.release, AFTER: repo.sync() }));
  const squash = repo.commit([repo.release], "sync: squashed upstream", repo.tree);
  rejects(repo.run("guard-merge", { BEFORE: repo.release, AFTER: squash }), /单父提交/);
});
