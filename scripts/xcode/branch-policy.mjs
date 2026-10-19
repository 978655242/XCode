#!/usr/bin/env node
// XWork 分支规范的机器校验，规则来源：docs/xcode/BRANCHING.md。
// 子命令：
//   pr            CI 校验 PR（env: BASE_REF, HEAD_REF, HEAD_SHA）
//   push          本地 pre-push hook，stdin 为 git 传入的 ref 列表
//   guard-merge   XCode-main 合并后巡检（env: BEFORE, AFTER）
//   guard-mirror  定时巡检 main 是否仍是上游镜像
// 上游地址可用 env UPSTREAM_URL 覆盖（测试用）。
import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);

// 分支角色：release 是产品主干（接功能 PR 与来自 XCode-main 的同步 PR）；
// XCode-main 是上游同步分支（只接 sync/ PR）；main 是上游纯镜像。
const TRUNK_BRANCH = "release";
const SYNC_TARGET_BRANCH = "XCode-main";
const MIRROR_BRANCH = "main";
const SYNC_LOG = "docs/xcode/upstream-sync-log.md";
const DEFAULT_UPSTREAM_URL = "https://github.com/zai-org/ZCode.git";
const UPSTREAM_REF = `refs/remotes/upstream/${MIRROR_BRANCH}`;
const TRUNK_REF = `refs/remotes/origin/${TRUNK_BRANCH}`;
const SYNC_TARGET_REF = `refs/remotes/origin/${SYNC_TARGET_BRANCH}`;
const MIRROR_REF = `refs/remotes/origin/${MIRROR_BRANCH}`;
const ZERO_SHA = /^0+$/;
const WORK_BRANCH = /^(feature|fix|chore|hotfix)\/[a-z0-9][a-z0-9._-]*$/;
const SYNC_BRANCH = /^sync\/upstream-\d{8}$/;

async function git(...args) {
  const { stdout } = await run("git", args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

async function isAncestor(ancestor, descendant) {
  try {
    await run("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  }
}

function lines(text) {
  return text ? text.split("\n").filter(Boolean) : [];
}

// 直接从上游拉取判定基准，不依赖 origin/main 镜像是否及时更新。
async function fetchUpstream() {
  const url = process.env.UPSTREAM_URL || DEFAULT_UPSTREAM_URL;
  await git("fetch", "--quiet", "--no-tags", url, `+refs/heads/${MIRROR_BRANCH}:${UPSTREAM_REF}`);
  return UPSTREAM_REF;
}

function branchNameError(name) {
  if (WORK_BRANCH.test(name) || SYNC_BRANCH.test(name)) return null;
  return (
    `分支名 "${name}" 不符合规范。允许：feature/<kebab>、fix/<kebab>、chore/<kebab>、` +
    `hotfix/<版本>-<kebab>、sync/upstream-YYYYMMDD（小写）。`
  );
}

async function checkPr() {
  const { BASE_REF: base, HEAD_REF: head, HEAD_SHA: headSha } = process.env;
  if (!base || !head || !headSha) throw new Error("缺少 BASE_REF / HEAD_REF / HEAD_SHA");
  const errors = [];
  const isSync = SYNC_BRANCH.test(head);
  const isPromotion = head === SYNC_TARGET_BRANCH;

  // 目标分支：sync/ → XCode-main；XCode-main → release；其余工作分支 → release。
  const expectedBase = isSync ? SYNC_TARGET_BRANCH : TRUNK_BRANCH;
  if (base !== expectedBase) {
    errors.push(
      isSync
        ? `同步分支只能合入 ${SYNC_TARGET_BRANCH}，当前目标是 ${base}。`
        : `PR 目标分支必须是 ${TRUNK_BRANCH}，当前是 ${base}。${SYNC_TARGET_BRANCH} 只接 sync/upstream-* PR，${MIRROR_BRANCH} 只镜像上游 ZCode。`,
    );
    return errors;
  }
  if (!isPromotion) {
    const nameError = branchNameError(head);
    if (nameError) errors.push(nameError);
  }

  const baseRef = `refs/remotes/origin/${base}`;
  const upstreamRef = await fetchUpstream();
  // fork 点：PR 包含的最新上游提交；它之前、目标分支还没有的提交就是本 PR 新引入的上游改动。
  const forkPoint = await git("merge-base", headSha, upstreamRef);
  const upstreamCount = Number(await git("rev-list", "--count", forkPoint, `^${baseRef}`));
  const changedFiles = lines(await git("diff", "--name-only", `${baseRef}...${headSha}`));
  const touchesSyncLog = changedFiles.includes(SYNC_LOG);

  if (isSync) {
    if (upstreamCount === 0) {
      errors.push(
        "同步分支没有引入新的上游提交。先把 main 快进到 upstream/main，再 `git merge --no-ff main`。",
      );
    } else if (!(await isAncestor(forkPoint, MIRROR_REF))) {
      errors.push(
        `同步分支引入了 ${MIRROR_BRANCH} 镜像中还没有的上游提交。先快进并推送 ${MIRROR_BRANCH}，再从 ${MIRROR_BRANCH} 合并。`,
      );
    }
    if (!touchesSyncLog) errors.push(`同步 PR 必须更新 ${SYNC_LOG}（分类、冲突取舍、拒绝原因）。`);
  } else if (isPromotion) {
    // 上游改动经 XCode-main 评审后才进入 release；这里只防止 head 不是已推送的 XCode-main。
    if (!(await isAncestor(headSha, SYNC_TARGET_REF))) {
      errors.push(
        `${SYNC_TARGET_BRANCH} → ${TRUNK_BRANCH} 的 PR 只能包含已合入 origin/${SYNC_TARGET_BRANCH} 的提交。`,
      );
    }
  } else {
    if (upstreamCount > 0) {
      errors.push(
        `分支包含 ${upstreamCount} 个尚未进入 ${TRUNK_BRANCH} 的上游提交。上游改动只能经 sync/upstream-YYYYMMDD → ${SYNC_TARGET_BRANCH} → ${TRUNK_BRANCH} 合入。`,
      );
    }
    if (touchesSyncLog) errors.push(`${SYNC_LOG} 只能在上游同步 PR 中修改。`);
  }
  return errors;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function checkPush() {
  const errors = [];
  let upstreamRef = null;
  for (const line of lines(await readStdin())) {
    const [, localSha, remoteRef, remoteSha] = line.split(" ");
    if (!remoteRef?.startsWith("refs/heads/")) continue;
    const branch = remoteRef.slice("refs/heads/".length);
    const isDelete = ZERO_SHA.test(localSha);

    if (branch === SYNC_TARGET_BRANCH) {
      errors.push(`禁止直接推送 ${SYNC_TARGET_BRANCH}，请从 sync/upstream-* 分支提 PR。`);
    } else if (branch === TRUNK_BRANCH) {
      // 只放行远端尚不存在时的首次创建；之后一律走 PR。
      if (isDelete || !ZERO_SHA.test(remoteSha ?? "")) {
        errors.push(`禁止直接推送或删除 ${TRUNK_BRANCH}，请从 feature/fix 分支提 PR。`);
      }
    } else if (branch === MIRROR_BRANCH) {
      if (isDelete) {
        errors.push(`禁止删除 ${MIRROR_BRANCH}。`);
        continue;
      }
      upstreamRef ??= await fetchUpstream();
      if (!(await isAncestor(localSha, upstreamRef))) {
        errors.push(`${MIRROR_BRANCH} 只能快进到 upstream/main，本次推送包含非上游提交。`);
      }
    } else if (!isDelete) {
      const nameError = branchNameError(branch);
      if (nameError) errors.push(nameError);
    }
  }
  return errors;
}

async function guardMerge() {
  const { BEFORE: before, AFTER: after } = process.env;
  if (!after) throw new Error("缺少 AFTER");
  const range = before && !ZERO_SHA.test(before) ? [`${before}..${after}`] : ["-1", after];
  const commits = lines(await git("log", "--first-parent", "--format=%H%x09%P%x09%s", ...range));
  const errors = [];
  for (const commit of commits) {
    const [sha, parents, subject] = commit.split("\t");
    if (parents.split(" ").length > 1) continue;
    const files = lines(await git("diff-tree", "--no-commit-id", "--name-only", "-r", sha));
    if (/^sync[:(]/.test(subject) || files.includes(SYNC_LOG)) {
      errors.push(
        `${sha.slice(0, 7)} "${subject}" 是单父提交却包含上游同步内容：同步 PR 被 squash 合并了。` +
          "上游提交 SHA 已丢失，下次同步会重复冲突；需由维护者 revert 后用 merge commit 重新合并。",
      );
    }
  }
  return errors;
}

async function writeSummary(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
}

async function guardMirror() {
  const upstreamRef = await fetchUpstream();
  const errors = [];
  if (!(await isAncestor(MIRROR_REF, upstreamRef))) {
    errors.push(`${MIRROR_BRANCH} 已偏离上游 ZCode（含非上游提交），必须由维护者排查。`);
  }
  const mirrorLag = Number(await git("rev-list", "--count", `${MIRROR_REF}..${upstreamRef}`));
  const pending = lines(
    await git("log", "--oneline", "--no-merges", `${SYNC_TARGET_REF}..${upstreamRef}`),
  );
  const promotionLag = Number(await git("rev-list", "--count", `${TRUNK_REF}..${SYNC_TARGET_REF}`));
  await writeSummary(
    [
      "## 上游同步状态",
      `- ${MIRROR_BRANCH} 落后 upstream/main：${mirrorLag} 个提交`,
      `- 尚未进入 ${SYNC_TARGET_BRANCH} 的上游提交：${pending.length} 个`,
      ...pending.map((item) => `  - ${item}`),
      `- ${SYNC_TARGET_BRANCH} 尚未合入 ${TRUNK_BRANCH} 的提交：${promotionLag} 个`,
    ].join("\n"),
  );
  return errors;
}

const commands = {
  pr: checkPr,
  push: checkPush,
  "guard-merge": guardMerge,
  "guard-mirror": guardMirror,
};

const command = commands[process.argv[2]];
if (!command) {
  console.error(`用法: branch-policy.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}

const errors = await command();
if (errors.length > 0) {
  const prefix = process.env.GITHUB_ACTIONS ? "::error::" : "✗ ";
  for (const error of errors) console.error(`${prefix}${error}`);
  console.error("规范：docs/xcode/BRANCHING.md");
  process.exitCode = 1;
}
