import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import type { TerminalSnapshot } from "@octogent/core";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import { createChannelMessaging } from "./terminalRuntime/channelMessaging";
import {
  DEFAULT_AGENT_PROVIDER,
  DEFAULT_TERMINAL_INACTIVITY_THRESHOLD_MS,
  TERMINAL_ID_PREFIX,
  TERMINAL_MAX_CONCURRENT_SESSIONS,
} from "./terminalRuntime/constants";
import {
  conversationExportMarkdown,
  deleteAllConversations,
  deleteConversation,
  listConversationSessions,
  readConversationSession,
  searchConversations,
} from "./terminalRuntime/conversations";
import { createGitOperations } from "./terminalRuntime/gitOperations";
import { createHookProcessor } from "./terminalRuntime/hookProcessor";
import {
  createTerminalRegistryPersistence,
  loadTerminalRegistry,
  pruneUiStateTerminalReferences,
} from "./terminalRuntime/registry";
import { createSessionRuntime } from "./terminalRuntime/sessionRuntime";
import { createDefaultGitClient } from "./terminalRuntime/systemClients";
import type { DirectSessionListener } from "./terminalRuntime/types";
import {
  type CreateTerminalRuntimeOptions,
  type PersistedTerminal,
  type PersistedUiState,
  RuntimeInputError,
  type TentacleWorkspaceMode,
  type TerminalAgentProvider,
  type TerminalLifecycleState,
  type TerminalNameOrigin,
  type TerminalSession,
  type TerminalSessionEndDetails,
  type TerminalSessionStartDetails,
} from "./terminalRuntime/types";
import { createWorktreeManager } from "./terminalRuntime/worktreeManager";

export type {
  GitClient,
  PersistedUiState,
  TerminalAgentProvider,
  TerminalNameOrigin,
  TentacleWorkspaceMode,
} from "./terminalRuntime/types";
export { isTerminalAgentProvider, isTerminalCompletionSoundId } from "./terminalRuntime/types";
export { RuntimeInputError } from "./terminalRuntime/types";

export const MAX_CHILDREN_PER_PARENT = 9;

export const createTerminalRuntime = ({
  workspaceCwd,
  projectStateDir,
  gitClient = createDefaultGitClient(),
  getApiBaseUrl = () => process.env.OCTOGENT_API_ORIGIN ?? "http://127.0.0.1:8787",
  maxConcurrentSessions,
}: CreateTerminalRuntimeOptions) => {
  const stateDir = projectStateDir ?? join(workspaceCwd, ".octogent");
  const sessions = new Map<string, TerminalSession>();
  const websocketServer = new WebSocketServer({ noServer: true });
  const terminalEventsWebsocketServer = new WebSocketServer({ noServer: true });
  const terminalEventClients = new Set<WebSocket>();
  const registryPath = join(stateDir, "state", "tentacles.json");
  const registryState = loadTerminalRegistry(registryPath);
  const registryPersistence = createTerminalRegistryPersistence(registryPath);
  const terminals = registryState.terminals;
  let uiState = registryState.uiState;
  const isDebugPtyLogsEnabled = process.env.OCTOGENT_DEBUG_PTY_LOGS === "1";
  const ptyLogDir = process.env.OCTOGENT_DEBUG_PTY_LOG_DIR ?? join(stateDir, "logs");
  const transcriptDirectoryPath = join(stateDir, "state", "transcripts");
  const configuredMaxConcurrentSessions = (() => {
    if (maxConcurrentSessions !== undefined) {
      return maxConcurrentSessions;
    }

    const raw = process.env.OCTOGENT_MAX_TERMINAL_SESSIONS?.trim();
    if (!raw) {
      return TERMINAL_MAX_CONCURRENT_SESSIONS;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 1
      ? Math.floor(parsed)
      : TERMINAL_MAX_CONCURRENT_SESSIONS;
  })();
  const persistRegistry = () => {
    uiState = pruneUiStateTerminalReferences(uiState, terminals);
    registryPersistence.schedulePersist({
      terminals,
      uiState,
    });
  };

  const isProcessAlive = (pid: number | undefined): boolean => {
    if (!pid || !Number.isInteger(pid) || pid <= 0) {
      return false;
    }

    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const lifecycleStateToAgentState = (
    lifecycleState: TerminalLifecycleState,
  ): TerminalSnapshot["state"] => {
    switch (lifecycleState) {
      case "stale":
        return "stale";
      case "stalled":
        return "stalled";
      case "exited":
        return "exited";
      case "stopped":
        return "stopped";
      default:
        return "live";
    }
  };

  const markTerminalRunning = (
    terminalId: string,
    { processId, startedAt }: TerminalSessionStartDetails,
  ) => {
    const terminal = terminals.get(terminalId);
    if (!terminal) {
      return;
    }

    terminal.lifecycleState = "running";
    terminal.lifecycleReason = undefined;
    terminal.lifecycleUpdatedAt = startedAt;
    terminal.startedAt = startedAt;
    terminal.endedAt = undefined;
    terminal.exitCode = undefined;
    terminal.exitSignal = undefined;
    if (processId !== undefined) {
      terminal.processId = processId;
    } else {
      terminal.processId = undefined;
    }
    persistRegistry();
    broadcastTerminalEvent({
      type: "terminal-updated",
      snapshot: toTerminalSnapshot(terminal),
    });
  };

  const markTerminalEnded = (terminalId: string, details: TerminalSessionEndDetails) => {
    const terminal = terminals.get(terminalId);
    if (!terminal) {
      return;
    }

    terminal.lifecycleState = details.reason === "pty_exit" ? "exited" : "stopped";
    terminal.lifecycleReason = details.reason;
    terminal.lifecycleUpdatedAt = details.endedAt;
    terminal.endedAt = details.endedAt;
    terminal.processId = undefined;
    if (details.exitCode !== undefined) {
      terminal.exitCode = details.exitCode;
    } else {
      terminal.exitCode = undefined;
    }
    if (details.signal !== undefined) {
      terminal.exitSignal = details.signal;
    } else {
      terminal.exitSignal = undefined;
    }
    persistRegistry();
    broadcastTerminalEvent({
      type: "terminal-updated",
      snapshot: toTerminalSnapshot(terminal),
    });
  };

  const reconcilePersistedLifecycle = () => {
    let didChange = false;
    const now = new Date().toISOString();

    for (const terminal of terminals.values()) {
      if (terminal.lifecycleState !== "running") {
        continue;
      }

      terminal.lifecycleState = "stale";
      terminal.lifecycleReason = isProcessAlive(terminal.processId)
        ? "orphaned_process"
        : "missing_process";
      terminal.lifecycleUpdatedAt = now;
      didChange = true;
    }

    if (didChange) {
      persistRegistry();
    }
  };

  const worktreeManager = createWorktreeManager({
    workspaceCwd,
    gitClient,
    terminals,
  });

  const resolveTerminalSession = (
    terminalId: string,
  ): { sessionId: string; tentacleId: string } | null => {
    const terminal = terminals.get(terminalId);
    if (terminal) {
      return {
        sessionId: terminalId,
        tentacleId: terminal.worktreeId ?? terminal.tentacleId,
      };
    }

    return null;
  };

  const broadcastTerminalStateChanged = (
    terminalId: string,
    agentRuntimeState: string,
    toolName?: string,
  ) => {
    // Reliability: stamp lastActiveAt on every state change so the stall
    // detector below can spot agents whose claude is hung at a dialog
    // (process alive, but no transcript activity).
    const terminal = terminals.get(terminalId);
    if (terminal) {
      terminal.lastActiveAt = new Date().toISOString();
      // Auto-recover from a previously-stalled state if the agent
      // resumes — flip lifecycleState back to running.
      if (terminal.lifecycleState === "stalled") {
        terminal.lifecycleState = "running";
        terminal.lifecycleReason = undefined;
        terminal.lifecycleUpdatedAt = terminal.lastActiveAt;
        broadcastTerminalEvent({
          type: "terminal-lifecycle-changed",
          terminalId,
          lifecycleState: "running",
        });
      }
    }
    broadcastTerminalEvent({
      type: "terminal-state-changed",
      terminalId,
      agentRuntimeState,
      ...(toolName ? { toolName } : {}),
    });
  };

  // Reliability fix #2: stall detector. A terminal whose underlying
  // claude process is hung at an interactive dialog (auth, trust prompt,
  // etc.) shows lifecycleState=running with no transcript activity for
  // many minutes. Without this, operators only notice via "still no
  // commits at 10 min" which wastes time + tokens.
  //
  // Threshold is intentionally tight (default 2 min) — a real working
  // agent emits state_change events on every claude turn (typically
  // every 5-30s). Two minutes of silence is a reliable signal.
  const TERMINAL_STALL_THRESHOLD_MS = Number.parseInt(
    process.env.OCTOGENT_TERMINAL_STALL_MS ?? "120000",
    10,
  );
  const detectStalledTerminals = () => {
    const now = Date.now();
    for (const terminal of terminals.values()) {
      if (terminal.lifecycleState !== "running") continue;
      const startedAt = terminal.startedAt ? new Date(terminal.startedAt).getTime() : 0;
      const lastActiveAt = terminal.lastActiveAt ? new Date(terminal.lastActiveAt).getTime() : 0;
      const lastActivity = Math.max(startedAt, lastActiveAt);
      if (lastActivity === 0) continue;
      if (now - lastActivity < TERMINAL_STALL_THRESHOLD_MS) continue;

      // Mark stalled. Don't kill the PTY — operator decides whether to
      // restart, kill, or send input. This is just a visibility signal.
      terminal.lifecycleState = "stalled";
      terminal.lifecycleReason = `no transcript activity for ${Math.round(
        (now - lastActivity) / 1000,
      )}s`;
      terminal.lifecycleUpdatedAt = new Date(now).toISOString();
      broadcastTerminalEvent({
        type: "terminal-lifecycle-changed",
        terminalId: terminal.terminalId,
        lifecycleState: "stalled",
        lifecycleReason: terminal.lifecycleReason,
      });
    }
  };
  const stallDetectorInterval = setInterval(detectStalledTerminals, 30_000);
  // Don't keep the event loop alive if everything else is idle.
  if (typeof stallDetectorInterval.unref === "function") {
    stallDetectorInterval.unref();
  }

  const sessionRuntime = createSessionRuntime({
    websocketServer,
    terminals,
    sessions,
    resolveTerminalSession,
    getTentacleWorkspaceCwd: worktreeManager.getTentacleWorkspaceCwd,
    isDebugPtyLogsEnabled,
    ptyLogDir,
    transcriptDirectoryPath,
    maxConcurrentSessions: configuredMaxConcurrentSessions,
    onStateChange: broadcastTerminalStateChanged,
    onSessionStart: markTerminalRunning,
    onSessionEnd: markTerminalEnded,
  });

  const gitOps = createGitOperations({
    terminals,
    worktreeManager,
    gitClient,
  });

  const channelMessaging = createChannelMessaging({
    terminals,
    sessions,
    writeInput: (terminalId: string, data: string) => sessionRuntime.writeInput(terminalId, data),
  });

  const hookProcessor = createHookProcessor({
    terminals,
    sessions,
    transcriptDirectoryPath,
    getApiBaseUrl,
    persistRegistry,
    deliverChannelMessages: channelMessaging.deliverChannelMessages,
    releaseSessionKeepAlive: sessionRuntime.releaseSessionKeepAlive,
    onStateChange: broadcastTerminalStateChanged,
  });

  reconcilePersistedLifecycle();

  const allocateTerminalId = () => {
    let candidateNumber = 1;
    while (candidateNumber < Number.MAX_SAFE_INTEGER) {
      const candidateId = `${TERMINAL_ID_PREFIX}${candidateNumber}`;
      if (terminals.has(candidateId)) {
        candidateNumber += 1;
        continue;
      }

      if (sessions.has(candidateId)) {
        candidateNumber += 1;
        continue;
      }

      if (worktreeManager.hasTentacleWorktree(candidateId)) {
        candidateNumber += 1;
        continue;
      }

      return candidateId;
    }

    throw new Error("Unable to allocate terminal id.");
  };

  const allocateDefaultTerminalName = (): string => {
    const usedNumbers = new Set<number>();
    const pattern = /^Octogent Terminal (\d+)$/;
    for (const t of terminals.values()) {
      const match = pattern.exec(t.tentacleName);
      if (match) usedNumbers.add(Number(match[1]));
    }
    let n = 1;
    while (usedNumbers.has(n)) n++;
    return `Octogent Terminal ${n}`;
  };

  const isTerminalRecentlyActive = (terminal: PersistedTerminal): boolean => {
    if (!terminal.lastActiveAt) return false;
    const thresholdMs =
      uiState.terminalInactivityThresholdMs ?? DEFAULT_TERMINAL_INACTIVITY_THRESHOLD_MS;
    return Date.now() - new Date(terminal.lastActiveAt).getTime() < thresholdMs;
  };

  const toTerminalSnapshot = (terminal: PersistedTerminal): TerminalSnapshot => {
    const session = sessions.get(terminal.terminalId);
    const lifecycleState: TerminalLifecycleState = session
      ? "running"
      : (terminal.lifecycleState ?? "registered");
    return {
      terminalId: terminal.terminalId,
      label: terminal.terminalId,
      state: lifecycleStateToAgentState(lifecycleState),
      tentacleId: terminal.tentacleId,
      tentacleName: terminal.tentacleName,
      workspaceMode: terminal.workspaceMode,
      createdAt: terminal.createdAt,
      hasUserPrompt: isTerminalRecentlyActive(terminal),
      ...(terminal.parentTerminalId ? { parentTerminalId: terminal.parentTerminalId } : {}),
      ...(session ? { agentRuntimeState: session.agentState } : {}),
      lifecycleState,
      ...(terminal.lifecycleReason ? { lifecycleReason: terminal.lifecycleReason } : {}),
      ...(terminal.lifecycleUpdatedAt ? { lifecycleUpdatedAt: terminal.lifecycleUpdatedAt } : {}),
      ...(terminal.processId ? { processId: terminal.processId } : {}),
      ...(terminal.startedAt ? { startedAt: terminal.startedAt } : {}),
      ...(terminal.endedAt ? { endedAt: terminal.endedAt } : {}),
      ...(terminal.exitCode !== undefined ? { exitCode: terminal.exitCode } : {}),
      ...(terminal.exitSignal !== undefined ? { exitSignal: terminal.exitSignal } : {}),
    };
  };

  const broadcastTerminalEvent = (event: Record<string, unknown>) => {
    const payload = JSON.stringify(event);
    for (const client of terminalEventClients) {
      if (client.readyState !== 1) {
        continue;
      }
      client.send(payload);
    }
  };

  const broadcastTerminalListChanged = () => {
    broadcastTerminalEvent({ type: "terminal-list-changed" });
  };

  const collectTerminalCascade = (rootTerminalId: string): string[] => {
    const toDelete = new Set<string>();
    const queue = [rootTerminalId];

    while (queue.length > 0) {
      const currentTerminalId = queue.shift();
      if (!currentTerminalId || toDelete.has(currentTerminalId)) {
        continue;
      }

      toDelete.add(currentTerminalId);
      for (const terminal of terminals.values()) {
        if (terminal.parentTerminalId === currentTerminalId) {
          queue.push(terminal.terminalId);
        }
      }
    }

    return Array.from(toDelete);
  };

  const createTerminal = ({
    terminalId: requestedTerminalId,
    tentacleId: requestedTentacleId,
    worktreeId: requestedWorktreeId,
    tentacleName,
    workspaceMode = "shared",
    agentProvider,
    initialPrompt,
    initialInputDraft,
    baseRef,
    parentTerminalId,
    nameOrigin,
    autoRenamePromptContext,
  }: {
    terminalId?: string;
    tentacleId?: string;
    worktreeId?: string;
    tentacleName?: string;
    workspaceMode?: TentacleWorkspaceMode;
    agentProvider?: TerminalAgentProvider;
    initialPrompt?: string;
    initialInputDraft?: string;
    baseRef?: string;
    parentTerminalId?: string;
    nameOrigin?: TerminalNameOrigin;
    autoRenamePromptContext?: string;
  }): TerminalSnapshot => {
    // Enforce max children per parent.
    if (parentTerminalId) {
      const childCount = [...terminals.values()].filter(
        (t) => t.parentTerminalId === parentTerminalId,
      ).length;
      if (childCount >= MAX_CHILDREN_PER_PARENT) {
        throw new RuntimeInputError(
          `Parent terminal "${parentTerminalId}" already has ${MAX_CHILDREN_PER_PARENT} children (limit reached).`,
        );
      }
    }

    const terminalId =
      requestedTerminalId && !terminals.has(requestedTerminalId)
        ? requestedTerminalId
        : allocateTerminalId();

    if (initialPrompt) {
      const capacity = sessionRuntime.getSessionCapacity();
      if (capacity.active >= capacity.max) {
        throw new RuntimeInputError(
          `Terminal session limit reached (${capacity.max}). Close an existing terminal session or increase OCTOGENT_MAX_TERMINAL_SESSIONS.`,
        );
      }
    }

    // Allow explicit tentacleId so multiple terminals can share a tentacle context (e.g. swarm workers).
    const tentacleId = requestedTentacleId ?? terminalId;
    const effectiveName = tentacleName ?? allocateDefaultTerminalName();

    // Auto-allocate a unique worktreeId when creating a worktree terminal
    // so multiple worktree terminals can coexist (each gets its own directory).
    const worktreeId =
      requestedWorktreeId ?? (workspaceMode === "worktree" ? terminalId : undefined);

    const terminal: PersistedTerminal = {
      terminalId,
      tentacleId,
      ...(worktreeId ? { worktreeId } : {}),
      tentacleName: effectiveName,
      nameOrigin: nameOrigin ?? (tentacleName ? "user" : "generated"),
      ...(autoRenamePromptContext ? { autoRenamePromptContext } : {}),
      createdAt: new Date().toISOString(),
      workspaceMode,
      agentProvider: agentProvider ?? DEFAULT_AGENT_PROVIDER,
      lifecycleState: "registered",
      lifecycleUpdatedAt: new Date().toISOString(),
      ...(initialPrompt ? { initialPrompt } : {}),
      ...(initialInputDraft ? { initialInputDraft } : {}),
      ...(initialPrompt ? { lastActiveAt: new Date().toISOString() } : {}),
      ...(parentTerminalId ? { parentTerminalId } : {}),
    };

    const effectiveWorktreeId = worktreeId ?? tentacleId;
    const shouldCreateWorktree = workspaceMode === "worktree";
    if (shouldCreateWorktree) {
      worktreeManager.createTentacleWorktree(effectiveWorktreeId, baseRef);
    }

    if (terminal.agentProvider === "claude-code") {
      // Claude hooks should only be installed for Claude-backed terminals.
      try {
        const hookTargetCwd = shouldCreateWorktree
          ? worktreeManager.getTentacleWorkspaceCwd(effectiveWorktreeId)
          : workspaceCwd;
        hookProcessor.installHooksInDirectory(hookTargetCwd);
      } catch {
        // Best-effort: hook installation should not block terminal creation.
      }
    }

    terminals.set(terminalId, terminal);
    persistRegistry();
    broadcastTerminalEvent({
      type: "terminal-created",
      snapshot: toTerminalSnapshot(terminal),
    });

    if (initialPrompt) {
      sessionRuntime.startSession(terminalId);
    }

    return toTerminalSnapshot(terminal);
  };

  const readUiState = (): PersistedUiState => {
    const normalized = pruneUiStateTerminalReferences(uiState, terminals);
    const result: PersistedUiState = { ...normalized };
    if (normalized.minimizedTerminalIds) {
      result.minimizedTerminalIds = [...normalized.minimizedTerminalIds];
    }
    if (normalized.terminalWidths) {
      result.terminalWidths = { ...normalized.terminalWidths };
    }
    if (normalized.terminalCompletionSound !== undefined) {
      result.terminalCompletionSound = normalized.terminalCompletionSound;
    }
    return result;
  };

  return {
    listTerminalSnapshots(): TerminalSnapshot[] {
      const snapshots: TerminalSnapshot[] = [];
      for (const terminal of terminals.values()) {
        snapshots.push(toTerminalSnapshot(terminal));
      }
      return snapshots;
    },

    listConversationSessions() {
      return listConversationSessions(transcriptDirectoryPath);
    },

    readConversationSession(sessionId: string) {
      return readConversationSession(transcriptDirectoryPath, sessionId);
    },

    exportConversationSession(sessionId: string, format: "json" | "md") {
      const conversation = readConversationSession(transcriptDirectoryPath, sessionId);
      if (!conversation) {
        return null;
      }

      if (format === "json") {
        const exported = {
          turns: conversation.turns,
        };
        return `${JSON.stringify(exported, null, 2)}\n`;
      }

      return conversationExportMarkdown(conversation);
    },

    deleteConversationSession(sessionId: string) {
      deleteConversation(transcriptDirectoryPath, sessionId);
    },

    deleteAllConversationSessions() {
      deleteAllConversations(transcriptDirectoryPath);
    },

    searchConversations(query: string) {
      return searchConversations(transcriptDirectoryPath, query);
    },

    readUiState,

    patchUiState(patch: PersistedUiState): PersistedUiState {
      if (patch.activePrimaryNav !== undefined) {
        uiState.activePrimaryNav = patch.activePrimaryNav;
      }
      if (patch.isAgentsSidebarVisible !== undefined) {
        uiState.isAgentsSidebarVisible = patch.isAgentsSidebarVisible;
      }
      if (patch.sidebarWidth !== undefined) {
        uiState.sidebarWidth = patch.sidebarWidth;
      }
      if (patch.isActiveAgentsSectionExpanded !== undefined) {
        uiState.isActiveAgentsSectionExpanded = patch.isActiveAgentsSectionExpanded;
      }
      if (patch.isRuntimeStatusStripVisible !== undefined) {
        uiState.isRuntimeStatusStripVisible = patch.isRuntimeStatusStripVisible;
      }
      if (patch.isMonitorVisible !== undefined) {
        uiState.isMonitorVisible = patch.isMonitorVisible;
      }
      if (patch.isBottomTelemetryVisible !== undefined) {
        uiState.isBottomTelemetryVisible = patch.isBottomTelemetryVisible;
      }
      if (patch.isCodexUsageVisible !== undefined) {
        uiState.isCodexUsageVisible = patch.isCodexUsageVisible;
      }
      if (patch.isClaudeUsageVisible !== undefined) {
        uiState.isClaudeUsageVisible = patch.isClaudeUsageVisible;
      }
      if (patch.isClaudeUsageSectionExpanded !== undefined) {
        uiState.isClaudeUsageSectionExpanded = patch.isClaudeUsageSectionExpanded;
      }
      if (patch.isCodexUsageSectionExpanded !== undefined) {
        uiState.isCodexUsageSectionExpanded = patch.isCodexUsageSectionExpanded;
      }
      if (patch.terminalCompletionSound !== undefined) {
        uiState.terminalCompletionSound = patch.terminalCompletionSound;
      }
      if (patch.minimizedTerminalIds !== undefined) {
        uiState.minimizedTerminalIds = [...patch.minimizedTerminalIds];
      }
      if (patch.terminalWidths !== undefined) {
        uiState.terminalWidths = { ...patch.terminalWidths };
      }
      if (patch.canvasOpenTerminalIds !== undefined) {
        uiState.canvasOpenTerminalIds = [...patch.canvasOpenTerminalIds];
      }
      if (patch.canvasOpenTentacleIds !== undefined) {
        uiState.canvasOpenTentacleIds = [...patch.canvasOpenTentacleIds];
      }
      if (patch.canvasTerminalsPanelWidth !== undefined) {
        uiState.canvasTerminalsPanelWidth = patch.canvasTerminalsPanelWidth;
      }

      persistRegistry();
      return readUiState();
    },

    ...gitOps,

    createTerminal,

    renameTerminal(terminalId: string, tentacleName: string): TerminalSnapshot | null {
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        return null;
      }

      terminal.tentacleName = tentacleName;
      terminal.nameOrigin = "user";
      terminal.autoRenamePromptContext = undefined;
      persistRegistry();
      broadcastTerminalEvent({
        type: "terminal-updated",
        snapshot: toTerminalSnapshot(terminal),
      });
      return toTerminalSnapshot(terminal);
    },

    stopTerminal(terminalId: string): TerminalSnapshot | null {
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        return null;
      }

      const stoppedActiveSession = sessionRuntime.stopSession(terminalId);
      if (!stoppedActiveSession && isProcessAlive(terminal.processId)) {
        try {
          process.kill(terminal.processId as number, "SIGTERM");
        } catch {
          // The lifecycle marker below still removes this terminal from the active set.
        }
      }

      if (!stoppedActiveSession) {
        markTerminalEnded(terminalId, {
          reason: "operator_stop",
          endedAt: new Date().toISOString(),
        });
      }

      return toTerminalSnapshot(terminal);
    },

    killTerminal(terminalId: string): TerminalSnapshot | null {
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        return null;
      }

      const signal = "SIGKILL";
      const killedActiveSession = sessionRuntime.killSession(terminalId, signal);
      if (!killedActiveSession && isProcessAlive(terminal.processId)) {
        try {
          process.kill(terminal.processId as number, signal);
        } catch {
          // The lifecycle marker below still removes this terminal from the active set.
        }
      }

      if (!killedActiveSession) {
        markTerminalEnded(terminalId, {
          reason: "operator_kill",
          signal,
          endedAt: new Date().toISOString(),
        });
      }

      return toTerminalSnapshot(terminal);
    },

    pruneTerminals(): string[] {
      const prunableStates = new Set<TerminalLifecycleState>(["stale", "exited", "stopped"]);
      const prunedTerminalIds: string[] = [];

      for (const terminal of terminals.values()) {
        const lifecycleState = terminal.lifecycleState ?? "registered";
        if (!prunableStates.has(lifecycleState) || sessions.has(terminal.terminalId)) {
          continue;
        }

        prunedTerminalIds.push(terminal.terminalId);
      }

      if (prunedTerminalIds.length === 0) {
        return [];
      }

      for (const terminalId of prunedTerminalIds) {
        terminals.delete(terminalId);
      }

      persistRegistry();
      for (const terminalId of prunedTerminalIds) {
        broadcastTerminalEvent({
          type: "terminal-deleted",
          terminalId,
        });
      }
      return prunedTerminalIds;
    },

    deleteTerminal(terminalId: string): boolean {
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        return false;
      }

      const cascadeTerminalIds = collectTerminalCascade(terminalId);
      for (const cascadeTerminalId of cascadeTerminalIds) {
        const cascadeTerminal = terminals.get(cascadeTerminalId);
        if (!cascadeTerminal) {
          continue;
        }

        sessionRuntime.closeSession(cascadeTerminalId);
        if (cascadeTerminal.workspaceMode === "worktree") {
          worktreeManager.removeTentacleWorktree(
            cascadeTerminal.worktreeId ?? cascadeTerminal.tentacleId,
          );
        }
        terminals.delete(cascadeTerminalId);
      }

      persistRegistry();
      for (const cascadeTerminalId of cascadeTerminalIds) {
        broadcastTerminalEvent({
          type: "terminal-deleted",
          terminalId: cascadeTerminalId,
        });
      }
      return true;
    },

    ...channelMessaging,

    handleHook: hookProcessor.handleHook,

    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url ?? "/", "http://localhost");
      } catch {
        return false;
      }

      if (requestUrl.pathname === "/api/terminal-events/ws") {
        terminalEventsWebsocketServer.handleUpgrade(request, socket, head, (websocket) => {
          terminalEventClients.add(websocket);
          websocket.on("close", () => {
            terminalEventClients.delete(websocket);
          });
        });
        return true;
      }

      return sessionRuntime.handleUpgrade(request, socket, head);
    },

    connectDirect(terminalId: string, listener: DirectSessionListener): (() => void) | null {
      return sessionRuntime.connectDirect(terminalId, listener);
    },

    writeInput(terminalId: string, data: string): boolean {
      return sessionRuntime.writeInput(terminalId, data);
    },

    resizeTerminal(terminalId: string, cols: number, rows: number): boolean {
      return sessionRuntime.resizeSession(terminalId, cols, rows);
    },

    async close() {
      clearInterval(stallDetectorInterval);
      sessionRuntime.close();
      await registryPersistence.close();
      for (const client of terminalEventClients) {
        client.close();
      }
      terminalEventClients.clear();
      terminalEventsWebsocketServer.close();
      websocketServer.close();
    },
  };
};
