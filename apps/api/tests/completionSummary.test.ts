import { describe, expect, it } from "vitest";

import {
  type RunGitCommand,
  buildCompletionSummary,
  collectCompletionGitFacts,
} from "../src/completionSummary";

const WORKTREE_CWD = "/tmp/worktrees/terminal-1";
const BASE_REF = "main";

type FakeGitResponses = {
  log?: string;
  shortstat?: string;
  branch?: string;
  isAncestor?: "yes" | "no" | Error;
};

const notAncestorError = () => {
  const error = new Error("git merge-base --is-ancestor exited with 1") as Error & {
    status: number;
  };
  error.status = 1;
  return error;
};

const createFakeRun = (
  responses: FakeGitResponses,
): { run: RunGitCommand; calls: Array<{ cwd: string; args: string[] }> } => {
  const calls: Array<{ cwd: string; args: string[] }> = [];
  const run: RunGitCommand = (cwd, args) => {
    calls.push({ cwd, args });
    switch (args[0]) {
      case "log":
        return responses.log ?? "";
      case "diff":
        return responses.shortstat ?? "";
      case "rev-parse":
        return responses.branch ?? "octogent/terminal-1";
      case "merge-base": {
        const outcome = responses.isAncestor ?? "no";
        if (outcome === "yes") {
          return "";
        }
        throw outcome === "no" ? notAncestorError() : outcome;
      }
      default:
        throw new Error(`Unexpected git command: ${args.join(" ")}`);
    }
  };
  return { run, calls };
};

describe("collectCompletionGitFacts", () => {
  it("collects commits, shortstat, branch, and merged state", () => {
    const { run, calls } = createFakeRun({
      log: "abc1234\tfeat(api): add health endpoint\ndef5678\tfix(api): count states",
      shortstat: " 3 files changed, 42 insertions(+), 7 deletions(-)",
      branch: "octogent/terminal-1",
      isAncestor: "yes",
    });

    const facts = collectCompletionGitFacts(WORKTREE_CWD, BASE_REF, run);

    expect(facts).toEqual({
      commits: [
        { hash: "abc1234", message: "feat(api): add health endpoint" },
        { hash: "def5678", message: "fix(api): count states" },
      ],
      filesChanged: 3,
      insertions: 42,
      deletions: 7,
      branch: "octogent/terminal-1",
      merged: true,
    });
    expect(calls.every((call) => call.cwd === WORKTREE_CWD)).toBe(true);
    expect(calls.map((call) => call.args)).toEqual([
      ["log", "--format=%h%x09%s", "main..HEAD"],
      ["diff", "--shortstat", "main...HEAD"],
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["merge-base", "--is-ancestor", "HEAD", "main"],
    ]);
  });

  it("reports merged=false when HEAD is not an ancestor of the base ref", () => {
    const { run } = createFakeRun({
      log: "abc1234\tfeat(api): add health endpoint",
      shortstat: " 1 file changed, 1 insertion(+)",
      isAncestor: "no",
    });

    const facts = collectCompletionGitFacts(WORKTREE_CWD, BASE_REF, run);

    expect(facts?.merged).toBe(false);
    expect(facts?.filesChanged).toBe(1);
    expect(facts?.insertions).toBe(1);
    expect(facts?.deletions).toBe(0);
  });

  it("returns empty commits and zero counts when the branch has no commits", () => {
    const { run } = createFakeRun({
      log: "",
      shortstat: "",
      isAncestor: "yes",
    });

    const facts = collectCompletionGitFacts(WORKTREE_CWD, BASE_REF, run);

    expect(facts).toEqual({
      commits: [],
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      branch: "octogent/terminal-1",
      merged: true,
    });
  });

  it("returns null when a git command fails", () => {
    const run: RunGitCommand = () => {
      throw new Error("fatal: not a git repository");
    };

    expect(collectCompletionGitFacts(WORKTREE_CWD, BASE_REF, run)).toBeNull();
  });

  it("returns null when the merged check fails for a reason other than not-ancestor", () => {
    const { run } = createFakeRun({
      log: "abc1234\tfeat(api): add health endpoint",
      isAncestor: new Error("fatal: bad revision 'HEAD'"),
    });

    expect(collectCompletionGitFacts(WORKTREE_CWD, BASE_REF, run)).toBeNull();
  });

  it("returns a null branch when HEAD is detached", () => {
    const { run } = createFakeRun({ branch: "HEAD", isAncestor: "no" });

    expect(collectCompletionGitFacts(WORKTREE_CWD, BASE_REF, run)?.branch).toBeNull();
  });
});

describe("buildCompletionSummary", () => {
  const gitFacts = {
    commits: [{ hash: "abc1234", message: "feat(api): add health endpoint" }],
    filesChanged: 2,
    insertions: 10,
    deletions: 3,
    branch: "octogent/terminal-1",
    merged: false,
  };

  it("assembles a summary from git facts and timestamps", () => {
    const summary = buildCompletionSummary({
      initialPrompt: "Implement the health endpoint",
      createdAt: "2026-08-30T10:00:00.000Z",
      completedAt: "2026-08-30T10:05:30.000Z",
      workspaceMode: "worktree",
      gitFacts,
    });

    expect(summary).toEqual({
      taskLine: "Implement the health endpoint",
      commits: gitFacts.commits,
      filesChanged: 2,
      insertions: 10,
      deletions: 3,
      branch: "octogent/terminal-1",
      merged: false,
      durationMs: 330_000,
      workspaceMode: "worktree",
    });
  });

  it("takes only the trimmed first line of a multi-line initial prompt", () => {
    const summary = buildCompletionSummary({
      initialPrompt: "  Fix the flaky monitor test  \nSecond line with details\nThird line",
      createdAt: null,
      completedAt: null,
      workspaceMode: "worktree",
      gitFacts,
    });

    expect(summary.taskLine).toBe("Fix the flaky monitor test");
  });

  it("returns a null task line when the initial prompt is missing or blank", () => {
    const base = {
      createdAt: null,
      completedAt: null,
      workspaceMode: "worktree" as const,
      gitFacts,
    };

    expect(buildCompletionSummary({ ...base, initialPrompt: null }).taskLine).toBeNull();
    expect(buildCompletionSummary({ ...base, initialPrompt: "   \n次の行" }).taskLine).toBeNull();
  });

  it("returns a null duration when either timestamp is missing or invalid", () => {
    const base = {
      initialPrompt: "task",
      workspaceMode: "worktree" as const,
      gitFacts,
    };

    expect(
      buildCompletionSummary({
        ...base,
        createdAt: null,
        completedAt: "2026-08-30T10:05:30.000Z",
      }).durationMs,
    ).toBeNull();
    expect(
      buildCompletionSummary({
        ...base,
        createdAt: "2026-08-30T10:00:00.000Z",
        completedAt: null,
      }).durationMs,
    ).toBeNull();
    expect(
      buildCompletionSummary({
        ...base,
        createdAt: "not-a-timestamp",
        completedAt: "2026-08-30T10:05:30.000Z",
      }).durationMs,
    ).toBeNull();
  });

  it("zeroes git-derived fields in shared workspace mode", () => {
    const summary = buildCompletionSummary({
      initialPrompt: "Shared mode task",
      createdAt: "2026-08-30T10:00:00.000Z",
      completedAt: "2026-08-30T10:01:00.000Z",
      workspaceMode: "shared",
      gitFacts,
    });

    expect(summary).toEqual({
      taskLine: "Shared mode task",
      commits: [],
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      branch: null,
      merged: false,
      durationMs: 60_000,
      workspaceMode: "shared",
    });
  });

  it("zeroes git-derived fields when git facts are unavailable", () => {
    const summary = buildCompletionSummary({
      initialPrompt: "Worktree task without git facts",
      createdAt: "2026-08-30T10:00:00.000Z",
      completedAt: "2026-08-30T10:01:00.000Z",
      workspaceMode: "worktree",
      gitFacts: null,
    });

    expect(summary.commits).toEqual([]);
    expect(summary.filesChanged).toBe(0);
    expect(summary.insertions).toBe(0);
    expect(summary.deletions).toBe(0);
    expect(summary.branch).toBeNull();
    expect(summary.merged).toBe(false);
  });
});
