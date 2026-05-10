import type { WriteStream } from "node:fs";

import type {
  ChannelMessage,
  PersistedUiState,
  TentacleGitStatusSnapshot,
  TentaclePullRequestSnapshot,
  TentacleWorkspaceMode,
  TerminalAgentProvider,
  TerminalLifecycleState,
} from "@octogent/core";
import { isTerminalAgentProvider, isTerminalCompletionSoundId } from "@octogent/core";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";

import type { AgentRuntimeState, AgentStateTracker } from "../agentStateDetection";

export type TerminalStateMessage = {
  type: "state";
  state: AgentRuntimeState;
  toolName?: string;
};

export type TerminalOutputMessage = {
  type: "output";
  data: string;
};

export type TerminalHistoryMessage = {
  type: "history";
  data: string;
};

export type TerminalRenameMessage = {
  type: "rename";
  tentacleName: string;
};

export type TerminalActivityMessage = {
  type: "activity";
};

export type TerminalServerMessage =
  | TerminalStateMessage
  | TerminalOutputMessage
  | TerminalHistoryMessage
  | TerminalRenameMessage
  | TerminalActivityMessage;

export type DirectSessionListener = (message: TerminalServerMessage) => void;

export type Disposable = {
  dispose: () => void;
};

export type TerminalSession = {
  terminalId: string;
  tentacleId: string;
  // Reliability fix: set to null after teardown so the only remaining
  // reference to the IPty drops and GC can release the underlying master
  // FD. Without this, accumulated PTY allocations exhaust
  // `kern.tty.ptmx_max` (default 511 on macOS) within ~10-20 minutes
  // of normal usage. Reads must guard with `if (!session.isClosed)` first.
  pty: IPty | null;
  ptyDisposables?: Disposable[];
  clients: Set<WebSocket>;
  directListeners: Set<DirectSessionListener>;
  cols: number;
  rows: number;
  agentState: AgentRuntimeState;
  stateTracker: AgentStateTracker;
  isBootstrapCommandSent: boolean;
  scrollbackChunks: string[];
  scrollbackBytes: number;
  statePollTimer?: ReturnType<typeof setInterval> | undefined;
  idleCloseTimer?: ReturnType<typeof setTimeout> | undefined;
  promptTimers?: Set<ReturnType<typeof setTimeout>>;
  debugLog?: WriteStream | undefined;
  transcriptLog?: WriteStream | undefined;
  transcriptEventCount?: number;
  pendingInput?: string;
  hasTranscriptEnded?: boolean;
  initialPrompt?: string;
  isInitialPromptSent?: boolean;
  initialInputDraft?: string;
  isInitialInputDraftSent?: boolean;
  keepAliveWithoutClients?: boolean;
  isClosed?: boolean;
  hasSeenProcessing?: boolean;
  lastToolName?: string | undefined;
};

export type TerminalNameOrigin = "generated" | "user" | "prompt";

export {
  type ChannelMessage,
  type PersistedUiState,
  type TentacleGitStatusSnapshot,
  type TentaclePullRequestSnapshot,
  type TentacleWorkspaceMode,
  type TerminalAgentProvider,
  type TerminalLifecycleState,
  isTerminalAgentProvider,
  isTerminalCompletionSoundId,
};

export type TerminalSessionStartDetails = {
  startedAt: string;
  processId?: number;
};

export type TerminalSessionEndReason =
  | "session_close"
  | "operator_stop"
  | "operator_kill"
  | "pty_exit";

export type TerminalSessionEndDetails = {
  reason: TerminalSessionEndReason;
  endedAt: string;
  exitCode?: number;
  signal?: number | string;
};

export type PersistedTerminal = {
  terminalId: string;
  tentacleId: string;
  worktreeId?: string;
  tentacleName: string;
  nameOrigin?: TerminalNameOrigin;
  autoRenamePromptContext?: string | undefined;
  createdAt: string;
  workspaceMode: TentacleWorkspaceMode;
  agentProvider?: TerminalAgentProvider;
  initialPrompt?: string;
  initialInputDraft?: string;
  lastActiveAt?: string;
  parentTerminalId?: string;
  lifecycleState?: TerminalLifecycleState | undefined;
  lifecycleReason?: string | undefined;
  lifecycleUpdatedAt?: string | undefined;
  processId?: number | undefined;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  exitCode?: number | undefined;
  exitSignal?: number | string | undefined;
};

export type GitClientPullRequestSnapshot = Omit<
  TentaclePullRequestSnapshot,
  "tentacleId" | "workspaceMode" | "status"
> & {
  state: "OPEN" | "MERGED" | "CLOSED";
};

export type TerminalRegistryDocument = {
  version: 3;
  terminals: PersistedTerminal[];
  uiState?: PersistedUiState;
};

export type GitClient = {
  assertAvailable(): void;
  isRepository(cwd: string): boolean;
  addWorktree(options: { cwd: string; path: string; branchName: string; baseRef: string }): void;
  removeWorktree(options: { cwd: string; path: string }): void;
  removeBranch(options: { cwd: string; branchName: string }): void;
  readWorktreeStatus(options: {
    cwd: string;
  }): Omit<TentacleGitStatusSnapshot, "tentacleId" | "workspaceMode">;
  commitAll(options: { cwd: string; message: string }): void;
  pushCurrentBranch(options: { cwd: string }): void;
  syncWithBase(options: { cwd: string; baseRef: string }): void;
  readCurrentBranchPullRequest(options: {
    cwd: string;
  }): GitClientPullRequestSnapshot | null;
  createPullRequest(options: {
    cwd: string;
    title: string;
    body: string;
    baseRef: string;
    headRef: string;
  }): GitClientPullRequestSnapshot | null;
  mergeCurrentBranchPullRequest(options: {
    cwd: string;
    strategy: "squash" | "merge" | "rebase";
  }): void;
};

export class RuntimeInputError extends Error {}

export type CreateTerminalRuntimeOptions = {
  workspaceCwd: string;
  projectStateDir?: string | undefined;
  gitClient?: GitClient;
  getApiBaseUrl?: () => string;
  maxConcurrentSessions?: number | undefined;
};
