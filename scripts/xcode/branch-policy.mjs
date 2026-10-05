#!/usr/bin/env node
// XCode 分支规范的机器校验，规则来源：docs/xcode/BRANCHING.md。
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

const PRODUCT_BRANCH = "XCode-main";
const MIRROR_BRANCH = "main";
const SYNC_LOG = "docs/xcode/upstream-sync-log.md";
const DEFAULT_UPSTREAM_URL = "https://github.com/zai-org/ZCode.git";
const UPSTREAM_REF = `refs/remotes/upstream/${MIRROR_BRANCH}`;
const PRODUCT_REF = `refs/remotes/origin/${PRODUCT_BRANCH}`;
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

  if (base !== PRODUCT_BRANCH) {
    errors.push(`PR 目标分支必须是 ${PRODUCT_BRANCH}，当前是 ${base}。main 只镜像上游 ZCode。`);
  }
  const nameError = branchNameError(head);
  if (nameError) errors.push(nameError);

  const upstreamRef = await fetchUpstream();
  // fork 点：PR 包含的最新上游提交；它之前、XCode-main 还没有的提交就是本 PR 新引入的上游改动。
  const forkPoint = await git("merge-base", headSha, upstreamRef);
  const upstreamCount = Number(await git("rev-list", "--count", forkPoint, `^${PRODUCT_REF}`));
  const changedFiles = lines(await git("diff", "--name-only", `${PRODUCT_REF}...${headSha}`));
  const touchesSyncLog = changedFiles.includes(SYNC_LOG);

  if (SYNC_BRANCH.test(head)) {
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
  } else {
    if (upstreamCount > 0) {
      errors.push(
        `分支包含 ${upstreamCount} 个尚未同步的上游提交。上游改动只能通过 sync/upstream-YYYYMMDD 分支合入。`,
      );
    }
    if (touchesSyncLog) errors.push(`${SYNC_LOG} 只能在 sync/upstream-* PR 中修改。`);
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
    const [, localSha, remoteRef] = line.split(" ");
    if (!remoteRef?.startsWith("refs/heads/")) continue;
    const branch = remoteRef.slice("refs/heads/".length);
    const isDelete = ZERO_SHA.test(localSha);

    if (branch === PRODUCT_BRANCH) {
      errors.push(`禁止直接推送 ${PRODUCT_BRANCH}，请从 feature/fix 分支提 PR。`);
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
    await git("log", "--oneline", "--no-merges", `${PRODUCT_REF}..${upstreamRef}`),
  );
  await writeSummary(
    [
      "## 上游同步状态",
      `- ${MIRROR_BRANCH} 落后 upstream/main：${mirrorLag} 个提交`,
      `- 尚未进入 ${PRODUCT_BRANCH} 的上游提交：${pending.length} 个`,
      ...pending.map((item) => `  - ${item}`),
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
