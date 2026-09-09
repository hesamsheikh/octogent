import type { TentacleWorkspaceMode, TerminalCompletionSummary } from "@octogent/core";

export type RunGitCommand = (cwd: string, args: string[]) => string;

export type CompletionGitFacts = {
  commits: Array<{ hash: string; message: string }>;
  filesChanged: number;
  insertions: number;
  deletions: number;
  branch: string | null;
  merged: boolean;
};

export const isExitCode = (error: unknown, exitCode: number) => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const errorWithStatus = error as { status?: unknown };
  return errorWithStatus.status === exitCode;
};

const parseCommitLog = (logOutput: string): CompletionGitFacts["commits"] =>
  logOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tabIndex = line.indexOf("\t");
      if (tabIndex === -1) {
        return { hash: line, message: "" };
      }
      return {
        hash: line.slice(0, tabIndex),
        message: line.slice(tabIndex + 1).trim(),
      };
    });

const parseShortstatCount = (shortstatOutput: string, pattern: RegExp): number => {
  const match = shortstatOutput.match(pattern);
  if (!match) {
    return 0;
  }
  const parsed = Number.parseInt(match[1] ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const collectCompletionGitFacts = (
  worktreeCwd: string,
  baseRef: string,
  run: RunGitCommand,
): CompletionGitFacts | null => {
  try {
    // %x09 keeps hash and subject unambiguous even when messages contain spaces.
    const logOutput = run(worktreeCwd, ["log", "--format=%h%x09%s", `${baseRef}..HEAD`]);
    // Three-dot diff measures this branch's changes since the merge base, not
    // drift that landed on the base ref in the meantime.
    const shortstatOutput = run(worktreeCwd, ["diff", "--shortstat", `${baseRef}...HEAD`]);
    const branchOutput = run(worktreeCwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();

    let merged: boolean;
    try {
      run(worktreeCwd, ["merge-base", "--is-ancestor", "HEAD", baseRef]);
      merged = true;
    } catch (error) {
      // Exit code 1 is the command's normal "not an ancestor" answer, not a failure.
      if (!isExitCode(error, 1)) {
        throw error;
      }
      merged = false;
    }

    return {
      commits: parseCommitLog(logOutput),
      filesChanged: parseShortstatCount(shortstatOutput, /(\d+) files? changed/),
      insertions: parseShortstatCount(shortstatOutput, /(\d+) insertions?\(\+\)/),
      deletions: parseShortstatCount(shortstatOutput, /(\d+) deletions?\(-\)/),
      // "HEAD" is what rev-parse reports for a detached head, not a branch name.
      branch: branchOutput.length > 0 && branchOutput !== "HEAD" ? branchOutput : null,
      merged,
    };
  } catch {
    return null;
  }
};

const EMPTY_GIT_FACTS: CompletionGitFacts = {
  commits: [],
  filesChanged: 0,
  insertions: 0,
  deletions: 0,
  branch: null,
  merged: false,
};

export type BuildCompletionSummaryInput = {
  initialPrompt: string | null;
  createdAt: string | null;
  completedAt: string | null;
  workspaceMode: TentacleWorkspaceMode;
  gitFacts: CompletionGitFacts | null;
};

const toTaskLine = (initialPrompt: string | null): string | null => {
  const firstLine = initialPrompt?.split("\n", 1)[0]?.trim();
  return firstLine ? firstLine : null;
};

const toDurationMs = (createdAt: string | null, completedAt: string | null): number | null => {
  if (!createdAt || !completedAt) {
    return null;
  }
  const startedMs = Date.parse(createdAt);
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs)) {
    return null;
  }
  return completedMs - startedMs;
};

export const buildCompletionSummary = (
  input: BuildCompletionSummaryInput,
): TerminalCompletionSummary => {
  // Shared-mode terminals work on the primary checkout, so branch-relative git
  // facts would describe the whole repo rather than this terminal's task.
  const gitFacts =
    input.workspaceMode === "shared" || input.gitFacts === null ? EMPTY_GIT_FACTS : input.gitFacts;

  return {
    taskLine: toTaskLine(input.initialPrompt),
    commits: gitFacts.commits,
    filesChanged: gitFacts.filesChanged,
    insertions: gitFacts.insertions,
    deletions: gitFacts.deletions,
    branch: gitFacts.branch,
    merged: gitFacts.merged,
    durationMs: toDurationMs(input.createdAt, input.completedAt),
    workspaceMode: input.workspaceMode,
  };
};
