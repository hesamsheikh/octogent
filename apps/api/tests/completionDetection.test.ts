import { describe, expect, it } from "vitest";

import type { RunGitCommand } from "../src/completionSummary";
import {
  evaluateCompletionOnStop,
  resolveSnapshotLifecycle,
} from "../src/terminalRuntime/completionDetection";

// A scripted git: maps "subcommand" prefixes to canned outputs or throwers.
const scriptedRun = (script: Record<string, string | (() => string)>): RunGitCommand => {
  return (_cwd, args) => {
    const key = args.join(" ");
    for (const [prefix, result] of Object.entries(script)) {
      if (key.startsWith(prefix)) {
        return typeof result === "function" ? result() : result;
      }
    }
    throw new Error(`unscripted git call: ${key}`);
  };
};

const notAncestor = () => {
  const error = new Error("not an ancestor") as Error & { status: number };
  error.status = 1;
  throw error;
};

describe("evaluateCompletionOnStop", () => {
  it("treats a shared-mode stop as completed with no git facts", () => {
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "shared",
      worktreeCwd: null,
      baseRef: "main",
      run: scriptedRun({}),
    });

    expect(verdict).toEqual({ outcome: "completed", gitFacts: null });
  });

  it("marks clean committed unmerged work as awaiting review", () => {
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: "/wt",
      baseRef: "main",
      run: scriptedRun({
        "status --porcelain": "",
        log: "abc123\tfeat: do the thing",
        diff: " 2 files changed, 10 insertions(+), 1 deletion(-)",
        "rev-parse --abbrev-ref HEAD": "octogent/terminal-9\n",
        "merge-base --is-ancestor": notAncestor,
      }),
    });

    expect(verdict.outcome).toBe("awaiting-review");
    if (verdict.outcome === "awaiting-review") {
      expect(verdict.gitFacts?.commits).toHaveLength(1);
      expect(verdict.gitFacts?.merged).toBe(false);
    }
  });

  it("marks merged work as completed", () => {
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: "/wt",
      baseRef: "main",
      run: scriptedRun({
        "status --porcelain": "",
        log: "abc123\tfeat: done",
        diff: " 1 file changed, 2 insertions(+)",
        "rev-parse --abbrev-ref HEAD": "octogent/terminal-9\n",
        "merge-base --is-ancestor": "",
      }),
    });

    expect(verdict.outcome).toBe("completed");
  });

  it("stays undecided while the worktree is dirty", () => {
    // Claude stops after every turn; uncommitted files mean the agent is
    // mid-task, and flagging that as done would fire on every conversation.
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: "/wt",
      baseRef: "main",
      run: scriptedRun({ "status --porcelain": " M src/thing.ts\n" }),
    });

    expect(verdict).toEqual({ outcome: "none" });
  });

  it("stays undecided with no commits beyond the base", () => {
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: "/wt",
      baseRef: "main",
      run: scriptedRun({
        "status --porcelain": "",
        log: "",
        diff: "",
        "rev-parse --abbrev-ref HEAD": "octogent/terminal-9\n",
        "merge-base --is-ancestor": notAncestor,
      }),
    });

    expect(verdict).toEqual({ outcome: "none" });
  });

  it("reads completed for an already-merged branch even with an empty range", () => {
    // After the reviewer merges, HEAD becomes an ancestor of the base and
    // `log base..HEAD` is empty. That emptiness is a consequence of the merge,
    // not evidence of no work — the verdict must still flip to completed.
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: "/wt",
      baseRef: "main",
      run: scriptedRun({
        "status --porcelain": "",
        log: "",
        diff: "",
        "rev-parse --abbrev-ref HEAD": "octogent/terminal-9\n",
        "merge-base --is-ancestor": "",
      }),
    });

    expect(verdict.outcome).toBe("completed");
  });

  it("stays undecided when git itself fails", () => {
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: "/wt",
      baseRef: "main",
      run: () => {
        throw new Error("git exploded");
      },
    });

    expect(verdict).toEqual({ outcome: "none" });
  });

  it("stays undecided for a worktree terminal without a worktree path", () => {
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: null,
      baseRef: "main",
      run: scriptedRun({}),
    });

    expect(verdict).toEqual({ outcome: "none" });
  });
});

describe("evaluateCompletionOnStop and Octogent's own worktree files", () => {
  const committedUnmerged = {
    log: "abc123\tfeat: do the thing",
    diff: " 2 files changed, 10 insertions(+), 1 deletion(-)",
    "rev-parse --abbrev-ref HEAD": "octogent/terminal-9\n",
    "merge-base --is-ancestor": notAncestor,
  };

  it("ignores the hooks file Octogent wrote into the worktree", () => {
    // The trial-run repo did not ignore `.claude/`, so this line appeared on
    // every Stop and no Claude worktree terminal ever reached awaiting-review.
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: "/wt",
      baseRef: "main",
      run: scriptedRun({
        "status --porcelain --untracked-files=all": "?? .claude/settings.json\n",
        ...committedUnmerged,
      }),
    });

    expect(verdict.outcome).toBe("awaiting-review");
  });

  it("still treats the agent's own uncommitted files as unfinished work", () => {
    const verdict = evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: "/wt",
      baseRef: "main",
      run: scriptedRun({
        "status --porcelain --untracked-files=all": "?? .claude/settings.json\n M src/app.ts\n",
        ...committedUnmerged,
      }),
    });

    expect(verdict).toEqual({ outcome: "none" });
  });

  it("asks git for a file-level listing so the managed file is not hidden inside `.claude/`", () => {
    const calls: string[] = [];
    evaluateCompletionOnStop({
      workspaceMode: "worktree",
      worktreeCwd: "/wt",
      baseRef: "main",
      run: (_cwd, args) => {
        calls.push(args.join(" "));
        return scriptedRun({ status: "", ...committedUnmerged })(_cwd, args);
      },
    });

    expect(calls[0]).toBe("status --porcelain --untracked-files=all");
  });
});

describe("resolveSnapshotLifecycle", () => {
  it("reports running while a live session exists", () => {
    expect(resolveSnapshotLifecycle(true, "registered")).toBe("running");
    expect(resolveSnapshotLifecycle(true, undefined)).toBe("running");
  });

  it("lets a completion verdict survive the live-session mirror", () => {
    // The PTY stays open after the agent finishes; without this exemption the
    // snapshot would flip straight back to running and hide the verdict.
    expect(resolveSnapshotLifecycle(true, "completed")).toBe("completed");
    expect(resolveSnapshotLifecycle(true, "awaiting-review")).toBe("awaiting-review");
  });

  it("lets a stall verdict survive the live-session mirror", () => {
    // Stalls are only ever detected on live PTYs; masking them as running made
    // a silent agent look busy on every reload.
    expect(resolveSnapshotLifecycle(true, "stalled")).toBe("stalled");
  });

  it("falls back to the persisted state without a session", () => {
    expect(resolveSnapshotLifecycle(false, "stopped")).toBe("stopped");
    expect(resolveSnapshotLifecycle(false, undefined)).toBe("registered");
  });
});
