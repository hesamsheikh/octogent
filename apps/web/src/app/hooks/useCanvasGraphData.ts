import { useCallback, useEffect, useRef, useState } from "react";

import type { DeckTentacleSummary } from "@octogent/core";
import { buildConversationsUrl, buildDeckTentaclesUrl } from "../../runtime/runtimeEndpoints";
import type { GraphEdge, GraphNode } from "../canvas/types";
import { normalizeConversationSessionSummary } from "../conversationNormalizers";
import { normalizeDeckTentacleSummary } from "../deckNormalizers";
import { tentacleColor } from "../fleetColors";
import type { ConversationSessionSummary, TerminalView } from "../types";
import type { AgentRuntimeStateInfo } from "./useAgentRuntimeStates";

const TENTACLE_RADIUS = 40;
const ACTIVE_SESSION_RADIUS = 12;
const INACTIVE_SESSION_RADIUS = 10;

const OCTOBOSS_RADIUS = 52;
export const OCTOBOSS_ID = "__octoboss__";
const OCTOBOSS_NODE_ID = `t:${OCTOBOSS_ID}`;

const getAccentPrimary = (): string =>
  (typeof document !== "undefined"
    ? getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim()
    : "") || "#d4a017";

type UseCanvasGraphDataOptions = {
  columns: TerminalView;
  enabled: boolean;
  agentRuntimeStates?: Map<string, AgentRuntimeStateInfo>;
};

type UseCanvasGraphDataResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tentacleById: ReadonlyMap<string, DeckTentacleSummary>;
  sessionsByTentacleId: ReadonlyMap<string, ConversationSessionSummary[]>;
  refresh: () => Promise<void>;
  refreshDeckTentacles: () => Promise<void>;
};

const buildTentacleNodeId = (tentacleId: string) => `t:${tentacleId}`;
const buildActiveSessionNodeId = (agentId: string) => `a:${agentId}`;
const buildInactiveSessionNodeId = (sessionId: string) => `i:${sessionId}`;

export const useCanvasGraphData = ({
  columns,
  enabled,
  agentRuntimeStates,
}: UseCanvasGraphDataOptions): UseCanvasGraphDataResult => {
  const [deckTentacles, setDeckTentacles] = useState<DeckTentacleSummary[]>([]);
  const [inactiveSessions, setInactiveSessions] = useState<ConversationSessionSummary[]>([]);
  const prevNodesRef = useRef<Map<string, GraphNode>>(new Map());

  const fetchDeckTentacles = useCallback(async () => {
    try {
      const response = await fetch(buildDeckTentaclesUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) return;
      const items = payload
        .map((entry) => normalizeDeckTentacleSummary(entry))
        .filter((entry): entry is DeckTentacleSummary => entry !== null);
      setDeckTentacles(items);
    } catch {
      // silent
    }
  }, []);

  const fetchInactiveSessions = useCallback(async () => {
    try {
      const response = await fetch(buildConversationsUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as unknown;
      const normalized = Array.isArray(payload)
        ? payload
            .map((entry) => normalizeConversationSessionSummary(entry))
            .filter((entry): entry is ConversationSessionSummary => entry !== null)
        : [];
      setInactiveSessions(normalized);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setDeckTentacles([]);
      setInactiveSessions([]);
      return;
    }
    void fetchDeckTentacles();
    void fetchInactiveSessions();
  }, [enabled, fetchDeckTentacles, fetchInactiveSessions]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchDeckTentacles(), fetchInactiveSessions()]);
  }, [fetchDeckTentacles, fetchInactiveSessions]);
  const refreshDeckTentacles = useCallback(async () => {
    await fetchDeckTentacles();
  }, [fetchDeckTentacles]);

  const activeTerminalIds = new Set(columns.map((terminal) => terminal.terminalId));

  // Build a map of deck tentacles for color/label lookup
  const deckMap = new Map<string, DeckTentacleSummary>();
  for (const dt of deckTentacles) {
    deckMap.set(dt.tentacleId, dt);
  }

  const sessionsByTentacleId = new Map<string, ConversationSessionSummary[]>();
  for (const session of inactiveSessions) {
    if (!session.tentacleId) {
      continue;
    }
    const tentacleSessions = sessionsByTentacleId.get(session.tentacleId);
    if (tentacleSessions) {
      tentacleSessions.push(session);
    } else {
      sessionsByTentacleId.set(session.tentacleId, [session]);
    }
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const prevNodes = prevNodesRef.current;
  const currentNodesById = new Map<string, GraphNode>();
  const seenTentacleIds = new Set<string>();

  // Build a map of active terminals by tentacleId (multiple terminals can share a tentacle)
  const activeTerminalsByTentacle = new Map<string, TerminalView>();
  for (const terminal of columns) {
    const group = activeTerminalsByTentacle.get(terminal.tentacleId);
    if (group) {
      group.push(terminal);
    } else {
      activeTerminalsByTentacle.set(terminal.tentacleId, [terminal]);
    }
  }

  // Build tentacle list: only deck tentacles (sandbox and other non-deck
  // terminals are excluded from the graph).
  const allTentacleIds: string[] = [];
  for (const dt of deckTentacles) {
    allTentacleIds.push(dt.tentacleId);
    seenTentacleIds.add(dt.tentacleId);
  }

  const totalTentacles = allTentacleIds.length;

  for (let i = 0; i < allTentacleIds.length; i++) {
    const tentacleId = allTentacleIds[i];
    if (!tentacleId) continue;
    const tentacleNodeId = buildTentacleNodeId(tentacleId);
    const prev = prevNodes.get(tentacleNodeId);
    const deck = deckMap.get(tentacleId);
    const activeTerminals = activeTerminalsByTentacle.get(tentacleId);
    const firstActiveTerminal = activeTerminals?.[0];
    const color = tentacleColor(tentacleId, deck?.color);
    const label = deck?.displayName ?? firstActiveTerminal?.tentacleName ?? tentacleId;

    const angle = (2 * Math.PI * i) / Math.max(totalTentacles, 1);
    const spread = 300;

    const node: GraphNode = {
      id: tentacleNodeId,
      type: "tentacle",
      x: prev?.x ?? Math.cos(angle) * spread,
      y: prev?.y ?? Math.sin(angle) * spread,
      vx: prev?.vx ?? 0,
      vy: prev?.vy ?? 0,
      pinned: prev?.pinned ?? false,
      radius: TENTACLE_RADIUS,
      tentacleId,
      label,
      color,
      ...(firstActiveTerminal ? { workspaceMode: firstActiveTerminal.workspaceMode } : {}),
      ...(deck?.octopus ? { octopus: deck.octopus } : {}),
    };
    nodes.push(node);
    currentNodesById.set(tentacleNodeId, node);

    // Active terminal session nodes — one per terminal in this tentacle
    if (activeTerminals) {
      for (const activeTerminal of activeTerminals) {
        const sessionNodeId = buildActiveSessionNodeId(activeTerminal.terminalId);
        const prevSession = prevNodes.get(sessionNodeId);
        const parentNodeId = activeTerminal.parentTerminalId
          ? buildActiveSessionNodeId(activeTerminal.parentTerminalId)
          : tentacleNodeId;
        const parentNode = currentNodesById.get(parentNodeId) ?? node;
        const jitter = () => (Math.random() - 0.5) * 60;

        const runtimeInfo = agentRuntimeStates?.get(activeTerminal.terminalId);
        const sessionNode: GraphNode = {
          id: sessionNodeId,
          type: "active-session",
          x: prevSession?.x ?? parentNode.x + jitter(),
          y: prevSession?.y ?? parentNode.y + jitter(),
          vx: prevSession?.vx ?? 0,
          vy: prevSession?.vy ?? 0,
          pinned: prevSession?.pinned ?? false,
          radius: ACTIVE_SESSION_RADIUS,
          tentacleId,
          label: activeTerminal.tentacleName || activeTerminal.terminalId,
          color,
          sessionId: activeTerminal.terminalId,
          agentState: activeTerminal.state,
          hasUserPrompt: activeTerminal.hasUserPrompt ?? false,
          ...(activeTerminal.workspaceMode ? { workspaceMode: activeTerminal.workspaceMode } : {}),
          ...(activeTerminal.parentTerminalId
            ? { parentTerminalId: activeTerminal.parentTerminalId }
            : {}),
          ...(activeTerminal.completionSummary
            ? { completionSummary: activeTerminal.completionSummary }
            : {}),
          ...(runtimeInfo ? { agentRuntimeState: runtimeInfo.state } : {}),
          ...(runtimeInfo?.toolName ? { waitingToolName: runtimeInfo.toolName } : {}),
        };
        nodes.push(sessionNode);
        currentNodesById.set(sessionNodeId, sessionNode);
        edges.push({ source: parentNodeId, target: sessionNodeId });
      }
    }
  }

  // Octoboss — synthetic always-present node
  const prevBoss = prevNodes.get(OCTOBOSS_NODE_ID);
  const octobossColor = getAccentPrimary();
  const octobossNode: GraphNode = {
    id: OCTOBOSS_NODE_ID,
    type: "octoboss",
    x: prevBoss?.x ?? 0,
    y: prevBoss?.y ?? 0,
    vx: prevBoss?.vx ?? 0,
    vy: prevBoss?.vy ?? 0,
    pinned: prevBoss?.pinned ?? false,
    radius: OCTOBOSS_RADIUS,
    tentacleId: OCTOBOSS_ID,
    label: "Octoboss",
    color: octobossColor,
  };
  nodes.push(octobossNode);
  currentNodesById.set(OCTOBOSS_NODE_ID, octobossNode);

  // Connect octoboss to every tentacle node
  for (const tentacleId of allTentacleIds) {
    edges.push({ source: OCTOBOSS_NODE_ID, target: buildTentacleNodeId(tentacleId) });
  }

  // Octoboss-direct terminals, plus any terminal whose tentacle is not on the
  // deck (CLI quick terminals get synthetic tentacles). Finished ones are kept
  // so this page shows the same fleet as the flow view; a new dispatch
  // archives dead husks off both.
  for (const terminal of columns) {
    const isNonDeckTerminal =
      !seenTentacleIds.has(terminal.tentacleId) && terminal.tentacleId !== OCTOBOSS_ID;
    if (terminal.tentacleId !== OCTOBOSS_ID && !isNonDeckTerminal) continue;
    const sessionNodeId = buildActiveSessionNodeId(terminal.terminalId);
    const prevSession = prevNodes.get(sessionNodeId);
    const jitter = () => (Math.random() - 0.5) * 60;

    const bossRuntimeInfo = agentRuntimeStates?.get(terminal.terminalId);
    const sessionNode: GraphNode = {
      id: sessionNodeId,
      type: "active-session",
      x: prevSession?.x ?? octobossNode.x + jitter(),
      y: prevSession?.y ?? octobossNode.y + jitter(),
      vx: prevSession?.vx ?? 0,
      vy: prevSession?.vy ?? 0,
      pinned: prevSession?.pinned ?? false,
      radius: ACTIVE_SESSION_RADIUS,
      tentacleId: OCTOBOSS_ID,
      label: terminal.tentacleName || terminal.terminalId,
      color: octobossColor,
      sessionId: terminal.terminalId,
      agentState: terminal.state,
      hasUserPrompt: terminal.hasUserPrompt ?? false,
      ...(terminal.workspaceMode ? { workspaceMode: terminal.workspaceMode } : {}),
      ...(terminal.parentTerminalId ? { parentTerminalId: terminal.parentTerminalId } : {}),
      ...(terminal.completionSummary ? { completionSummary: terminal.completionSummary } : {}),
      ...(bossRuntimeInfo ? { agentRuntimeState: bossRuntimeInfo.state } : {}),
      ...(bossRuntimeInfo?.toolName ? { waitingToolName: bossRuntimeInfo.toolName } : {}),
    };
    nodes.push(sessionNode);
    currentNodesById.set(sessionNodeId, sessionNode);
    edges.push({ source: OCTOBOSS_NODE_ID, target: sessionNodeId });
  }

  // Inactive sessions from conversations
  for (const session of inactiveSessions) {
    if (!session.tentacleId || !seenTentacleIds.has(session.tentacleId)) continue;
    if (activeTerminalIds.has(session.sessionId)) continue;

    const tentacleNodeId = buildTentacleNodeId(session.tentacleId);
    const sessionNodeId = buildInactiveSessionNodeId(session.sessionId);
    const prevSession = prevNodes.get(sessionNodeId);

    const parentNode = nodes.find((n) => n.id === tentacleNodeId);
    const parentX = parentNode?.x ?? 0;
    const parentY = parentNode?.y ?? 0;
    const color = tentacleColor(session.tentacleId, deckMap.get(session.tentacleId)?.color);
    const jitter = () => (Math.random() - 0.5) * 60;

    const sessionNode: GraphNode = {
      id: sessionNodeId,
      type: "inactive-session",
      x: prevSession?.x ?? parentX + jitter(),
      y: prevSession?.y ?? parentY + jitter(),
      vx: prevSession?.vx ?? 0,
      vy: prevSession?.vy ?? 0,
      pinned: prevSession?.pinned ?? false,
      radius: INACTIVE_SESSION_RADIUS,
      tentacleId: session.tentacleId,
      label: session.firstUserTurnPreview
        ? session.firstUserTurnPreview.slice(0, 40)
        : session.sessionId.slice(0, 12),
      color,
      sessionId: session.sessionId,
      ...(session.firstUserTurnPreview !== null
        ? { firstPromptPreview: session.firstUserTurnPreview }
        : {}),
    };
    nodes.push(sessionNode);
    currentNodesById.set(sessionNodeId, sessionNode);
    edges.push({ source: tentacleNodeId, target: sessionNodeId });
  }

  // Update position cache
  const nextMap = new Map<string, GraphNode>();
  for (const n of nodes) {
    nextMap.set(n.id, n);
  }
  prevNodesRef.current = nextMap;

  return {
    nodes,
    edges,
    tentacleById: deckMap,
    sessionsByTentacleId,
    refresh,
    refreshDeckTentacles,
  };
};
