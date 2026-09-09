import { describe, expect, it } from "vitest";

import { tentacleColor } from "../src/app/fleetColors";
import {
  buildFlowLayout,
  computeActiveNodeIds,
  flowEdgeColor,
  isFlowTrunkEdge,
  project,
} from "../src/app/flow/layout";
import type { FlowCamera } from "../src/app/flow/layout";

type AnyTentacle = Parameters<typeof buildFlowLayout>[0]["tentacles"][number];
type AnyTerminal = Parameters<typeof buildFlowLayout>[0]["terminals"][number];

const tentacle = (id: string): AnyTentacle =>
  ({
    tentacleId: id,
    displayName: id,
    description: "",
    status: "idle",
    color: "#00c8ff",
    todoTotal: 3,
    todoDone: 1,
  }) as AnyTentacle;

const terminal = (id: string, tentacleId: string, parentTerminalId?: string): AnyTerminal =>
  ({
    terminalId: id,
    label: id,
    state: "live",
    tentacleId,
    tentacleName: id,
    workspaceMode: "worktree",
    createdAt: "2026-08-31T00:00:00.000Z",
    ...(parentTerminalId ? { parentTerminalId } : {}),
  }) as AnyTerminal;

describe("flow colors", () => {
  it("colors tentacles the way the canvas does: deck color, else a per-id palette color", () => {
    const uncolored = (id: string) => ({ ...tentacle(id), color: null }) as AnyTentacle;
    const { nodes } = buildFlowLayout({
      tentacles: [uncolored("api"), uncolored("web"), tentacle("ops")],
      terminals: [],
    });

    const colorOf = (id: string) => nodes.find((n) => n.refId === id)?.color;
    expect(colorOf("api")).toBe(tentacleColor("api"));
    expect(colorOf("web")).toBe(tentacleColor("web"));
    expect(colorOf("api")).not.toBe(colorOf("web"));
    expect(colorOf("ops")).toBe("#00c8ff");
    // None of them borrow the octoboss color.
    for (const id of ["api", "web", "ops"]) {
      expect(colorOf(id)).not.toBe(nodes[0]?.color);
    }
  });

  it("gives every link the color of its tentacle, trunk links included", () => {
    const layout = buildFlowLayout({
      tentacles: [{ ...tentacle("api"), color: null } as AnyTentacle],
      terminals: [terminal("t-1", "api")],
    });
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const expected = tentacleColor("api");

    for (const edge of layout.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) throw new Error("dangling edge");
      expect(flowEdgeColor(from, to)).toBe(expected);
      expect(isFlowTrunkEdge(from)).toBe(from.kind === "octoboss");
    }
    const trunkCount = layout.edges.filter((e) => {
      const from = byId.get(e.from);
      return from !== undefined && isFlowTrunkEdge(from);
    }).length;
    expect(trunkCount).toBe(1);
  });
});

describe("flow agent providers", () => {
  it("carries each agent's provider and model onto its node", () => {
    const codex = { ...terminal("t-1", "api"), agentProvider: "codex", agentModel: "gpt-5.6-sol" };
    const claude = { ...terminal("t-2", "api"), agentProvider: "claude-code" };
    const { nodes } = buildFlowLayout({
      tentacles: [tentacle("api")],
      terminals: [codex as AnyTerminal, claude as AnyTerminal],
    });

    expect(nodes.find((n) => n.refId === "t-1")).toMatchObject({
      agentProvider: "codex",
      agentModel: "gpt-5.6-sol",
    });
    expect(nodes.find((n) => n.refId === "t-2")).toMatchObject({ agentProvider: "claude-code" });
    expect(nodes.find((n) => n.refId === "t-2")?.agentModel).toBeUndefined();
  });

  it("lists the distinct providers of a tentacle's agents, live ones first", () => {
    const live1 = { ...terminal("t-1", "api"), agentProvider: "codex" };
    const live2 = { ...terminal("t-2", "api"), agentProvider: "codex" };
    const shelved = { ...terminal("t-3", "api"), state: "stopped", agentProvider: "claude-code" };
    const { nodes } = buildFlowLayout({
      tentacles: [tentacle("api"), tentacle("web")],
      terminals: [live1 as AnyTerminal, live2 as AnyTerminal, shelved as AnyTerminal],
    });

    const api = nodes.find((n) => n.kind === "tentacle" && n.refId === "api");
    const web = nodes.find((n) => n.kind === "tentacle" && n.refId === "web");
    expect(api?.agentProviders).toEqual(["codex", "claude-code"]);
    expect(web?.agentProviders).toBeUndefined();
  });
});

describe("computeActiveNodeIds", () => {
  const runtime = (entries: Record<string, "idle" | "processing">) =>
    new Map(Object.entries(entries).map(([id, state]) => [id, { state }]));

  it("lights the path from a processing agent up to the octoboss", () => {
    const layout = buildFlowLayout({
      tentacles: [tentacle("api")],
      terminals: [terminal("t-1", "api")],
      agentRuntimeStates: runtime({ "t-1": "processing" }),
    });

    const active = computeActiveNodeIds(layout);
    expect(active.has("flow:agent:t-1")).toBe(true);
    expect(active.has(layout.nodes.find((n) => n.kind === "tentacle")?.id ?? "")).toBe(true);
    expect(active.has(layout.nodes[0]?.id ?? "")).toBe(true);
  });

  it("stops flowing once the agent goes idle, even though its PTY is still live", () => {
    // The agent finished its turn; lifecycle still says "live" because the
    // terminal is open. The canvas already treats this as quiet.
    const layout = buildFlowLayout({
      tentacles: [tentacle("api")],
      terminals: [terminal("t-1", "api")],
      agentRuntimeStates: runtime({ "t-1": "idle" }),
    });

    expect(computeActiveNodeIds(layout).size).toBe(0);
  });

  it("does not flow for an agent whose runtime state is unknown", () => {
    const layout = buildFlowLayout({
      tentacles: [tentacle("api")],
      terminals: [terminal("t-1", "api")],
    });

    expect(computeActiveNodeIds(layout).size).toBe(0);
  });

  it("never flows toward a settled agent, whatever the runtime store says", () => {
    const review = { ...terminal("t-1", "api"), state: "awaiting-review" } as AnyTerminal;
    const stalled = { ...terminal("t-2", "api"), state: "stalled" } as AnyTerminal;
    const layout = buildFlowLayout({
      tentacles: [tentacle("api")],
      terminals: [review, stalled],
      agentRuntimeStates: runtime({ "t-1": "processing", "t-2": "processing" }),
    });

    expect(computeActiveNodeIds(layout).size).toBe(0);
  });
});

describe("buildFlowLayout", () => {
  it("always roots the layout at the octoboss on level 0", () => {
    const { nodes } = buildFlowLayout({ tentacles: [], terminals: [] });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "octoboss", level: 0 });
  });

  it("spreads tentacles on level 1, connected to the octoboss", () => {
    const { nodes, edges } = buildFlowLayout({
      tentacles: [tentacle("api"), tentacle("web")],
      terminals: [],
    });

    const tentacleNodes = nodes.filter((n) => n.kind === "tentacle");
    expect(tentacleNodes).toHaveLength(2);
    for (const n of tentacleNodes) {
      expect(n.level).toBe(1);
      expect(edges).toContainEqual({ from: nodes[0]?.id, to: n.id });
    }
    // Same level, distinct vertical slots.
    expect(new Set(tentacleNodes.map((n) => n.y)).size).toBe(2);
  });

  it("demotes finished, not-reused terminals to the bottom shelf", () => {
    const stopped = { ...terminal("t-dead", "api"), state: "stopped" } as AnyTerminal;
    const { nodes } = buildFlowLayout({
      tentacles: [tentacle("api")],
      terminals: [terminal("t-live", "api"), stopped],
    });

    const agents = nodes.filter((n) => n.kind === "agent");
    expect(agents.map((n) => n.refId).sort()).toEqual(["t-dead", "t-live"]);
    const live = agents.find((n) => n.refId === "t-live");
    const shelved = agents.find((n) => n.refId === "t-dead");
    // The shelved node sits below the live one and is detached from the tree.
    expect(shelved && live && shelved.y).toBeGreaterThan(live?.y ?? 0);
    expect(shelved?.z).toBe(0);
  });

  it("fans agents out in front of their tentacle, one level deeper", () => {
    const { nodes, edges } = buildFlowLayout({
      tentacles: [tentacle("api")],
      terminals: [terminal("t-1", "api"), terminal("t-2", "api")],
    });

    const host = nodes.find((n) => n.kind === "tentacle");
    const agents = nodes.filter((n) => n.kind === "agent");
    expect(agents).toHaveLength(2);
    for (const agent of agents) {
      expect(agent.level).toBe(2);
      // In front of the octopus: strictly closer to the viewer than its host.
      expect(agent.z).toBeGreaterThan(host?.z ?? 0);
      expect(edges).toContainEqual({ from: host?.id, to: agent.id });
    }
  });

  it("chains swarm workers one level behind their parent agent", () => {
    const { nodes, edges } = buildFlowLayout({
      tentacles: [tentacle("mini")],
      terminals: [
        terminal("mini-swarm-parent", "mini"),
        terminal("mini-swarm-0", "mini", "mini-swarm-parent"),
        terminal("mini-swarm-1", "mini", "mini-swarm-parent"),
      ],
    });

    const parent = nodes.find((n) => n.refId === "mini-swarm-parent");
    const workers = nodes.filter((n) => n.refId?.startsWith("mini-swarm-") && n !== parent);
    expect(parent?.level).toBe(2);
    for (const worker of workers) {
      expect(worker.level).toBe(3);
      expect(edges).toContainEqual({ from: parent?.id, to: worker.id });
    }
  });

  it("attaches an orphaned child to its tentacle instead of dropping it", () => {
    const { nodes, edges } = buildFlowLayout({
      tentacles: [tentacle("api")],
      terminals: [terminal("lost", "api", "gone-parent")],
    });

    const orphan = nodes.find((n) => n.refId === "lost");
    const host = nodes.find((n) => n.kind === "tentacle");
    expect(orphan?.level).toBe(2);
    expect(edges).toContainEqual({ from: host?.id, to: orphan?.id });
  });

  it("keeps levels advancing left to right", () => {
    const { nodes } = buildFlowLayout({
      tentacles: [tentacle("mini")],
      terminals: [terminal("p", "mini"), terminal("w", "mini", "p")],
    });

    const byLevel = new Map<number, number>();
    for (const n of nodes) {
      byLevel.set(n.level, n.x);
    }
    expect(byLevel.get(1)).toBeGreaterThan(byLevel.get(0) ?? 0);
    expect(byLevel.get(2)).toBeGreaterThan(byLevel.get(1) ?? 0);
    expect(byLevel.get(3)).toBeGreaterThan(byLevel.get(2) ?? 0);
  });
});

describe("card data on nodes", () => {
  it("marks a parent agent as coordinator and counts its children", () => {
    const { nodes } = buildFlowLayout({
      tentacles: [tentacle("mini")],
      terminals: [terminal("p", "mini"), terminal("w1", "mini", "p"), terminal("w2", "mini", "p")],
    });

    const parent = nodes.find((n) => n.refId === "p");
    const worker = nodes.find((n) => n.refId === "w1");
    expect(parent?.role).toBe("coordinator");
    expect(parent?.childCount).toBe(2);
    expect(worker?.role).toBe("worker");
  });

  it("carries tentacle description and todo items through to the node", () => {
    const rich = {
      ...tentacle("api"),
      description: "负责 API 层",
      todoItems: [
        { text: "第一项", done: true },
        { text: "第二项", done: false },
      ],
    } as AnyTentacle;
    const { nodes } = buildFlowLayout({ tentacles: [rich], terminals: [] });

    const node = nodes.find((n) => n.kind === "tentacle");
    expect(node?.description).toBe("负责 API 层");
    expect(node?.todoItems).toHaveLength(2);
  });

  it("injects live runtime state and tool onto agent nodes", () => {
    const { nodes } = buildFlowLayout({
      tentacles: [tentacle("api")],
      terminals: [terminal("t-1", "api")],
      agentRuntimeStates: new Map([["t-1", { state: "processing" as const, toolName: "Bash" }]]),
    });

    const node = nodes.find((n) => n.refId === "t-1");
    expect(node?.runtimeState).toBe("processing");
    expect(node?.runtimeToolName).toBe("Bash");
  });
});

describe("project", () => {
  const camera: FlowCamera = { panX: 0, panY: 0, zoom: 1, perspective: 900 };

  it("is identity-ish at the viewer plane", () => {
    const p = project({ x: 100, y: 50, z: 0 }, camera);
    expect(p.sx).toBeCloseTo(100);
    expect(p.sy).toBeCloseTo(50);
    expect(p.scale).toBeCloseTo(1);
  });

  it("shrinks and converges points that sit deeper", () => {
    const near = project({ x: 200, y: 0, z: 0 }, camera);
    const far = project({ x: 200, y: 0, z: -600 }, camera);
    expect(far.scale).toBeLessThan(near.scale);
    // Deeper content drifts toward the vanishing point, not off-screen.
    expect(Math.abs(far.sx)).toBeLessThan(Math.abs(near.sx) + 1);
  });

  it("applies pan after projection so dragging moves the whole scene", () => {
    const base = project({ x: 10, y: 10, z: -300 }, camera);
    const panned = project({ x: 10, y: 10, z: -300 }, { ...camera, panX: 40, panY: -25 });
    expect(panned.sx - base.sx).toBeCloseTo(40);
    expect(panned.sy - base.sy).toBeCloseTo(-25);
    expect(panned.scale).toBeCloseTo(base.scale);
  });

  it("scales around the origin with zoom", () => {
    const z1 = project({ x: 100, y: 100, z: 0 }, camera);
    const z2 = project({ x: 100, y: 100, z: 0 }, { ...camera, zoom: 2 });
    expect(z2.sx).toBeCloseTo(z1.sx * 2);
    expect(z2.sy).toBeCloseTo(z1.sy * 2);
  });
});
