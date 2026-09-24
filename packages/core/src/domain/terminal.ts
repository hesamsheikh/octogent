import type { AgentRuntimeState, TerminalAgentProvider } from "./agentRuntime";

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
  | "stalled"
  // Lifecycle: work is done but the branch has not been merged yet.
  | "awaiting-review"
  | "completed";
export type TerminalLifecycleState =
  | "registered"
  | "running"
  | "stopped"
  | "exited"
  | "stale"
  | "stalled"
  // Work is done but the branch has not been merged yet.
  | "awaiting-review"
  | "completed";
export type TentacleWorkspaceMode = "shared" | "worktree";

export type TerminalCompletionSummary = {
  taskLine: string | null;
  commits: Array<{ hash: string; message: string }>;
  filesChanged: number;
  insertions: number;
  deletions: number;
  branch: string | null;
  merged: boolean;
  durationMs: number | null;
  workspaceMode: TentacleWorkspaceMode;
};

export type TerminalProviderErrorKind = "usage-limit" | "rate-limit" | "api-error" | "auth";

export const TERMINAL_PROVIDER_ERROR_KINDS: TerminalProviderErrorKind[] = [
  "usage-limit",
  "rate-limit",
  "api-error",
  "auth",
];

export const isTerminalProviderErrorKind = (value: unknown): value is TerminalProviderErrorKind =>
  typeof value === "string" &&
  TERMINAL_PROVIDER_ERROR_KINDS.includes(value as TerminalProviderErrorKind);

/** A fatal or limit banner the agent CLI printed; the agent itself reports nothing. */
export type TerminalProviderError = {
  kind: TerminalProviderErrorKind;
  message: string;
  at: string;
};

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
  /** Variable names the creator passed along from its shell (`--inherit-env`); never values. */
  inheritedEnv?: string[];
  /** Which agent CLI runs in this terminal. */
  agentProvider?: TerminalAgentProvider;
  /** Model requested at creation (explicitly or via an effort tier). */
  agentModel?: string;
  /** Difficulty tier the model was chosen from, when one was given. */
  agentEffortTier?: string;
  /** Model the agent reported in its own transcript; fills in when no model was requested. */
  agentModelObserved?: string;
  attentionSince?: string;
  attentionKind?: "permission" | "user";
  attentionToolName?: string;
  /** Cleared when the agent next makes real progress (a tool call or a Stop verdict). */
  providerError?: TerminalProviderError;
  agentRuntimeState?: AgentRuntimeState;
  lifecycleState?: TerminalLifecycleState;
  lifecycleReason?: string;
  lifecycleUpdatedAt?: string;
  processId?: number;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  exitSignal?: number | string;
  completedAt?: string;
  completionSummary?: TerminalCompletionSummary;
  // Set when the record has aged out of default listings; transcripts and
  // completion summaries are kept on disk.
  archivedAt?: string;
};
