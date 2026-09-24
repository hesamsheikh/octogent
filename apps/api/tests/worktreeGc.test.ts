import { describe, expect, it } from "vitest";

import type { RunGitCommand } from "../src/completionSummary";
import { resolveLiveMergeVerdict, shouldReclaimWorktree } from "../src/terminalRuntime/worktreeGc";

const mergedSummary = { merged: true };
const unmergedSummary = { merged: false };

const archived = "2026-08-01T00:00:00.000Z";

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

const gitExit = (status: number) => () => {
  const error = new Error(`git exited ${status}`) as Error & { status: number };
  error.status = status;
  throw error;
};

describe("resolveLiveMergeVerdict", () => {
  it("reports merged when HEAD is an ancestor of the base and the tree is clean", () => {
    const run = scriptedRun({ status: "", "merge-base --is-ancestor": "" });
    expect(resolveLiveMergeVerdict("/wt", "main", run)).toBe("merged");
  });

  it("reports unmerged when the branch has commits the base lacks", () => {
    const run = scriptedRun({ status: "", "merge-base --is-ancestor": gitExit(1) });
    expect(resolveLiveMergeVerdict("/wt", "main", run)).toBe("unmerged");
  });

  it("reports unmerged when the agent left uncommitted work behind", () => {
    const run = scriptedRun({ status: " M src/app.ts\n", "merge-base --is-ancestor": "" });
    expect(resolveLiveMergeVerdict("/wt", "main", run)).toBe("unmerged");
  });

  it("ignores Octogent's own hooks file when judging cleanliness", () => {
    const run = scriptedRun({
      status: "?? .claude/settings.json\n",
      "merge-base --is-ancestor": "",
    });
    expect(resolveLiveMergeVerdict("/wt", "main", run)).toBe("merged");
  });

  it("reports unknown when git cannot answer", () => {
    expect(resolveLiveMergeVerdict("/wt", "main", scriptedRun({ status: gitExit(128) }))).toBe(
      "unknown",
    );
  });
});

describe("shouldReclaimWorktree with a live git verdict", () => {
  it("reclaims an archived stalled record whose branch git says is merged", () => {
    // The record never learned of the merge (Claude's Stop verdict was
    // blocked), but the operator merged the branch by hand.
    expect(
      shouldReclaimWorktree(
        { workspaceMode: "worktree", archivedAt: archived, lifecycleState: "stalled" },
        "merged",
      ),
    ).toBe(true);
  });

  it("refuses when git says unmerged even if the record claims merged", () => {
    expect(
      shouldReclaimWorktree(
        {
          workspaceMode: "worktree",
          archivedAt: archived,
          lifecycleState: "completed",
          completionSummary: mergedSummary,
        },
        "unmerged",
      ),
    ).toBe(false);
  });

  it("falls back to the recorded signals when git cannot answer", () => {
    expect(
      shouldReclaimWorktree(
        { workspaceMode: "worktree", archivedAt: archived, lifecycleState: "completed" },
        "unknown",
      ),
    ).toBe(true);
    expect(
      shouldReclaimWorktree(
        { workspaceMode: "worktree", archivedAt: archived, lifecycleState: "stalled" },
        "unknown",
      ),
    ).toBe(false);
  });

  it("still requires an archived worktree record, whatever git says", () => {
    expect(
      shouldReclaimWorktree({ workspaceMode: "worktree", lifecycleState: "stalled" }, "merged"),
    ).toBe(false);
    expect(
      shouldReclaimWorktree(
        { workspaceMode: "shared", archivedAt: archived, lifecycleState: "completed" },
        "merged",
      ),
    ).toBe(false);
  });
});

describe("shouldReclaimWorktree", () => {
  it("reclaims an archived worktree record whose lifecycle is completed", () => {
    expect(
      shouldReclaimWorktree({
        workspaceMode: "worktree",
        archivedAt: "2026-08-01T00:00:00.000Z",
        lifecycleState: "completed",
      }),
    ).toBe(true);
  });

  it("reclaims an archived worktree record whose summary says merged", () => {
    for (const lifecycleState of ["stopped", "exited"] as const) {
      expect(
        shouldReclaimWorktree({
          workspaceMode: "worktree",
          archivedAt: "2026-08-01T00:00:00.000Z",
          lifecycleState,
          completionSummary: mergedSummary,
        }),
      ).toBe(true);
    }
  });

  it("never reclaims shared-mode records, even completed and archived", () => {
    expect(
      shouldReclaimWorktree({
        workspaceMode: "shared",
        archivedAt: "2026-08-01T00:00:00.000Z",
        lifecycleState: "completed",
        completionSummary: mergedSummary,
      }),
    ).toBe(false);
  });

  it("never reclaims a record that is not archived", () => {
    expect(
      shouldReclaimWorktree({
        workspaceMode: "worktree",
        lifecycleState: "completed",
        completionSummary: mergedSummary,
      }),
    ).toBe(false);
  });

  it("never reclaims awaiting-review records: unmerged work must survive", () => {
    expect(
      shouldReclaimWorktree({
        workspaceMode: "worktree",
        archivedAt: "2026-08-01T00:00:00.000Z",
        lifecycleState: "awaiting-review",
      }),
    ).toBe(false);
    expect(
      shouldReclaimWorktree({
        workspaceMode: "worktree",
        archivedAt: "2026-08-01T00:00:00.000Z",
        lifecycleState: "awaiting-review",
        completionSummary: unmergedSummary,
      }),
    ).toBe(false);
  });

  it("never reclaims archived stopped/exited records without proof of a merge", () => {
    for (const lifecycleState of ["stopped", "exited", "stale", "registered"] as const) {
      expect(
        shouldReclaimWorktree({
          workspaceMode: "worktree",
          archivedAt: "2026-08-01T00:00:00.000Z",
          lifecycleState,
          completionSummary: unmergedSummary,
        }),
      ).toBe(false);
      expect(
        shouldReclaimWorktree({
          workspaceMode: "worktree",
          archivedAt: "2026-08-01T00:00:00.000Z",
          lifecycleState,
        }),
      ).toBe(false);
    }
  });

  it("never reclaims a record with no lifecycle state and no summary", () => {
    expect(
      shouldReclaimWorktree({
        workspaceMode: "worktree",
        archivedAt: "2026-08-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});
