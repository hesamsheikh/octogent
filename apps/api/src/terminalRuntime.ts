import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { ensureDirectoryTrusted } from "./claudeTrust";

import type { TerminalSnapshot } from "@octogent/core";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import { ensureCodexDirectoryTrusted } from "./codexTrust";
import { buildCompletionSummary, collectCompletionGitFacts } from "./completionSummary";
import { logVerbose } from "./logging";
import {
  createAgentProviderAdapters,
  resolveAgentProviderAdapter,
} from "./terminalRuntime/agentProviders";
import { resolveTerminalRetentionHours, shouldAutoArchive } from "./terminalRuntime/archivePolicy";
import { createChannelMessaging } from "./terminalRuntime/channelMessaging";
import { installCodexHooks } from "./terminalRuntime/codexHooks";
import {
  evaluateCompletionOnStop,
  resolveSnapshotLifecycle,
} from "./terminalRuntime/completionDetection";
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
import { resolveSessionIdleGraceMs } from "./terminalRuntime/idleGrace";
import { type EffortTier, resolveAgentModelSelection } from "./terminalRuntime/modelSelection";
import {
  createTerminalRegistryPersistence,
  loadTerminalRegistry,
  pruneUiStateTerminalReferences,
} from "./terminalRuntime/registry";
import { createSessionRuntime } from "./terminalRuntime/sessionRuntime";
import { createDefaultGitClient, toErrorMessage } from "./terminalRuntime/systemClients";
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
import { resolveLiveMergeVerdict, shouldReclaimWorktree } from "./terminalRuntime/worktreeGc";
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
      case "awaiting-review":
        return "awaiting-review";
      case "completed":
        return "completed";
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
      // A finished terminal that starts acting again (a new instruction, a
      // follow-up turn) is back in business; the next Stop re-evaluates.
      if (
        (terminal.lifecycleState === "completed" ||
          terminal.lifecycleState === "awaiting-review") &&
        agentRuntimeState !== "idle"
      ) {
        terminal.lifecycleState = "running";
        terminal.lifecycleUpdatedAt = terminal.lastActiveAt;
        broadcastTerminalEvent({
          type: "terminal-lifecycle-changed",
          terminalId,
          lifecycleState: "running",
        });
      }
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

  const runGit = (cwd: string, args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8" });

  // "Merged" means merged into whatever the operator's main workspace has
  // checked out; a detached workspace falls back to comparing against HEAD.
  const resolveWorkspaceBaseRef = (): string => {
    try {
      const branch = runGit(workspaceCwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
      if (branch.length > 0) {
        return branch;
      }
    } catch {
      // Keep the HEAD fallback.
    }
    return "HEAD";
  };

  // Worktree GC. A worktree directory may back several terminal records
  // (shared worktreeId), so it is only reclaimable when every record pointing
  // at it independently passes shouldReclaimWorktree — one unmerged sibling
  // keeps the whole worktree on disk. Git is consulted once per worktree so
  // the decision reflects the branch as it is now, not only what the records
  // remember.
  const listReclaimableWorktreeCandidates = (): Array<{
    worktreeId: string;
    terminalIds: string[];
  }> => {
    const worktreeGroups = new Map<string, PersistedTerminal[]>();
    for (const terminal of terminals.values()) {
      if (terminal.workspaceMode !== "worktree") continue;
      const worktreeId = terminal.worktreeId ?? terminal.tentacleId;
      const group = worktreeGroups.get(worktreeId);
      if (group) {
        group.push(terminal);
      } else {
        worktreeGroups.set(worktreeId, [terminal]);
      }
    }

    const candidates: Array<{ worktreeId: string; terminalIds: string[] }> = [];
    const baseRef = resolveWorkspaceBaseRef();
    for (const [worktreeId, group] of worktreeGroups) {
      if (!worktreeManager.hasTentacleWorktree(worktreeId)) continue;
      if (group.some((terminal) => sessions.has(terminal.terminalId))) continue;
      const liveVerdict = resolveLiveMergeVerdict(
        worktreeManager.getTentacleWorktreePath(worktreeId),
        baseRef,
        runGit,
      );
      const isReclaimable = group.every((terminal) => shouldReclaimWorktree(terminal, liveVerdict));
      if (!isReclaimable) continue;
      candidates.push({
        worktreeId,
        terminalIds: group.map((terminal) => terminal.terminalId),
      });
    }
    return candidates;
  };

  const reclaimWorktree = (worktreeId: string): boolean => {
    try {
      worktreeManager.removeTentacleWorktree(worktreeId);
      return true;
    } catch (error) {
      logVerbose(
        `[worktree-gc] Failed to reclaim worktree ${worktreeId}: ${toErrorMessage(error)}`,
      );
      return false;
    }
  };

  // Archive sweeper: without it, completed/stopped/exited terminal records
  // accumulate forever in long-lived projects. Once the retention window
  // passes, stamp archivedAt so default listings hide the record; transcripts
  // and completion summaries stay on disk, and awaiting-review never expires
  // (unmerged work must stay visible until an operator acts on it).
  const TERMINAL_RETENTION_HOURS = resolveTerminalRetentionHours(
    process.env.OCTOGENT_TERMINAL_RETENTION_HOURS,
  );
  // A live PTY can be a parked multi-turn worker. Protect active turns while
  // allowing finished, idle workers to leave the retention shelf.
  const hasBusySession = (terminalId: string): boolean => {
    const session = sessions.get(terminalId);
    return session !== undefined && session.agentState !== "idle";
  };
  // Persist, broadcast and reclaim after a batch of records has been archived.
  // Reclaim upholds the iron rule (shouldReclaimWorktree never deletes unmerged
  // work); a failure only logs and the next sweep or `worktree gc` retries.
  const finalizeArchivedTerminals = (archivedTerminals: PersistedTerminal[]) => {
    if (archivedTerminals.length === 0) {
      return;
    }
    persistRegistry();
    for (const terminal of archivedTerminals) {
      sessionRuntime.releaseSessionKeepAlive(terminal.terminalId);
      broadcastTerminalEvent({
        type: "terminal-updated",
        snapshot: toTerminalSnapshot(terminal),
      });
    }

    const archivedWorktreeIds = new Set(
      archivedTerminals
        .filter((terminal) => terminal.workspaceMode === "worktree")
        .map((terminal) => terminal.worktreeId ?? terminal.tentacleId),
    );
    for (const candidate of listReclaimableWorktreeCandidates()) {
      if (archivedWorktreeIds.has(candidate.worktreeId)) {
        reclaimWorktree(candidate.worktreeId);
      }
    }
  };

  const archiveExpiredTerminals = () => {
    const nowMs = Date.now();
    const archivedTerminals: PersistedTerminal[] = [];
    for (const terminal of terminals.values()) {
      if (hasBusySession(terminal.terminalId)) continue;
      if (!shouldAutoArchive(terminal, nowMs, TERMINAL_RETENTION_HOURS)) continue;

      terminal.archivedAt = new Date(nowMs).toISOString();
      archivedTerminals.push(terminal);
    }
    finalizeArchivedTerminals(archivedTerminals);
  };

  const deleteTerminalInternal = (
    terminalId: string,
    options?: { removeWorktree?: boolean; bestEffortWorktree?: boolean },
  ): boolean => {
    const terminal = terminals.get(terminalId);
    if (!terminal) {
      return false;
    }

    const cascadeTerminalIds = collectTerminalCascade(terminalId);
    const cascadeSet = new Set(cascadeTerminalIds);

    // Worktrees are shared: several terminals can point at one worktreeId. Only
    // a worktree that no surviving terminal still references may be removed, and
    // only when the caller asked — otherwise the record goes and the directory
    // stays on disk.
    const survivingWorktreeIds = new Set<string>();
    for (const record of terminals.values()) {
      if (cascadeSet.has(record.terminalId) || record.workspaceMode !== "worktree") {
        continue;
      }
      survivingWorktreeIds.add(record.worktreeId ?? record.tentacleId);
    }

    for (const cascadeTerminalId of cascadeTerminalIds) {
      const cascadeTerminal = terminals.get(cascadeTerminalId);
      if (!cascadeTerminal) {
        continue;
      }

      sessionRuntime.closeSession(cascadeTerminalId);
      if (options?.removeWorktree && cascadeTerminal.workspaceMode === "worktree") {
        const worktreeId = cascadeTerminal.worktreeId ?? cascadeTerminal.tentacleId;
        if (!survivingWorktreeIds.has(worktreeId)) {
          // best-effort tolerates an already-removed worktree so the record is
          // still deleted; the explicit delete stays strict and surfaces a 409.
          worktreeManager.removeTentacleWorktree(worktreeId, {
            bestEffort: options?.bestEffortWorktree ?? false,
          });
        }
      }
      terminals.delete(cascadeTerminalId);
    }

    persistRegistry();
    for (const cascadeTerminalId of cascadeTerminalIds) {
      broadcastTerminalEvent({ type: "terminal-deleted", terminalId: cascadeTerminalId });
    }
    return true;
  };

  // A terminal is ephemeral when its tentacle is not a durable deck tentacle
  // (no folder under .octogent/tentacles) — an octoboss-direct one-shot on a
  // synthetic tentacle. Those are throwaway; deck tentacles are the context
  // layers meant to persist and be reused across batches.
  const isEphemeralTerminal = (terminal: PersistedTerminal): boolean =>
    !existsSync(join(workspaceCwd, ".octogent", "tentacles", terminal.tentacleId));

  // The flow view's bottom shelf holds a round of finished, not-reused
  // terminals; the next dispatch clears them. A terminal is "reused" while it
  // is still live (running, awaiting-review, or a kept-alive idle worker the
  // orchestrator may still continue over the channel) — those are never
  // touched here; only records without a PTY are finished for good.
  // Finished durable (deck) terminals are archived (record hidden, worktree
  // kept unless merged — the iron rule). Finished ephemeral terminals were
  // never reused this round, so they are removed outright, worktree and all
  // (even unmerged): a throwaway one-shot leaves nothing behind.
  const FINISHED_SHELF_STATES = new Set(["stopped", "exited", "stale", "completed"]);
  const archiveFinishedTerminalsForNewBatch = () => {
    const nowMs = Date.now();
    const archivedTerminals: PersistedTerminal[] = [];
    const ephemeralTerminalIds: string[] = [];
    for (const terminal of terminals.values()) {
      if (terminal.archivedAt) continue;
      if (sessions.has(terminal.terminalId)) continue;
      if (terminal.parentTerminalId) continue; // handled with its top-level chain
      if (!terminal.lifecycleState || !FINISHED_SHELF_STATES.has(terminal.lifecycleState)) continue;

      if (isEphemeralTerminal(terminal)) {
        ephemeralTerminalIds.push(terminal.terminalId);
      } else {
        terminal.archivedAt = new Date(nowMs).toISOString();
        archivedTerminals.push(terminal);
      }
    }
    finalizeArchivedTerminals(archivedTerminals);

    for (const terminalId of ephemeralTerminalIds) {
      // A live child (unlikely for a finished parent) keeps the whole chain.
      const cascade = collectTerminalCascade(terminalId);
      if (cascade.some((id) => sessions.has(id))) continue;
      try {
        // best-effort so an already-removed or stuck worktree never orphans the
        // record — the whole point is that the throwaway leaves nothing behind.
        deleteTerminalInternal(terminalId, { removeWorktree: true, bestEffortWorktree: true });
      } catch {
        // Any other failure must not abort the sweep of the remaining ones.
      }
    }
  };
  const archiveSweepInterval = setInterval(archiveExpiredTerminals, 60 * 60 * 1000);
  if (typeof archiveSweepInterval.unref === "function") {
    archiveSweepInterval.unref();
  }

  // PTY output and tool calls count as activity. Only prompt hooks refreshed
  // lastActiveAt before, so one long turn (many tool calls, no new prompt)
  // read as "stalled" two minutes in while the agent was plainly busy.
  const touchTerminalActivity = (terminalId: string) => {
    const terminal = terminals.get(terminalId);
    if (!terminal) return;
    terminal.lastActiveAt = new Date().toISOString();
    persistRegistry();
  };

  const broadcastTerminalUpdated = (terminalId: string) => {
    const terminal = terminals.get(terminalId);
    if (terminal) {
      broadcastTerminalEvent({
        type: "terminal-updated",
        snapshot: toTerminalSnapshot(terminal),
      });
    }
  };

  const sessionRuntime = createSessionRuntime({
    websocketServer,
    terminals,
    sessions,
    resolveTerminalSession,
    getTentacleWorkspaceCwd: worktreeManager.getTentacleWorkspaceCwd,
    getApiBaseUrl,
    isDebugPtyLogsEnabled,
    ptyLogDir,
    transcriptDirectoryPath,
    maxConcurrentSessions: configuredMaxConcurrentSessions,
    sessionIdleGraceMs: resolveSessionIdleGraceMs(process.env.OCTOGENT_TERMINAL_IDLE_GRACE_MS),
    onStateChange: broadcastTerminalStateChanged,
    onOutputActivity: touchTerminalActivity,
    onSessionStart: markTerminalRunning,
    onSessionEnd: markTerminalEnded,
    onTerminalUpdated: (terminalId) => {
      persistRegistry();
      broadcastTerminalUpdated(terminalId);
    },
  });

  const gitOps = createGitOperations({
    terminals,
    worktreeManager,
    gitClient,
  });

  // On a Stop hook, decide whether this terminal's work is finished and stamp
  // the verdict plus a git-facts completion summary onto the record.
  const evaluateSessionCompletion = (terminalId: string) => {
    const terminal = terminals.get(terminalId);
    if (!terminal) {
      return;
    }

    let worktreeCwd: string | null = null;
    if (terminal.workspaceMode === "worktree") {
      const worktreeId = terminal.worktreeId ?? terminal.terminalId;
      worktreeCwd = worktreeManager.getTentacleWorktreePath(worktreeId);
    }

    const verdict = evaluateCompletionOnStop({
      workspaceMode: terminal.workspaceMode === "worktree" ? "worktree" : "shared",
      worktreeCwd,
      baseRef: resolveWorkspaceBaseRef(),
      run: runGit,
    });
    if (verdict.outcome === "none") {
      return;
    }

    const completedAt = new Date().toISOString();
    terminal.lifecycleState = verdict.outcome;
    terminal.lifecycleReason = undefined;
    terminal.lifecycleUpdatedAt = completedAt;
    terminal.completedAt = completedAt;
    const nextSummary = buildCompletionSummary({
      initialPrompt: terminal.initialPrompt ?? null,
      createdAt: terminal.createdAt ?? null,
      completedAt,
      workspaceMode: terminal.workspaceMode === "worktree" ? "worktree" : "shared",
      gitFacts: verdict.gitFacts,
    });
    // A post-merge re-evaluation sees an empty base..HEAD range; the summary
    // captured at awaiting-review still holds the real commits and diff stats,
    // so keep those and only advance the merged flag.
    const previousSummary = terminal.completionSummary;
    terminal.completionSummary =
      nextSummary.commits.length === 0 && previousSummary && previousSummary.commits.length > 0
        ? { ...previousSummary, merged: nextSummary.merged, durationMs: nextSummary.durationMs }
        : nextSummary;
    persistRegistry();
    broadcastTerminalEvent({
      type: "terminal-lifecycle-changed",
      terminalId,
      lifecycleState: verdict.outcome,
    });
  };

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
    evaluateSessionCompletion,
    reviveSessionTranscript: (terminalId) => sessionRuntime.reviveSessionTranscript(terminalId),
    sendInitialPromptNow: sessionRuntime.sendInitialPromptNow,
    acknowledgeInitialPrompt: sessionRuntime.acknowledgeInitialPrompt,
    onTerminalUpdated: broadcastTerminalUpdated,
    recordToolUse: (terminalId, toolName) => {
      touchTerminalActivity(terminalId);
      sessionRuntime.appendSessionTranscriptEvent(terminalId, {
        type: "tool_use",
        toolName,
        timestamp: new Date().toISOString(),
      });
    },
    releaseSessionKeepAlive: sessionRuntime.releaseSessionKeepAlive,
    onStateChange: broadcastTerminalStateChanged,
  });

  const agentProviderAdapters = createAgentProviderAdapters({
    installClaudeHooks: hookProcessor.installHooksInDirectory,
    ensureClaudeTrusted: ensureDirectoryTrusted,
    // Codex's TUI only reliably loads hooks from the user-level layer
    // (project-layer hooks are never loaded from git worktree sessions), so
    // the hooks live in $CODEX_HOME/hooks.json guarded by $OCTOGENT_SESSION_ID
    // and one shared install serves every terminal. Trust is seeded for the
    // workspace root, which is where Codex resolves a worktree's project.
    installCodexHooks: () => installCodexHooks(getApiBaseUrl()),
    ensureCodexTrusted: (_targetCwd, installedHandlers) =>
      ensureCodexDirectoryTrusted(workspaceCwd, installedHandlers),
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
    const lifecycleState: TerminalLifecycleState = resolveSnapshotLifecycle(
      session !== undefined,
      terminal.lifecycleState,
    );
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
      ...(terminal.agentProvider ? { agentProvider: terminal.agentProvider } : {}),
      ...(terminal.agentModel ? { agentModel: terminal.agentModel } : {}),
      ...(terminal.agentEffortTier ? { agentEffortTier: terminal.agentEffortTier } : {}),
      ...(terminal.agentModelObserved ? { agentModelObserved: terminal.agentModelObserved } : {}),
      ...(terminal.completedAt ? { completedAt: terminal.completedAt } : {}),
      ...(terminal.completionSummary ? { completionSummary: terminal.completionSummary } : {}),
      ...(session ? { agentRuntimeState: session.agentState } : {}),
      lifecycleState,
      ...(terminal.lifecycleReason ? { lifecycleReason: terminal.lifecycleReason } : {}),
      ...(terminal.lifecycleUpdatedAt ? { lifecycleUpdatedAt: terminal.lifecycleUpdatedAt } : {}),
      ...(terminal.processId ? { processId: terminal.processId } : {}),
      ...(terminal.startedAt ? { startedAt: terminal.startedAt } : {}),
      ...(terminal.endedAt ? { endedAt: terminal.endedAt } : {}),
      ...(terminal.exitCode !== undefined ? { exitCode: terminal.exitCode } : {}),
      ...(terminal.exitSignal !== undefined ? { exitSignal: terminal.exitSignal } : {}),
      ...(terminal.archivedAt ? { archivedAt: terminal.archivedAt } : {}),
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

  // Catch up on records that expired while the process was down: with an
  // hourly cadence, a frequently restarted server would otherwise never sweep.
  // (Runs here, after the broadcast helpers exist; no clients are connected
  // yet, so the terminal-updated events are no-ops at startup.)
  archiveExpiredTerminals();

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
    agentModel,
    agentEffort,
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
    agentModel?: string;
    agentEffort?: EffortTier;
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
    } else {
      // A new top-level dispatch is the "next batch": clear the previous round
      // of finished terminals off the flow-view shelf. Swarm children (which
      // carry a parentTerminalId) do not count as a new batch.
      archiveFinishedTerminalsForNewBatch();
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

    const effectiveProvider = agentProvider ?? DEFAULT_AGENT_PROVIDER;
    const modelSelection = resolveAgentModelSelection({
      provider: effectiveProvider,
      ...(agentModel !== undefined ? { model: agentModel } : {}),
      ...(agentEffort !== undefined ? { effort: agentEffort } : {}),
    });

    const terminal: PersistedTerminal = {
      terminalId,
      tentacleId,
      ...(worktreeId ? { worktreeId } : {}),
      tentacleName: effectiveName,
      nameOrigin: nameOrigin ?? (tentacleName ? "user" : "generated"),
      ...(autoRenamePromptContext ? { autoRenamePromptContext } : {}),
      createdAt: new Date().toISOString(),
      workspaceMode,
      agentProvider: effectiveProvider,
      ...(modelSelection ? { agentModel: modelSelection.model } : {}),
      ...(modelSelection?.codexReasoningEffort
        ? { agentReasoningEffort: modelSelection.codexReasoningEffort }
        : {}),
      ...(modelSelection?.effortTier ? { agentEffortTier: modelSelection.effortTier } : {}),
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

    try {
      // The terminal is not in the registry yet, so resolve the worktree path
      // directly; getTentacleWorkspaceCwd would throw and this whole block
      // would be skipped, leaving worktree agents without hooks or trust.
      const hookTargetCwd = shouldCreateWorktree
        ? worktreeManager.getTentacleWorktreePath(effectiveWorktreeId)
        : workspaceCwd;
      // A worktree is a path the agent has never seen, so its trust prompt
      // would strand the session before the first instruction is read; each
      // provider adapter installs its hooks and pre-seeds trust accordingly.
      resolveAgentProviderAdapter(agentProviderAdapters, terminal.agentProvider).prepareWorkspace(
        hookTargetCwd,
      );
    } catch {
      // Best-effort: workspace preparation should not block terminal creation.
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
    listTerminalSnapshots(options?: { includeArchived?: boolean }): TerminalSnapshot[] {
      const snapshots: TerminalSnapshot[] = [];
      for (const terminal of terminals.values()) {
        if (terminal.archivedAt && !options?.includeArchived) {
          continue;
        }
        snapshots.push(toTerminalSnapshot(terminal));
      }
      return snapshots;
    },

    readHealthCounts(): {
      ptySessions: number;
      terminals: Record<TerminalLifecycleState, number>;
      terminalEventClients: number;
    } {
      const terminalCounts: Record<TerminalLifecycleState, number> = {
        registered: 0,
        running: 0,
        stopped: 0,
        exited: 0,
        stale: 0,
        stalled: 0,
        "awaiting-review": 0,
        completed: 0,
      };
      for (const terminal of terminals.values()) {
        // Mirror toTerminalSnapshot so health counts agree with what the UI shows.
        const lifecycleState: TerminalLifecycleState = resolveSnapshotLifecycle(
          sessions.has(terminal.terminalId),
          terminal.lifecycleState,
        );
        terminalCounts[lifecycleState] += 1;
      }

      return {
        ptySessions: sessions.size,
        terminals: terminalCounts,
        terminalEventClients: terminalEventClients.size,
      };
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
      // Without this stamp the client replays the nav-index migration on every
      // load and the restored page shifts by one per refresh.
      if (patch.navSchemaVersion !== undefined) {
        uiState.navSchemaVersion = patch.navSchemaVersion;
      }
      if (patch.terminalInactivityThresholdMs !== undefined) {
        uiState.terminalInactivityThresholdMs = patch.terminalInactivityThresholdMs;
      }
      if (patch.locale !== undefined) {
        uiState.locale = patch.locale;
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

    archiveTerminal(terminalId: string): TerminalSnapshot | null {
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        return null;
      }

      if (hasBusySession(terminalId) || terminal.lifecycleState === "running") {
        throw new RuntimeInputError(
          `Terminal "${terminalId}" is running. Stop it before archiving.`,
        );
      }

      sessionRuntime.releaseSessionKeepAlive(terminalId);
      if (!terminal.archivedAt) {
        terminal.archivedAt = new Date().toISOString();
        persistRegistry();
        broadcastTerminalEvent({
          type: "terminal-updated",
          snapshot: toTerminalSnapshot(terminal),
        });
      }

      return toTerminalSnapshot(terminal);
    },

    archiveCompletedTerminals(): string[] {
      const archivedAt = new Date().toISOString();
      const archivedTerminalIds: string[] = [];

      for (const terminal of terminals.values()) {
        if (terminal.archivedAt || terminal.lifecycleState !== "completed") {
          continue;
        }
        if (hasBusySession(terminal.terminalId)) {
          continue;
        }

        sessionRuntime.releaseSessionKeepAlive(terminal.terminalId);
        terminal.archivedAt = archivedAt;
        archivedTerminalIds.push(terminal.terminalId);
      }

      if (archivedTerminalIds.length === 0) {
        return [];
      }

      persistRegistry();
      for (const terminalId of archivedTerminalIds) {
        const terminal = terminals.get(terminalId);
        if (terminal) {
          broadcastTerminalEvent({
            type: "terminal-updated",
            snapshot: toTerminalSnapshot(terminal),
          });
        }
      }
      return archivedTerminalIds;
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

    // Reclaims worktrees (directory and branch) whose archived records prove a
    // merge. Records themselves are untouched — that is what prune is for.
    gcWorktrees(options?: { dryRun?: boolean }): {
      dryRun: boolean;
      candidates: Array<{ worktreeId: string; terminalIds: string[] }>;
      reclaimedWorktreeIds: string[];
      failedWorktreeIds: string[];
    } {
      const dryRun = options?.dryRun === true;
      const candidates = listReclaimableWorktreeCandidates();
      const reclaimedWorktreeIds: string[] = [];
      const failedWorktreeIds: string[] = [];

      if (!dryRun) {
        for (const candidate of candidates) {
          (reclaimWorktree(candidate.worktreeId) ? reclaimedWorktreeIds : failedWorktreeIds).push(
            candidate.worktreeId,
          );
        }
      }

      return { dryRun, candidates, reclaimedWorktreeIds, failedWorktreeIds };
    },

    // What deleting this terminal with its worktree would cost: how many
    // commits on the branch are not yet merged into the workspace, and whether
    // another terminal shares the worktree. The CLI shows this before removing.
    previewTerminalDeletion(terminalId: string): {
      exists: boolean;
      workspaceMode?: TentacleWorkspaceMode;
      worktreeId?: string;
      sharedWithTerminalIds: string[];
      unmergedCommitCount: number;
      branch: string | null;
    } {
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        return { exists: false, sharedWithTerminalIds: [], unmergedCommitCount: 0, branch: null };
      }
      if (terminal.workspaceMode !== "worktree") {
        return {
          exists: true,
          workspaceMode: terminal.workspaceMode,
          sharedWithTerminalIds: [],
          unmergedCommitCount: 0,
          branch: null,
        };
      }

      const cascadeSet = new Set(collectTerminalCascade(terminalId));
      const worktreeId = terminal.worktreeId ?? terminal.tentacleId;
      const sharedWithTerminalIds = [...terminals.values()]
        .filter(
          (record) =>
            !cascadeSet.has(record.terminalId) &&
            record.workspaceMode === "worktree" &&
            (record.worktreeId ?? record.tentacleId) === worktreeId,
        )
        .map((record) => record.terminalId);

      let unmergedCommitCount = 0;
      let branch: string | null = null;
      try {
        const facts = collectCompletionGitFacts(
          worktreeManager.getTentacleWorktreePath(worktreeId),
          resolveWorkspaceBaseRef(),
          runGit,
        );
        if (facts && !facts.merged) {
          unmergedCommitCount = facts.commits.length;
          branch = facts.branch;
        }
      } catch {
        // A missing/broken worktree simply reports no unmerged commits.
      }

      return {
        exists: true,
        workspaceMode: terminal.workspaceMode,
        worktreeId,
        sharedWithTerminalIds,
        unmergedCommitCount,
        branch,
      };
    },

    deleteTerminal(terminalId: string, options?: { removeWorktree?: boolean }): boolean {
      return deleteTerminalInternal(terminalId, options);
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

    // Deck content changes through routes that never touch a terminal — and a
    // tentacle created from the CLI has no browser round trip at all — so an
    // open page needs to be told to refetch.
    broadcastDeckChanged(): void {
      broadcastTerminalEvent({ type: "deck-changed" });
    },

    async close() {
      clearInterval(stallDetectorInterval);
      clearInterval(archiveSweepInterval);
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
