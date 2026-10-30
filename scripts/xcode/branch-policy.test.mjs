import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  git(["config", "diff.renames", "true"]);
  const emptyTree = git(["mktree"], "");
  function logTree(content, directory = "xcode", product = null, productName = "product.txt") {
    const blob = git(["hash-object", "-w", "--stdin"], content);
    const log = git(["mktree"], `100644 blob ${blob}\tupstream-sync-log.md\n`);
    const docs = git(["mktree"], `040000 tree ${log}\t${directory}\n`);
    const productEntry =
      product === null
        ? ""
        : `100644 blob ${git(["hash-object", "-w", "--stdin"], product)}\t${productName}\n`;
    return git(["mktree"], `040000 tree ${docs}\tdocs\n${productEntry}`);
  }
  function directoryAtLogPath() {
    const blob = git(["hash-object", "-w", "--stdin"], "nested record\n");
    const nested = git(["mktree"], `100644 blob ${blob}\trecord.md\n`);
    const xcode = git(["mktree"], `040000 tree ${nested}\tupstream-sync-log.md\n`);
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
  const baseTree = logTree("Existing sync record\n");
  const release = commit([root], "product change", baseTree);
  const upstream = commit([root], "upstream change");
  const tree = logTree("Existing sync record\nUpstream change\n");
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
  return {
    commit,
    ref,
    run,
    pr,
    sync,
    logTree,
    directoryAtLogPath,
    root,
    release,
    upstream,
    tree,
    baseTree,
    emptyTree,
  };
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
  rejects(repo.pr(repo.sync(repo.baseTree), "sync/upstream-20261019"), /必须更新/);
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
  accepts(repo.pr(repo.commit([repo.release], "feat: product", repo.baseTree), "feature/product"));
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

test("ordinary PRs cannot delete the protected sync log", (t) => {
  const repo = repository(t);
  const deleted = repo.commit([repo.release], "docs: delete sync log", repo.emptyTree);
  rejects(repo.pr(deleted, "fix/delete-log"), /只能在上游同步 PR/);
});

test("ordinary PRs cannot move the protected sync log with rename detection enabled", (t) => {
  const repo = repository(t);
  const moved = repo.commit(
    [repo.release],
    "docs: move sync log",
    repo.logTree("Existing sync record\n", "archive"),
  );
  rejects(repo.pr(moved, "fix/move-log"), /只能在上游同步 PR/);
});

test("ordinary PRs may rename an unrelated file", (t) => {
  const repo = repository(t);
  const before = repo.commit(
    [repo.release],
    "feat: add unrelated file",
    repo.logTree("Existing sync record\n", "xcode", "product\n"),
  );
  repo.ref("refs/remotes/origin/release", before);
  const after = repo.commit(
    [before],
    "feat: move unrelated file",
    repo.logTree("Existing sync record\n", "xcode", "product\n", "renamed.txt"),
  );
  accepts(repo.pr(after, "fix/product"));
});

test("sync PRs cannot delete the protected sync log", (t) => {
  const repo = repository(t);
  rejects(repo.pr(repo.sync(repo.emptyTree), "sync/upstream-20261019"), /必须更新/);
});

test("sync PRs cannot move the protected sync log", (t) => {
  const repo = repository(t);
  const moved = repo.logTree("Existing sync record\n", "archive");
  rejects(repo.pr(repo.sync(moved), "sync/upstream-20261019"), /必须更新/);
});

test("sync PRs cannot replace the protected sync log with a directory", (t) => {
  const repo = repository(t);
  rejects(repo.pr(repo.sync(repo.directoryAtLogPath()), "sync/upstream-20261019"), /必须更新/);
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

test("real Git pre-push enforces policy, forwards refs and isolates Git environments", (t) => {
  if (process.platform === "win32") {
    t.skip("Git hook fixture uses POSIX shell executables");
    return;
  }
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "xcode-pre-push-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  const working = join(root, "working");
  const probe = join(root, "probe");
  const marker = join(root, "verify-input");
  const probeMarker = join(root, "verify-git-dir");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GIT_") &&
        !key.startsWith("ZCODE_") &&
        !["HUSKY", "GITHUB_ACTIONS", "GITHUB_STEP_SUMMARY", "UPSTREAM_URL"].includes(key),
    ),
  );
  Object.assign(env, {
    HOME: root,
    XDG_CONFIG_HOME: join(root, "config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Branch policy test",
    GIT_AUTHOR_EMAIL: "policy@example.invalid",
    GIT_COMMITTER_NAME: "Branch policy test",
    GIT_COMMITTER_EMAIL: "policy@example.invalid",
    GIT_TERMINAL_PROMPT: "0",
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    VERIFY_MARKER: marker,
    PROBE_REPO: probe,
    PROBE_MARKER: probeMarker,
  });
  mkdirSync(working);
  mkdirSync(probe);
  function git(cwd, ...args) {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  }
  git(root, "init", "--bare", "--quiet", "--template=", remote);
  git(probe, "init", "--quiet", "--template=");
  git(working, "init", "--quiet", "--initial-branch=fix/product", "--template=");
  mkdirSync(join(working, ".husky/_"), { recursive: true });
  mkdirSync(join(working, "scripts/xcode"), { recursive: true });
  mkdirSync(join(working, "node_modules/.bin"), { recursive: true });
  copyFileSync(join(repoRoot, ".husky/pre-push"), join(working, ".husky/pre-push"));
  copyFileSync(policy, join(working, "scripts/xcode/branch-policy.mjs"));
  const hook = join(working, ".husky/_/pre-push");
  // CI 的 policy job 不安装依赖；用 Husky 的 sh -e 语义执行仓库真实 hook。
  writeFileSync(
    hook,
    '#!/usr/bin/env sh\nPATH="node_modules/.bin:$PATH"\nexport PATH\nexec sh -e "$(dirname "$0")/../pre-push" "$@"\n',
  );
  chmodSync(hook, 0o755);
  const pnpm = join(working, "node_modules/.bin/pnpm");
  writeFileSync(
    pnpm,
    '#!/usr/bin/env sh\n[ "$1" = run ] && [ "$2" = verify:pre-push ] || exit 90\nprintf "%s" "$ZCODE_PRE_PUSH_STDIN" > "$VERIFY_MARKER"\ngit -C "$PROBE_REPO" rev-parse --absolute-git-dir > "$PROBE_MARKER" || exit 91\nexit "${VERIFY_EXIT:-0}"\n',
  );
  chmodSync(pnpm, 0o755);
  git(working, "config", "core.hooksPath", ".husky/_");
  writeFileSync(join(working, "product.txt"), "base\n");
  git(working, "add", "product.txt");
  git(working, "commit", "--quiet", "-m", "base");
  const base = git(working, "rev-parse", "HEAD");
  git(root, "--git-dir", remote, "fetch", "--quiet", working, `${base}:refs/heads/release`);
  writeFileSync(join(working, "product.txt"), "change\n");
  git(working, "commit", "--quiet", "-am", "feature");
  const head = git(working, "rev-parse", "HEAD");
  const push = (target, overrides = {}) =>
    spawnSync("git", ["push", remote, `HEAD:refs/heads/${target}`], {
      cwd: working,
      env: { ...env, ...overrides },
      encoding: "utf8",
    });

  const blocked = push("release");
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /禁止直接推送/);
  assert.equal(existsSync(marker), false);
  assert.equal(git(root, "--git-dir", remote, "rev-parse", "refs/heads/release"), base);

  const invalid = push("Bad-name");
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /分支名/);
  assert.equal(existsSync(marker), false);

  const failed = push("fix/product", { VERIFY_EXIT: "23" });
  assert.notEqual(failed.status, 0);
  assert.equal(readFileSync(marker, "utf8"), `HEAD ${head} refs/heads/fix/product ${zero}`);
  assert.equal(
    readFileSync(probeMarker, "utf8").trim(),
    git(probe, "rev-parse", "--absolute-git-dir"),
  );
  const missing = spawnSync(
    "git",
    ["--git-dir", remote, "show-ref", "--verify", "--quiet", "refs/heads/fix/product"],
    { env },
  );
  assert.equal(missing.status, 1);

  const allowed = push("fix/product");
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(readFileSync(marker, "utf8"), `HEAD ${head} refs/heads/fix/product ${zero}`);
  assert.equal(git(root, "--git-dir", remote, "rev-parse", "refs/heads/fix/product"), head);
});

test("merge guard accepts ordinary commits and sync merge commits", (t) => {
  const repo = repository(t);
  accepts(repo.run("guard-merge", { BEFORE: repo.release, AFTER: repo.sync() }));
  const ordinary = repo.commit([repo.release], "feat: product", repo.baseTree);
  accepts(repo.run("guard-merge", { BEFORE: repo.release, AFTER: ordinary }));
});

test("merge guard rejects squashed sync commits by subject", (t) => {
  const repo = repository(t);
  const squash = repo.commit([repo.release], "sync: squashed upstream", repo.baseTree);
  rejects(repo.run("guard-merge", { BEFORE: repo.release, AFTER: squash }), /单父提交/);
});

test("merge guard rejects a single-parent edit of the sync log", (t) => {
  const repo = repository(t);
  const changed = repo.commit([repo.release], "feat: disguised sync", repo.tree);
  rejects(repo.run("guard-merge", { BEFORE: repo.release, AFTER: changed }), /单父提交/);
});

test("merge guard rejects a single-parent deletion of the sync log", (t) => {
  const repo = repository(t);
  const deleted = repo.commit([repo.release], "feat: delete log", repo.emptyTree);
  rejects(repo.run("guard-merge", { BEFORE: repo.release, AFTER: deleted }), /单父提交/);
});

test("merge guard rejects a single-parent move with rename detection enabled", (t) => {
  const repo = repository(t);
  const moved = repo.commit(
    [repo.release],
    "feat: move log",
    repo.logTree("Existing sync record\n", "archive"),
  );
  rejects(repo.run("guard-merge", { BEFORE: repo.release, AFTER: moved }), /单父提交/);
});
