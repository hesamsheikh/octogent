import { useMemo } from "react";

import type { GraphNode } from "../../app/canvas/types";

const LINE_MAX = 24;
const PILL_HEIGHT = 16;
const PILL_RX = 8;
const PILL_CHAR_WIDTH = 5.5;
const PILL_PADDING = 14;
const PILL_MAX_CHARS = 14;

const splitLabel = (label: string): [string] | [string, string] => {
  if (label.length <= LINE_MAX) return [label];
  // Try to break at a space near the midpoint
  const mid = Math.floor(label.length / 2);
  let best = -1;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === " " && (best === -1 || Math.abs(i - mid) < Math.abs(best - mid))) {
      best = i;
    }
  }
  if (best > 0 && best < label.length - 1) {
    const line1 = label.slice(0, best);
    let line2 = label.slice(best + 1);
    if (line2.length > LINE_MAX) line2 = `${line2.slice(0, LINE_MAX - 1)}…`;
    return [line1.length > LINE_MAX ? `${line1.slice(0, LINE_MAX - 1)}…` : line1, line2];
  }
  return [
    `${label.slice(0, LINE_MAX - 1)}…`,
    label.slice(LINE_MAX - 1, LINE_MAX * 2 - 2) + (label.length > LINE_MAX * 2 - 2 ? "…" : ""),
  ];
};

const truncateToolName = (name: string): string => {
  if (name.length <= PILL_MAX_CHARS) return name;
  return `${name.slice(0, PILL_MAX_CHARS - 1)}…`;
};

type SessionNodeProps = {
  node: GraphNode;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onClick: (nodeId: string) => void;
};

export const SessionNode = ({ node, isSelected, onPointerDown, onClick }: SessionNodeProps) => {
  const isActive = node.type === "active-session" && node.hasUserPrompt !== false;
  const isLive = isActive && node.agentState === "live";
  const isWaiting =
    node.agentRuntimeState === "waiting_for_permission" ||
    node.agentRuntimeState === "waiting_for_user";
  const isLifecycleAttention =
    node.agentState === "stale" ||
    node.agentState === "stalled" ||
    node.agentState === "exited" ||
    node.agentState === "stopped" ||
    node.agentState === "awaiting-review";
  const isCompleted = node.agentState === "completed";
  const color = isActive ? node.color : "#9ca3af";
  const isWorktree = node.workspaceMode === "worktree" && !node.parentTerminalId;
  const isSwarmWorker = !!node.parentTerminalId;
  const lines = useMemo(() => splitLabel(node.label), [node.label]);

  const pillLabel = useMemo(() => {
    if (node.agentRuntimeState === "waiting_for_permission") {
      return node.waitingToolName ? truncateToolName(node.waitingToolName) : "PERMISSION";
    }
    if (node.agentRuntimeState === "waiting_for_user") {
      return "WAITING";
    }
    if (node.agentState === "stale") {
      return "STALE";
    }
    if (node.agentState === "stalled") {
      return "STALLED";
    }
    if (node.agentState === "exited") {
      return "EXITED";
    }
    if (node.agentState === "stopped") {
      return "STOPPED";
    }
    if (node.agentState === "awaiting-review") {
      return "REVIEW";
    }
    if (node.agentState === "completed") {
      return "DONE";
    }
    return "";
  }, [node.agentRuntimeState, node.agentState, node.waitingToolName]);

  const pillWidth = pillLabel.length * PILL_CHAR_WIDTH + PILL_PADDING;
  const pillY = node.radius + 4;
  const labelYOffset = isWaiting || isLifecycleAttention || isCompleted ? PILL_HEIGHT + 6 : 0;

  return (
    <g
      className={`canvas-node canvas-node--session${isSelected ? " canvas-node--selected" : ""}${isActive ? " canvas-node--active" : " canvas-node--inactive"}`}
      data-node-id={node.id}
      transform={`translate(${node.x}, ${node.y})`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onPointerDown(e, node.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(node.id);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onClick(node.id);
      }}
      style={{ cursor: "pointer" }}
    >
      {node.completionSummary && (
        <title>
          {[
            node.completionSummary.taskLine,
            `${node.completionSummary.commits.length} commit${node.completionSummary.commits.length === 1 ? "" : "s"} · +${node.completionSummary.insertions}/-${node.completionSummary.deletions}`,
            node.completionSummary.branch
              ? `${node.completionSummary.branch}${node.completionSummary.merged ? " ✓merged" : ""}`
              : null,
          ]
            .filter(Boolean)
            .join("\n")}
        </title>
      )}

      {/* Worktree ring — dashed stroke */}
      {isWorktree && (
        <circle
          className="canvas-node-ring canvas-node-ring--worktree"
          r={node.radius + 6}
          fill="none"
          stroke={color}
        />
      )}

      {/* Swarm worker ring — double concentric circles */}
      {isSwarmWorker && (
        <>
          <circle
            className="canvas-node-ring canvas-node-ring--swarm"
            r={node.radius + 5}
            fill="none"
            stroke={color}
          />
          <circle
            className="canvas-node-ring canvas-node-ring--swarm-outer"
            r={node.radius + 9}
            fill="none"
            stroke={color}
          />
        </>
      )}

      {/* Focused shine — accent glow when waiting, white otherwise */}
      {isSelected && (
        <circle
          className="canvas-node-focus-glow"
          r={node.radius + 12}
          fill={isWaiting || isLifecycleAttention ? "#f59e0b" : "#ffffff"}
        />
      )}

      {/* Subtle glow halo — accent when waiting */}
      <circle
        className={`canvas-node-bloom${isLive || isWaiting || isLifecycleAttention ? " canvas-node-bloom--pulse" : ""}`}
        r={node.radius + 3}
        fill={isWaiting || isLifecycleAttention ? "#f59e0b" : color}
        opacity={isWaiting || isLifecycleAttention ? 0.45 : isActive ? 0.25 : 0.1}
      />

      {/* Bright core dot — accent when waiting */}
      <circle
        className="canvas-node-core"
        r={node.radius}
        fill={isWaiting || isLifecycleAttention ? "#f59e0b" : isCompleted ? "#22c55e" : color}
        opacity={isCompleted ? 0.55 : isActive ? 1 : 0.4}
      />

      {/* State indicator pill */}
      {(isWaiting || isLifecycleAttention || isCompleted) && (
        <g
          className={`canvas-node-waiting-indicator${isCompleted ? " canvas-node-waiting-indicator--done" : ""}`}
        >
          <rect
            className="canvas-node-waiting-pill"
            x={-pillWidth / 2}
            y={pillY}
            width={pillWidth}
            height={PILL_HEIGHT}
            rx={PILL_RX}
          />
          <text
            className="canvas-node-waiting-label"
            y={pillY + PILL_HEIGHT / 2 + 3.5}
            textAnchor="middle"
          >
            {pillLabel}
          </text>
        </g>
      )}

      {/* Label — always visible, up to two lines */}
      <text
        y={node.radius + 16 + labelYOffset}
        textAnchor="middle"
        className="canvas-node-label canvas-node-label--session canvas-node-label--always"
        fill="var(--accent-primary)"
      >
        <tspan x="0" dy="0">
          {lines[0]}
        </tspan>
        {lines[1] && (
          <tspan x="0" dy="1.2em">
            {lines[1]}
          </tspan>
        )}
      </text>
    </g>
  );
};
