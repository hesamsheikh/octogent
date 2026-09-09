import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GraphNode } from "../src/app/canvas/types";
import { SessionNode } from "../src/components/canvas/SessionNode";

const baseNode: GraphNode = {
  id: "a:terminal-1",
  type: "active-session",
  tentacleId: "tentacle-a",
  label: "worker one",
  color: "#00c8ff",
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  pinned: false,
  radius: 22,
  sessionId: "terminal-1",
  hasUserPrompt: true,
  workspaceMode: "worktree",
};

const renderNode = (overrides: Partial<GraphNode>) =>
  render(
    <svg role="img" aria-label="host">
      <title>host</title>
      <SessionNode
        node={{ ...baseNode, ...overrides }}
        isSelected={false}
        onPointerDown={vi.fn()}
        onClick={vi.fn()}
      />
    </svg>,
  );

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SessionNode completion states", () => {
  it("shows a DONE pill for a completed terminal", () => {
    renderNode({ agentState: "completed" });

    expect(screen.getByText("DONE")).toBeInTheDocument();
  });

  it("shows a REVIEW pill for work awaiting review", () => {
    renderNode({ agentState: "awaiting-review" });

    expect(screen.getByText("REVIEW")).toBeInTheDocument();
  });

  it("summarises the completion facts in the node tooltip", () => {
    renderNode({
      agentState: "awaiting-review",
      completionSummary: {
        taskLine: "实现归档",
        commits: [{ hash: "abc123", message: "feat: archive" }],
        filesChanged: 3,
        insertions: 40,
        deletions: 5,
        branch: "octogent/terminal-1",
        merged: false,
        durationMs: 90_000,
        workspaceMode: "worktree",
      },
    });

    const titles = Array.from(document.querySelectorAll("title"));
    const title = titles[titles.length - 1];
    expect(title?.textContent).toContain("1 commit");
    expect(title?.textContent).toContain("+40/-5");
    expect(title?.textContent).toContain("octogent/terminal-1");
  });

  it("keeps a plain running node pill-free", () => {
    renderNode({ agentState: "live" });

    expect(screen.queryByText("DONE")).not.toBeInTheDocument();
    expect(screen.queryByText("REVIEW")).not.toBeInTheDocument();
  });
});
