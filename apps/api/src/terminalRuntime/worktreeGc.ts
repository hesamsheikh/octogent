import { type RunGitCommand, isExitCode } from "../completionSummary";
import { hasForeignWorktreeChanges } from "./completionDetection";
import type { TentacleWorkspaceMode, TerminalLifecycleState } from "./types";

export type WorktreeGcRecord = {
  workspaceMode: TentacleWorkspaceMode;
  archivedAt?: string | undefined;
  lifecycleState?: TerminalLifecycleState | undefined;
  completionSummary?: { merged: boolean } | undefined;
};

/**
 * What git says right now about a worktree: `merged` when its HEAD is already
 * an ancestor of the base ref and nothing is left uncommitted, `unmerged` when
 * it carries commits or changes the base does not have, `unknown` when git
 * could not answer (worktree gone, not a repository).
 */
export type LiveMergeVerdict = "merged" | "unmerged" | "unknown";

export const resolveLiveMergeVerdict = (
  worktreeCwd: string,
  baseRef: string,
  run: RunGitCommand,
): LiveMergeVerdict => {
  try {
    const status = run(worktreeCwd, ["status", "--porcelain", "--untracked-files=all"]);
    if (hasForeignWorktreeChanges(status)) {
      // Uncommitted work is not merged anywhere; treat it like unmerged commits.
      return "unmerged";
    }
    run(worktreeCwd, ["merge-base", "--is-ancestor", "HEAD", baseRef]);
    return "merged";
  } catch (error) {
    return isExitCode(error, 1) ? "unmerged" : "unknown";
  }
};

/**
 * Decides whether an archived terminal record's worktree may be reclaimed
 * (worktree directory and branch deleted).
 *
 * Iron rule: work that never merged into the base branch must not be deleted
 * by any automated path. Git is asked at gc time and its answer wins in both
 * directions: a live `merged` reclaims a branch whose record never learned of
 * the merge (a stalled record whose branch the operator merged by hand), and
 * a live `unmerged` protects a branch that grew new commits after its summary
 * said merged. Only when git cannot answer do the recorded signals count — a
 * `completed` lifecycle verdict or an explicit `merged: true` completion
 * summary. Everything else, including `awaiting-review`, stays on disk.
 */
export const shouldReclaimWorktree = (
  record: WorktreeGcRecord,
  liveVerdict: LiveMergeVerdict = "unknown",
): boolean => {
  if (record.workspaceMode !== "worktree") {
    return false;
  }

  if (!record.archivedAt) {
    return false;
  }

  if (liveVerdict === "unmerged") {
    return false;
  }
  if (liveVerdict === "merged") {
    return true;
  }

  return record.lifecycleState === "completed" || record.completionSummary?.merged === true;
};
