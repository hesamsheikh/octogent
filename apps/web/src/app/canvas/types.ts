import type {
  AgentRuntimeState,
  AgentState,
  DeckOctopusAppearance,
  TentacleWorkspaceMode,
  TerminalCompletionSummary,
} from "@octogent/core";

export type GraphNode = {
  id: string;
  type: "tentacle" | "octoboss" | "active-session" | "inactive-session";
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
  radius: number;
  tentacleId: string;
  label: string;
  color: string;
  sessionId?: string;
  agentState?: AgentState;
  completionSummary?: TerminalCompletionSummary;
  agentRuntimeState?: AgentRuntimeState;
  waitingToolName?: string;
  hasUserPrompt?: boolean;
  workspaceMode?: TentacleWorkspaceMode;
  parentTerminalId?: string;
  firstPromptPreview?: string;
  octopus?: DeckOctopusAppearance;
};

export type GraphEdge = {
  source: string;
  target: string;
};
