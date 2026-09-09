import type { DeckTentacleSummary } from "@octogent/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { normalizeDeckTentacleSummary } from "../app/deckNormalizers";
import {
  type FlowCamera,
  type FlowNode,
  LIFECYCLE_SHELF_AGENT_STATES,
  buildFlowLayout,
  computeActiveNodeIds,
  computeFitCamera,
  flowEdgeColor,
  isFlowTrunkEdge,
  project,
} from "../app/flow/layout";
import { useAgentRuntimeStates } from "../app/hooks/useAgentRuntimeStates";
import { useT } from "../app/providers/LocaleProvider";
import type { TerminalRuntimeStateStore } from "../app/terminalRuntimeStateStore";
import type { TerminalView } from "../app/types";
import { buildDeckTentaclesUrl } from "../runtime/runtimeEndpoints";
import { OctopusGlyph } from "./EmptyOctopus";
import { FlowNodeCard } from "./flow/FlowNodeCard";

type FlowPrimaryViewProps = {
  columns: TerminalView;
  deckRevision?: number;
  runtimeStateStore: TerminalRuntimeStateStore;
  onOpenTerminal?: (terminalId: string) => void;
};

const INITIAL_CAMERA: FlowCamera = { panX: 320, panY: 300, zoom: 1, perspective: 900 };
// Tentacle todo progress changes on disk without any server broadcast, so the
// card narration needs a low-cost fallback poll on top of deck events.
const TENTACLES_POLL_INTERVAL_MS = 30_000;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.2;

const agentDotClass = (node: FlowNode): string => {
  switch (node.agentState) {
    case "completed":
      return "flow-agent-dot--done";
    case "awaiting-review":
      return "flow-agent-dot--review";
    case "stalled":
    case "stale":
      return "flow-agent-dot--attention";
    case "stopped":
    case "exited":
      return "flow-agent-dot--inactive";
    default:
      return "flow-agent-dot--live";
  }
};

export const FlowPrimaryView = ({
  columns,
  deckRevision,
  runtimeStateStore,
  onOpenTerminal,
}: FlowPrimaryViewProps) => {
  const t = useT();
  const [tentacles, setTentacles] = useState<DeckTentacleSummary[]>([]);

  useEffect(() => {
    // deckRevision is the refetch trigger: the server bumps it on deck changes.
    void deckRevision;
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch(buildDeckTentaclesUrl(), {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as unknown;
        if (disposed || !Array.isArray(payload)) return;
        setTentacles(
          payload
            .map((entry) => normalizeDeckTentacleSummary(entry))
            .filter((entry): entry is DeckTentacleSummary => entry !== null),
        );
      } catch {
        // The view stays on its last good data.
      }
    };
    void load();
    const pollTimer = window.setInterval(() => {
      void load();
    }, TENTACLES_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(pollTimer);
    };
  }, [deckRevision]);
  const [camera, setCamera] = useState<FlowCamera>(INITIAL_CAMERA);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );
  const viewRef = useRef<HTMLElement | null>(null);
  const hasUserAdjustedCameraRef = useRef(false);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const measure = () => {
      const rect = view.getBoundingClientRect();
      setViewSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    return () => observer.disconnect();
  }, []);

  const agentRuntimeStates = useAgentRuntimeStates(runtimeStateStore, columns);
  const layout = useMemo(
    () => buildFlowLayout({ tentacles, terminals: columns, agentRuntimeStates }),
    [tentacles, columns, agentRuntimeStates],
  );

  // Keep the whole fleet framed and centered until the operator takes over the
  // camera — the fixed default clipped the outermost octopus on larger fleets.
  useLayoutEffect(() => {
    if (hasUserAdjustedCameraRef.current || layout.nodes.length === 0) {
      return;
    }
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const rect = view.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    setCamera(computeFitCamera(layout.nodes, { width: rect.width, height: rect.height }));
  }, [layout]);

  const projected = useMemo(() => {
    const map = new Map<string, { sx: number; sy: number; scale: number }>();
    for (const node of layout.nodes) {
      map.set(node.id, project(node, camera));
    }
    return map;
  }, [layout, camera]);

  // Nearer nodes render on top; the sort also keeps DOM order stable enough
  // for hover to feel consistent.
  const paintOrder = useMemo(() => [...layout.nodes].sort((a, b) => a.z - b.z), [layout]);

  // Edges on a path down to a working agent flow with a traveling dot, so the
  // flow view shows "who is busy" the way the canvas does.
  const activeNodeIds = useMemo(() => computeActiveNodeIds(layout), [layout]);
  const nodesById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node] as const)),
    [layout],
  );

  const activeCardId = pinnedId ?? hoveredId;
  const activeNode = activeCardId
    ? (layout.nodes.find((n) => n.id === activeCardId) ?? null)
    : null;
  const activeProjection = activeNode ? projected.get(activeNode.id) : null;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        panX: camera.panX,
        panY: camera.panY,
      };
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    [camera.panX, camera.panY],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    hasUserAdjustedCameraRef.current = true;
    setCamera((current) => ({
      ...current,
      panX: drag.panX + (event.clientX - drag.startX),
      panY: drag.panY + (event.clientY - drag.startY),
    }));
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    hasUserAdjustedCameraRef.current = true;
    setCamera((current) => {
      const nextZoom = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, current.zoom * (event.deltaY < 0 ? 1.1 : 0.9)),
      );
      return { ...current, zoom: nextZoom };
    });
  }, []);

  return (
    <section
      ref={viewRef}
      className="flow-view"
      aria-label={t("web.a11y.flowView")}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <svg className="flow-links" aria-hidden="true">
        {layout.edges.map((edge) => {
          const from = projected.get(edge.from);
          const to = projected.get(edge.to);
          const fromNode = nodesById.get(edge.from);
          const toNode = nodesById.get(edge.to);
          if (!from || !to || !fromNode || !toNode) return null;
          const midX = (from.sx + to.sx) / 2;
          const d = `M ${from.sx} ${from.sy} C ${midX} ${from.sy}, ${midX} ${to.sy}, ${to.sx} ${to.sy}`;
          const isActive = activeNodeIds.has(edge.to);
          const color = flowEdgeColor(fromNode, toNode);
          const className = [
            "flow-link",
            isFlowTrunkEdge(fromNode) ? "flow-link--trunk" : "",
            isActive ? "flow-link--active" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <g key={`${edge.from}->${edge.to}`} style={{ color }}>
              <path className={className} d={d} />
              {isActive && (
                <circle className="flow-link-pulse" r={3.5}>
                  <animateMotion dur="1.1s" repeatCount="indefinite" path={d} />
                </circle>
              )}
            </g>
          );
        })}
      </svg>

      {paintOrder.map((node) => {
        const p = projected.get(node.id);
        if (!p) return null;
        const style: React.CSSProperties = {
          transform: `translate(-50%, -50%) translate(${p.sx}px, ${p.sy}px) scale(${p.scale})`,
          zIndex: 10 + Math.round(p.scale * 100),
        };
        const isShelved = node.agentState
          ? LIFECYCLE_SHELF_AGENT_STATES.has(node.agentState)
          : false;
        return (
          <button
            key={node.id}
            type="button"
            className={`flow-node flow-node--${node.kind}${isShelved ? " flow-node--shelved" : ""}`}
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerEnter={() => setHoveredId(node.id)}
            onPointerLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
            onClick={(event) => {
              event.stopPropagation();
              setPinnedId((current) => (current === node.id ? null : node.id));
            }}
          >
            {node.kind === "agent" ? (
              // Shelved agents keep their bright fleet color instead of the
              // gray inactive dot, so a finished round stays legible.
              <span
                className={`flow-agent-dot ${agentDotClass(node)}`}
                style={isShelved ? { background: node.color, color: node.color } : undefined}
              />
            ) : (
              <OctopusGlyph
                color={node.color}
                animation={node.kind === "octoboss" ? "walk" : "idle"}
                expression="happy"
                accessory="none"
                scale={node.kind === "octoboss" ? 5 : 4}
              />
            )}
            <span className="flow-node-label">{node.label}</span>
          </button>
        );
      })}

      {activeNode &&
        activeProjection &&
        (() => {
          // Open the card away from whichever viewport edge it would overflow —
          // a shelf node near the bottom flips it upward instead of clipping.
          const CARD_WIDTH = 240;
          const CARD_HEIGHT = 260;
          const openLeft =
            viewSize.width > 0 && activeProjection.sx > viewSize.width - CARD_WIDTH - 40;
          const openUp = viewSize.height > 0 && activeProjection.sy > viewSize.height - CARD_HEIGHT;
          const tx = openLeft ? activeProjection.sx - CARD_WIDTH - 26 : activeProjection.sx + 26;
          const ty = openUp ? activeProjection.sy - CARD_HEIGHT : activeProjection.sy - 12;
          return (
            <div
              className="flow-card-anchor"
              style={{ transform: `translate(${tx}px, ${ty}px)`, zIndex: 400 }}
            >
              <FlowNodeCard node={activeNode} onOpenTerminal={onOpenTerminal} />
            </div>
          );
        })()}

      <p className="flow-hint">{t("web.flow.hint")}</p>
    </section>
  );
};
