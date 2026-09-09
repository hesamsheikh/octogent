import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasPrimaryView } from "../src/components/CanvasPrimaryView";
import { renderWithLocale } from "./test-utils/renderWithLocale";

type MockCanvasNode = {
  id: string;
  type: "tentacle" | "active-session";
  tentacleId: string;
  label: string;
  color: string;
  x: number;
  y: number;
  radius: number;
  sessionId?: string;
  agentState?: "live";
  agentRuntimeState?: "idle";
  hasUserPrompt?: boolean;
  workspaceMode?: "shared";
  parentTerminalId?: string;
};

const nodes: MockCanvasNode[] = [
  {
    id: "t:tentacle-a",
    type: "tentacle" as const,
    tentacleId: "tentacle-a",
    label: "tentacle-a",
    color: "#ff6b2b",
    x: 80,
    y: 80,
    radius: 28,
  },
  {
    id: "a:terminal-1",
    type: "active-session" as const,
    sessionId: "terminal-1",
    tentacleId: "tentacle-a",
    label: "terminal-1",
    color: "#ff6b2b",
    x: 120,
    y: 120,
    radius: 20,
    agentState: "live" as const,
    agentRuntimeState: "idle" as const,
    hasUserPrompt: true,
    workspaceMode: "shared" as const,
  },
];

vi.mock("../src/app/hooks/useAgentRuntimeStates", () => ({
  useAgentRuntimeStates: () => new Map(),
}));

vi.mock("../src/app/hooks/useCanvasGraphData", () => ({
  useCanvasGraphData: () => ({
    nodes,
    edges: [],
    tentacleById: new Map(),
    sessionsByTentacleId: new Map(),
    refresh: vi.fn(),
    refreshDeckTentacles: vi.fn(),
  }),
}));

vi.mock("../src/app/hooks/useCanvasTransform", () => ({
  useCanvasTransform: () => ({
    transform: { translateX: 0, translateY: 0, scale: 1 },
    isPanning: false,
    svgRef: { current: null },
    handleWheel: vi.fn(),
    handlePointerDown: vi.fn(),
    handlePointerMove: vi.fn(),
    handlePointerUp: vi.fn(),
    screenToGraph: () => ({ x: 0, y: 0 }),
    fitAll: vi.fn(),
  }),
}));

vi.mock("../src/app/hooks/useForceSimulation", () => ({
  DEFAULT_FORCE_PARAMS: {},
  useForceSimulation: ({ nodes: nextNodes }: { nodes: typeof nodes }) => ({
    simulatedNodes: nextNodes,
    pinNode: vi.fn(),
    unpinNode: vi.fn(),
    moveNode: vi.fn(),
    reheat: vi.fn(),
  }),
}));

vi.mock("../src/components/canvas/SessionNode", () => ({
  SessionNode: ({
    node,
    onClick,
  }: {
    node: (typeof nodes)[number];
    onClick: (nodeId: string) => void;
  }) => (
    <button type="button" data-node-id={node.id} onClick={() => onClick(node.id)}>
      {node.label}
    </button>
  ),
}));

vi.mock("../src/components/canvas/OctopusNode", () => ({
  OctopusNode: ({
    node,
    onClick,
  }: {
    node: (typeof nodes)[number];
    onClick: (nodeId: string) => void;
  }) => (
    <g
      data-node-id={node.id}
      onClick={() => onClick(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          onClick(node.id);
        }
      }}
    >
      <circle cx={node.x} cy={node.y} r={node.radius} />
      <title>{node.label}</title>
    </g>
  ),
}));

vi.mock("../src/components/canvas/CanvasTerminalColumn", () => ({
  CanvasTerminalColumn: ({
    node,
    panelRef,
    onClose,
  }: {
    node: (typeof nodes)[number];
    panelRef?: ((element: HTMLElement | null) => void) | undefined;
    onClose?: () => void;
  }) => (
    <section ref={panelRef} data-testid={`panel-${node.id}`} tabIndex={-1}>
      panel {node.id} label {node.label}
      <button type="button" onClick={onClose}>
        Close terminal panel
      </button>
    </section>
  ),
}));

vi.mock("../src/components/canvas/CanvasTentaclePanel", () => ({
  CanvasTentaclePanel: () => null,
}));

describe("CanvasPrimaryView", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    nodes.splice(2);
    vi.restoreAllMocks();
  });

  it("reveals and focuses a newly opened terminal panel when a session node is clicked", async () => {
    renderWithLocale(<CanvasPrimaryView columns={[]} isUiStateHydrated />);

    const [terminalButton] = screen.getAllByRole("button", { name: "terminal-1" });
    expect(terminalButton).toBeDefined();
    if (!terminalButton) throw new Error("Missing terminal button");

    fireEvent.click(terminalButton);

    await waitFor(() => {
      expect(screen.getByTestId("panel-a:terminal-1")).toBeInTheDocument();
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(HTMLElement.prototype.focus).toHaveBeenCalledTimes(1);
    });
  });

  it("collapses a terminal panel without ending the agent behind it", async () => {
    renderWithLocale(
      <CanvasPrimaryView
        columns={[
          {
            terminalId: "terminal-1",
            label: "terminal-1",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "terminal one",
            workspaceMode: "shared",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]}
        isUiStateHydrated
      />,
    );

    const [terminalButton] = screen.getAllByRole("button", { name: "terminal-1" });
    expect(terminalButton).toBeDefined();
    if (!terminalButton) throw new Error("Missing terminal button");

    fireEvent.click(terminalButton);
    await waitFor(() => {
      expect(screen.getByTestId("panel-a:terminal-1")).toBeInTheDocument();
    });

    // The panel control hides the window only: an operator watching several
    // agents must be able to put one away without destroying its worktree.
    fireEvent.click(screen.getByRole("button", { name: "Close terminal panel" }));
    expect(screen.queryByTestId("panel-a:terminal-1")).not.toBeInTheDocument();

    // Same toggle as the tentacle nodes: clicking the node brings it back.
    fireEvent.click(terminalButton);
    await waitFor(() => {
      expect(screen.getByTestId("panel-a:terminal-1")).toBeInTheDocument();
    });
  });

  it("keeps a panel closed after the operator collapses a restored one", async () => {
    renderWithLocale(
      <CanvasPrimaryView
        columns={[
          {
            terminalId: "terminal-1",
            label: "terminal-1",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "terminal one",
            workspaceMode: "shared",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]}
        isUiStateHydrated
        canvasOpenTerminalIds={["a:terminal-1"]}
      />,
    );

    // The panel comes back from persisted ui state on load, behind a settling timer.
    await waitFor(
      () => {
        expect(screen.getByTestId("panel-a:terminal-1")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Close terminal panel" }));

    // Restoring must not fight the operator: the persisted id list still names
    // this panel, so a re-running restore would reopen what was just closed.
    expect(screen.queryByTestId("panel-a:terminal-1")).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("panel-a:terminal-1")).not.toBeInTheDocument();
  });

  it("auto-opens a newly created child terminal when its parent panel is already open", async () => {
    const { rerender } = renderWithLocale(
      <CanvasPrimaryView
        columns={[
          {
            terminalId: "terminal-1",
            label: "terminal-1",
            state: "live",
            tentacleId: "tentacle-a",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]}
        isUiStateHydrated
      />,
    );

    const [terminalButton] = screen.getAllByRole("button", { name: "terminal-1" });
    expect(terminalButton).toBeDefined();
    if (!terminalButton) throw new Error("Missing terminal button");

    fireEvent.click(terminalButton);

    await waitFor(() => {
      expect(screen.getByTestId("panel-a:terminal-1")).toBeInTheDocument();
    });

    nodes.push({
      id: "a:terminal-2",
      type: "active-session" as const,
      sessionId: "terminal-2",
      tentacleId: "tentacle-a",
      label: "terminal-2",
      color: "#ff6b2b",
      x: 160,
      y: 160,
      radius: 20,
      agentState: "live" as const,
      agentRuntimeState: "idle" as const,
      hasUserPrompt: true,
      workspaceMode: "shared" as const,
      parentTerminalId: "terminal-1",
    });

    rerender(
      <CanvasPrimaryView
        columns={[
          {
            terminalId: "terminal-1",
            label: "terminal-1",
            state: "live",
            tentacleId: "tentacle-a",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
          {
            terminalId: "terminal-2",
            label: "terminal-2",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "tentacle-a",
            parentTerminalId: "terminal-1",
            workspaceMode: "shared",
            createdAt: "2026-02-24T10:05:00.000Z",
            hasUserPrompt: true,
          },
        ]}
        isUiStateHydrated
        recentlyCreatedTerminal={{
          terminalId: "terminal-2",
          label: "terminal-2",
          state: "live",
          tentacleId: "tentacle-a",
          tentacleName: "tentacle-a",
          parentTerminalId: "terminal-1",
          workspaceMode: "shared",
          createdAt: "2026-02-24T10:05:00.000Z",
          hasUserPrompt: true,
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("panel-a:terminal-2")).toBeInTheDocument();
    });
  });

  it("updates an open terminal panel label when the terminal is renamed", async () => {
    const { rerender } = renderWithLocale(
      <CanvasPrimaryView
        columns={[
          {
            terminalId: "terminal-1",
            label: "terminal-1",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "tentacle-a",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]}
        isUiStateHydrated
      />,
    );

    const [terminalButton] = screen.getAllByRole("button", { name: "terminal-1" });
    expect(terminalButton).toBeDefined();
    if (!terminalButton) throw new Error("Missing terminal button");

    fireEvent.click(terminalButton);

    await waitFor(() => {
      expect(screen.getByTestId("panel-a:terminal-1")).toHaveTextContent(
        "panel a:terminal-1 label tentacle-a",
      );
    });

    rerender(
      <CanvasPrimaryView
        columns={[
          {
            terminalId: "terminal-1",
            label: "terminal-1",
            state: "live",
            tentacleId: "tentacle-a",
            tentacleName: "renamed-tentacle",
            createdAt: "2026-02-24T10:00:00.000Z",
          },
        ]}
        isUiStateHydrated
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("panel-a:terminal-1")).toHaveTextContent(
        "panel a:terminal-1 label renamed-tentacle",
      );
    });
  });

  it("shows tentacle maintenance actions in the context menu and passes the tentacle ID", async () => {
    const onTentacleAction = vi.fn().mockResolvedValue(undefined);

    const { container } = renderWithLocale(
      <CanvasPrimaryView columns={[]} isUiStateHydrated onTentacleAction={onTentacleAction} />,
    );

    const tentacleNode = container.querySelector('[data-node-id="t:tentacle-a"]');
    expect(tentacleNode).not.toBeNull();

    fireEvent.contextMenu(tentacleNode as Element, { clientX: 160, clientY: 120 });

    expect(await screen.findByRole("button", { name: "Update To-Do List" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update Tentacle" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update To-Do List" }));

    await waitFor(() => {
      expect(onTentacleAction).toHaveBeenCalledWith("tentacle-a", "tentacle-reorganize-todos");
    });
  });
});
