#!/usr/bin/env node
// XWork PR 改动文件格式检查。规则来源：docs/xcode/BRANCHING.md「门禁」。
// 上游存量文件并未全部格式化；只追加几行就要求整份重排，会违反"上游文件最小改动"，
// 并让后续上游同步在该文件上反复冲突。因此：新文件、基线已格式化的文件照常检查；
// 基线本就不合格式的文件跳过并列出，不在 PR 中强迫整份格式化。
// 用法：node scripts/xcode/format-changed.mjs <base-ref>（如 origin/release）
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const oxfmt = process.env.OXFMT_BIN ?? "oxfmt";

async function git(args, cwd) {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** 返回 oxfmt --check 未通过的文件；在 cwd 下运行以沿用该目录的 .oxfmtrc.json 与忽略规则。 */
async function unformatted(files, cwd) {
  if (files.length === 0) return [];
  const result = await run(
    oxfmt,
    ["--list-different", "--no-error-on-unmatched-pattern", ...files],
    {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    },
  ).catch((error) => {
    // --list-different 有差异时退出 1；其余是工具错误。
    if (error.code !== 1) throw error;
    return error;
  });
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** base 上已存在且本就未格式化的文件。用分离的临时 worktree 保证配置与路径一致。 */
export async function baselineUnformatted(base, files, repoRoot) {
  const existing = (await git(["ls-tree", "-r", "--name-only", base, "--", ...files], repoRoot))
    .split("\n")
    .filter(Boolean);
  if (existing.length === 0) return new Set();
  const scratch = await mkdtemp(join(tmpdir(), "xwork-fmt-"));
  const worktree = join(scratch, "base");
  try {
    await git(["worktree", "add", "--detach", "--no-checkout", worktree, base], repoRoot);
    await git(["checkout", base, "--", ".oxfmtrc.json", ...existing], worktree);
    return new Set(await unformatted(existing, worktree));
  } finally {
    await git(["worktree", "remove", "--force", worktree], repoRoot).catch(() => {});
    await rm(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const base = process.argv[2];
  if (!base) throw new Error("用法：format-changed.mjs <base-ref>");
  const repoRoot = (await git(["rev-parse", "--show-toplevel"])).trim();
  const files = (
    await git(["diff", "--name-only", "-z", "--diff-filter=ACMR", `${base}...HEAD`], repoRoot)
  )
    .split("\0")
    .filter(Boolean);
  const failing = await unformatted(files, repoRoot);
  if (failing.length === 0) return;
  const skip = await baselineUnformatted(base, failing, repoRoot);
  for (const path of skip) console.log(`跳过（基线即未格式化）：${path}`);
  const errors = failing.filter((path) => !skip.has(path));
  for (const path of errors) console.error(`格式不符：${path}`);
  if (errors.length > 0) {
    console.error("运行 pnpm exec oxfmt <文件> 修复。");
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
