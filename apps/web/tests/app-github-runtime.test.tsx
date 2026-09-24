import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { jsonResponse, notFoundResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

const buildRecentCommits = () =>
  Array.from({ length: 50 }, (_, index) => {
    const offset = index + 1;
    const day = String(Math.max(1, 27 - index)).padStart(2, "0");
    return {
      hash: `hash-${offset.toString(16).padStart(40, "a")}`,
      shortHash: `short${offset}`,
      subject: `recent commit ${offset}`,
      authorName: "Hesam Sheikh",
      authorEmail: "hesam@example.com",
      authoredAt: `2026-02-${day}T10:12:00.000Z`,
      body: `body for commit ${offset}`,
      filesChanged: offset + 1,
      insertions: offset * 10,
      deletions: offset * 2,
    };
  });

const mockGithubRuntimeRequests = () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/terminal-snapshots") && method === "GET") {
      return jsonResponse([]);
    }

    if (url.endsWith("/api/codex/usage") && method === "GET") {
      return jsonResponse({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-02-27T12:00:00.000Z",
      });
    }

    if (url.endsWith("/api/claude/usage") && method === "GET") {
      return jsonResponse({
        status: "unavailable",
        source: "none",
        fetchedAt: "2026-02-27T12:00:00.000Z",
      });
    }

    if (url.includes("/api/analytics/usage-heatmap") && method === "GET") {
      return jsonResponse({
        days: [],
        projects: [],
        models: [],
      });
    }

    if (url.endsWith("/api/github/summary") && method === "GET") {
      return jsonResponse({
        status: "ok",
        source: "gh-cli",
        fetchedAt: "2026-02-27T12:00:00.000Z",
        repo: "hesamsheikh/octogent",
        stargazerCount: 42,
        openIssueCount: 7,
        openPullRequestCount: 3,
        commitsPerDay: [
          { date: "2026-02-25", count: 4 },
          { date: "2026-02-26", count: 6 },
          { date: "2026-02-27", count: 8 },
        ],
        recentCommits: buildRecentCommits(),
      });
    }

    if (url.endsWith("/api/ui-state") && method === "GET") {
      return jsonResponse({ locale: "en" });
    }

    return notFoundResponse();
  });
};

describe("App GitHub runtime views", () => {
  afterEach(() => {
    cleanup();
    resetAppTestHarness();
  });

  it("renders github repo metrics in the runtime status strip", async () => {
    mockGithubRuntimeRequests();

    const { container } = render(<App />);

    const strip = await screen.findByLabelText("Runtime status strip");
    expect(within(strip).getByText("COMMITS/DAY · LAST 30 DAYS")).toBeInTheDocument();

    const sparkline = container.querySelector(".console-status-sparkline polyline");
    expect(sparkline).not.toBeNull();
    expect(sparkline?.getAttribute("points")).not.toBe("");
  });

  it("renders the Activity view with the GitHub overview graph", async () => {
    mockGithubRuntimeRequests();

    const { container } = render(<App />);
    // The shell first paints in the product default language and only switches
    // once the persisted ui state arrives, so wait for the hydrated label.
    fireEvent.click(
      await screen.findByRole("button", {
        name: "[4] Activity",
      }),
    );

    expect(await screen.findByLabelText("Activity primary view")).toBeInTheDocument();
    const githubView = await screen.findByLabelText("GitHub primary view");
    expect(within(githubView).getByText("hesamsheikh/octogent")).toBeInTheDocument();
    expect(
      within(githubView).getByRole("button", { name: "Refresh GitHub overview data" }),
    ).toBeInTheDocument();
    expect(within(githubView).getByText("Recent commits")).toBeInTheDocument();
    expect(within(githubView).getByText("Showing last 50 commits")).toBeInTheDocument();
    expect(within(githubView).getByText("recent commit 1")).toBeInTheDocument();
    expect(within(githubView).getByText("recent commit 50")).toBeInTheDocument();
    expect(within(githubView).getAllByRole("listitem")).toHaveLength(50);

    const graphPoint = container.querySelector(
      ".github-overview-graph-point[aria-label='2026-02-27 · 8 commits']",
    );
    expect(graphPoint).not.toBeNull();
    expect(container.querySelectorAll(".github-overview-graph-point")).toHaveLength(3);
    fireEvent.mouseEnter(graphPoint as Element);

    const hoverMeta = container.querySelector(".github-overview-graph-meta span");
    expect(hoverMeta).not.toBeNull();
    expect(hoverMeta).toHaveTextContent("2026-02-27 · 8 commits");

    const graphSvg = container.querySelector(
      ".github-overview-graph-surface svg",
    ) as SVGElement | null;
    expect(graphSvg).not.toBeNull();
    if (!graphSvg) {
      return;
    }

    vi.spyOn(graphSvg, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 40,
      top: 40,
      left: 100,
      right: 740,
      bottom: 220,
      width: 640,
      height: 180,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(graphSvg, { clientX: 738 });
    expect(hoverMeta).toHaveTextContent("2026-02-27 · 8 commits");
    const graphTooltip = container.querySelector(".github-overview-graph-tooltip");
    expect(graphTooltip).not.toBeNull();
    expect(graphTooltip).toHaveTextContent("2026-02-27 · 8 commits");
  });
});
