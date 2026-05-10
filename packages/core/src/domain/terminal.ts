import type { AgentRuntimeState } from "./agentRuntime";

export type AgentState =
  | "live"
  | "idle"
  | "queued"
  | "blocked"
  | "stopped"
  | "exited"
  | "stale"
  // Reliability: agent process is alive but its transcript has emitted no
  // state_change events for `TERMINAL_STALL_THRESHOLD_MS`. Distinguishes
  // "claude is hung at a dialog" from "claude finished its turn cleanly".
  | "stalled";
export type TerminalLifecycleState =
  | "registered"
  | "running"
  | "stopped"
  | "exited"
  | "stale"
  | "stalled";
export type TentacleWorkspaceMode = "shared" | "worktree";

export type TerminalSnapshot = {
  terminalId: string;
  label: string;
  state: AgentState;
  tentacleId: string;
  tentacleName?: string;
  workspaceMode?: TentacleWorkspaceMode;
  createdAt: string;
  hasUserPrompt?: boolean;
  parentTerminalId?: string;
  agentRuntimeState?: AgentRuntimeState;
  lifecycleState?: TerminalLifecycleState;
  lifecycleReason?: string;
  lifecycleUpdatedAt?: string;
  processId?: number;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  exitSignal?: number | string;
};
