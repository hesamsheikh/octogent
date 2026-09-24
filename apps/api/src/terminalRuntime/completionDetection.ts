import type { TentacleWorkspaceMode, TerminalLifecycleState } from "@octogent/core";

import {
  type CompletionGitFacts,
  type RunGitCommand,
  collectCompletionGitFacts,
} from "../completionSummary";

export type CompletionVerdict =
  | { outcome: "completed" | "awaiting-review"; gitFacts: CompletionGitFacts | null }
  | { outcome: "none" };

/**
 * Files Octogent itself drops into a worktree. They are never evidence of
 * unfinished work — but in a repository that does not ignore `.claude/`, the
 * hooks file showed up as `?? .claude/` on every Stop and kept Claude worktree
 * terminals from ever reaching awaiting-review (DiveoDevOps trial, 2026-09-05).
 * Octogent's own repo ignores `/.claude`, which is why self-tests never saw it.
 */
export const OCTOGENT_MANAGED_WORKTREE_PATHS: ReadonlySet<string> = new Set([
  ".claude/settings.json",
]);

const porcelainPath = (line: string): string => {
  // Porcelain v1: `XY path` or `XY old -> new`; quoted paths keep their quotes,
  // which only matters for names with special characters — not ours.
  const path = line.slice(3).trim();
  const arrow = path.indexOf(" -> ");
  return arrow === -1 ? path : path.slice(arrow + 4);
};

/** True when `git status --porcelain --untracked-files=all` lists anything Octogent did not put there. */
export const hasForeignWorktreeChanges = (statusOutput: string): boolean =>
  statusOutput
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .some((line) => !OCTOGENT_MANAGED_WORKTREE_PATHS.has(porcelainPath(line)));

/**
 * Decides, on a Stop hook, whether a terminal's work is finished.
 *
 * Claude fires Stop after every conversational turn, so the bar is
 * deliberately conservative for worktree terminals: only a clean tree with
 * commits beyond the base counts as done — anything else means the agent is
 * mid-task and the terminal stays as it is. Shared-mode workers are told not
 * to commit at all, so their Stop is taken at face value.
 */
export const evaluateCompletionOnStop = (input: {
  workspaceMode: TentacleWorkspaceMode;
  worktreeCwd: string | null;
  baseRef: string;
  run: RunGitCommand;
}): CompletionVerdict => {
  if (input.workspaceMode === "shared") {
    return { outcome: "completed", gitFacts: null };
  }

  if (!input.worktreeCwd) {
    return { outcome: "none" };
  }

  try {
    // File-level listing so Octogent's own files can be told apart from the
    // agent's; the default mode collapses an untracked `.claude/` to one line.
    const status = input.run(input.worktreeCwd, ["status", "--porcelain", "--untracked-files=all"]);
    if (hasForeignWorktreeChanges(status)) {
      return { outcome: "none" };
    }
  } catch {
    // Git being unavailable is not evidence of completion either way.
    return { outcome: "none" };
  }

  const gitFacts = collectCompletionGitFacts(input.worktreeCwd, input.baseRef, input.run);
  if (!gitFacts) {
    return { outcome: "none" };
  }

  // After the reviewer merges, `log base..HEAD` collapses to nothing because
  // HEAD became an ancestor of the base — the empty range is a consequence of
  // the merge, not evidence of no work. Merged therefore wins outright; only
  // an unmerged branch needs commits to prove the agent actually did anything.
  if (gitFacts.merged) {
    return { outcome: "completed", gitFacts };
  }

  if (gitFacts.commits.length === 0) {
    return { outcome: "none" };
  }

  return { outcome: "awaiting-review", gitFacts };
};

// Verdicts that must survive the live-PTY mirror. `stalled` belongs here too:
// the stall detector only ever fires while the PTY is alive, so mirroring it
// back to "running" hid every stall from snapshots (a reload showed four busy
// agents that had been silent for minutes). Activity already flips a stalled
// terminal back to running, so nothing else has to change.
const LIVE_SESSION_EXEMPT_STATES: ReadonlySet<TerminalLifecycleState> = new Set([
  "completed",
  "awaiting-review",
  "stalled",
]);

/**
 * Lifecycle state a snapshot should report.
 *
 * A live PTY normally means "running", but the PTY stays open after the agent
 * finishes; a completion verdict must survive that mirror or the UI would
 * flip straight back to running and hide it.
 */
export const resolveSnapshotLifecycle = (
  hasLiveSession: boolean,
  persisted: TerminalLifecycleState | undefined,
): TerminalLifecycleState => {
  if (hasLiveSession) {
    return persisted && LIVE_SESSION_EXEMPT_STATES.has(persisted) ? persisted : "running";
  }
  return persisted ?? "registered";
};
