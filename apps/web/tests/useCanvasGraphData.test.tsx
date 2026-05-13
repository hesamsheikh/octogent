import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OCTOBOSS_ID, useCanvasGraphData } from "../src/app/hooks/useCanvasGraphData";
import type { TerminalView } from "../src/app/types";

type SlimNode = { id: string; type: string; tentacleId: string };
type SlimEdge = { source: string; target: string };

const GraphDataProbe = ({
  columns,
  enabled = true,
}: {
  columns: TerminalView;
  enabled?: boolean;
}) => {
  const { nodes, edges } = useCanvasGraphData({ columns, enabled });
  const slimNodes: SlimNode[] = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    tentacleId: n.tentacleId,
  }));
  const slimEdges: SlimEdge[] = edges.map((e) => ({ source: e.source, target: e.target }));
  return (
    <>
      <output aria-label="nodes">{JSON.stringify(slimNodes)}</output>
      <output aria-label="edges">{JSON.stringify(slimEdges)}</output>
    </>
  );
};

const emptyArrayResponse = () =>
  Promise.resolve(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

const makeDeckResponse = (tentacleId: string, displayName = tentacleId) =>
  Promise.resolve(
    new Response(
      JSON.stringify([
        {
          tentacleId,
          displayName,
          status: "active",
          color: null,
          scope: { paths: [], tags: [] },
          vaultFiles: [],
          todoItems: [],
          suggestedSkills: [],
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

describe("useCanvasGraphData", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/deck/tentacles")) return emptyArrayResponse();
      if (url.includes("/api/conversations")) return emptyArrayResponse();
      return emptyArrayResponse();
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("always produces an octoboss coordinator node regardless of columns or API data", () => {
    render(<GraphDataProbe columns={[]} />);

    const nodesEl = screen.getByLabelText("nodes");
    const nodes: SlimNode[] = JSON.parse(nodesEl.textContent ?? "[]");

    expect(nodes).toContainEqual({
      id: `t:${OCTOBOSS_ID}`,
      type: "octoboss",
      tentacleId: OCTOBOSS_ID,
    });
  });

  it("links terminals whose tentacleId is OCTOBOSS_ID to the octoboss node", () => {
    render(
      <GraphDataProbe
        columns={[
          {
            terminalId: "coordinator-1",
            label: "coordinator-1",
            state: "live",
            tentacleId: OCTOBOSS_ID,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    const nodes: SlimNode[] = JSON.parse(screen.getByLabelText("nodes").textContent ?? "[]");
    const edges: SlimEdge[] = JSON.parse(screen.getByLabelText("edges").textContent ?? "[]");

    expect(nodes).toContainEqual({
      id: "a:coordinator-1",
      type: "active-session",
      tentacleId: OCTOBOSS_ID,
    });
    expect(edges).toContainEqual({
      source: `t:${OCTOBOSS_ID}`,
      target: "a:coordinator-1",
    });
  });

  it("creates tentacle nodes from the deck API and connects them to octoboss", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/deck/tentacles")) return makeDeckResponse("web-ui", "Web UI");
      return emptyArrayResponse();
    });

    render(<GraphDataProbe columns={[]} />);

    await waitFor(() => {
      const nodes: SlimNode[] = JSON.parse(screen.getByLabelText("nodes").textContent ?? "[]");
      expect(nodes).toContainEqual({ id: "t:web-ui", type: "tentacle", tentacleId: "web-ui" });
    });

    const edges: SlimEdge[] = JSON.parse(screen.getByLabelText("edges").textContent ?? "[]");
    expect(edges).toContainEqual({ source: `t:${OCTOBOSS_ID}`, target: "t:web-ui" });
  });

  it("creates active-session nodes for terminals belonging to a deck tentacle", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/deck/tentacles")) return makeDeckResponse("web-ui");
      return emptyArrayResponse();
    });

    render(
      <GraphDataProbe
        columns={[
          {
            terminalId: "terminal-abc",
            label: "terminal-abc",
            state: "live",
            tentacleId: "web-ui",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    await waitFor(() => {
      const nodes: SlimNode[] = JSON.parse(screen.getByLabelText("nodes").textContent ?? "[]");
      expect(nodes).toContainEqual({
        id: "a:terminal-abc",
        type: "active-session",
        tentacleId: "web-ui",
      });
    });

    const edges: SlimEdge[] = JSON.parse(screen.getByLabelText("edges").textContent ?? "[]");
    expect(edges).toContainEqual({ source: "t:web-ui", target: "a:terminal-abc" });
  });

  it("edges connect parent terminal → child terminal rather than tentacle → child", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/deck/tentacles")) return makeDeckResponse("web-ui");
      return emptyArrayResponse();
    });

    render(
      <GraphDataProbe
        columns={[
          {
            terminalId: "parent-terminal",
            label: "parent-terminal",
            state: "live",
            tentacleId: "web-ui",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            terminalId: "child-terminal",
            label: "child-terminal",
            state: "live",
            tentacleId: "web-ui",
            parentTerminalId: "parent-terminal",
            createdAt: "2026-01-01T00:01:00.000Z",
          },
        ]}
      />,
    );

    await waitFor(() => {
      const edges: SlimEdge[] = JSON.parse(screen.getByLabelText("edges").textContent ?? "[]");
      expect(edges).toContainEqual({
        source: "a:parent-terminal",
        target: "a:child-terminal",
      });
    });

    const edges: SlimEdge[] = JSON.parse(screen.getByLabelText("edges").textContent ?? "[]");
    expect(edges).not.toContainEqual({
      source: "t:web-ui",
      target: "a:child-terminal",
    });
  });

  it("does not fetch or produce tentacle/session nodes when disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<GraphDataProbe columns={[]} enabled={false} />);

    // Give any async work a chance to run
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchSpy).not.toHaveBeenCalled();

    const nodes: SlimNode[] = JSON.parse(screen.getByLabelText("nodes").textContent ?? "[]");
    // Only the octoboss synthetic node should be present (it's always added synchronously)
    const tentacleNodes = nodes.filter((n) => n.type === "tentacle");
    expect(tentacleNodes).toHaveLength(0);
  });

  it("parent terminal without parentTerminalId edges from tentacle node", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/deck/tentacles")) return makeDeckResponse("web-ui");
      return emptyArrayResponse();
    });

    render(
      <GraphDataProbe
        columns={[
          {
            terminalId: "standalone-terminal",
            label: "standalone-terminal",
            state: "live",
            tentacleId: "web-ui",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    await waitFor(() => {
      const edges: SlimEdge[] = JSON.parse(screen.getByLabelText("edges").textContent ?? "[]");
      expect(edges).toContainEqual({
        source: "t:web-ui",
        target: "a:standalone-terminal",
      });
    });
  });
});
