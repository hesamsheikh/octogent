import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { TERMINAL_REGISTRY_VERSION } from "./constants";

import { toErrorMessage } from "./systemClients";
import type {
  PersistedTerminal,
  PersistedUiState,
  TentacleWorkspaceMode,
  TerminalLifecycleState,
  TerminalNameOrigin,
  TerminalRegistryDocument,
} from "./types";
import { isTerminalAgentProvider, isTerminalCompletionSoundId } from "./types";

const REGISTRY_PERSIST_DEBOUNCE_MS = 100;

type TerminalRegistryState = {
  terminals: Map<string, PersistedTerminal>;
  uiState: PersistedUiState;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isTerminalNameOrigin = (value: unknown): value is TerminalNameOrigin =>
  value === "generated" || value === "user" || value === "prompt";

const isTerminalLifecycleState = (value: unknown): value is TerminalLifecycleState =>
  value === "registered" ||
  value === "running" ||
  value === "stopped" ||
  value === "exited" ||
  value === "stale" ||
  value === "stalled" ||
  value === "awaiting-review" ||
  value === "completed";

// The registry file is a contract surface: parse the persisted completion
// summary defensively rather than trusting its shape, and drop it entirely
// when the load-bearing `merged` flag is missing — worktree gc must never act
// on a summary it cannot trust.
const parseTerminalCompletionSummary = (value: unknown): PersistedTerminal["completionSummary"] => {
  if (!isRecord(value) || typeof value.merged !== "boolean") {
    return undefined;
  }

  const commits = Array.isArray(value.commits)
    ? value.commits.flatMap((commit) =>
        isRecord(commit) && typeof commit.hash === "string" && typeof commit.message === "string"
          ? [{ hash: commit.hash, message: commit.message }]
          : [],
      )
    : [];

  return {
    taskLine: typeof value.taskLine === "string" ? value.taskLine : null,
    commits,
    filesChanged: typeof value.filesChanged === "number" ? value.filesChanged : 0,
    insertions: typeof value.insertions === "number" ? value.insertions : 0,
    deletions: typeof value.deletions === "number" ? value.deletions : 0,
    branch: typeof value.branch === "string" ? value.branch : null,
    merged: value.merged,
    durationMs: typeof value.durationMs === "number" ? value.durationMs : null,
    workspaceMode: value.workspaceMode === "worktree" ? "worktree" : "shared",
  };
};

const inferTerminalNameOrigin = (terminalId: string, tentacleName: string): TerminalNameOrigin => {
  if (tentacleName === terminalId || /^Octogent Terminal \d+$/.test(tentacleName)) {
    return "generated";
  }

  return "user";
};

const parsePersistedUiState = (value: unknown): PersistedUiState => {
  if (!isRecord(value)) {
    return {};
  }

  const nextState: PersistedUiState = {};

  if (typeof value.isAgentsSidebarVisible === "boolean") {
    nextState.isAgentsSidebarVisible = value.isAgentsSidebarVisible;
  }

  if (typeof value.sidebarWidth === "number" && Number.isFinite(value.sidebarWidth)) {
    nextState.sidebarWidth = value.sidebarWidth;
  }

  if (typeof value.isActiveAgentsSectionExpanded === "boolean") {
    nextState.isActiveAgentsSectionExpanded = value.isActiveAgentsSectionExpanded;
  }

  if (typeof value.isRuntimeStatusStripVisible === "boolean") {
    nextState.isRuntimeStatusStripVisible = value.isRuntimeStatusStripVisible;
  }

  if (typeof value.isMonitorVisible === "boolean") {
    nextState.isMonitorVisible = value.isMonitorVisible;
  }

  if (typeof value.isBottomTelemetryVisible === "boolean") {
    nextState.isBottomTelemetryVisible = value.isBottomTelemetryVisible;
  }

  if (typeof value.isCodexUsageVisible === "boolean") {
    nextState.isCodexUsageVisible = value.isCodexUsageVisible;
  }

  if (typeof value.isClaudeUsageVisible === "boolean") {
    nextState.isClaudeUsageVisible = value.isClaudeUsageVisible;
  }

  if (typeof value.isClaudeUsageSectionExpanded === "boolean") {
    nextState.isClaudeUsageSectionExpanded = value.isClaudeUsageSectionExpanded;
  }

  if (typeof value.isCodexUsageSectionExpanded === "boolean") {
    nextState.isCodexUsageSectionExpanded = value.isCodexUsageSectionExpanded;
  }

  const completionSoundValue = value.terminalCompletionSound;
  if (isTerminalCompletionSoundId(completionSoundValue)) {
    nextState.terminalCompletionSound = completionSoundValue;
  }

  const minimizedIds = value.minimizedTerminalIds;
  if (Array.isArray(minimizedIds)) {
    const ids = minimizedIds.filter((id): id is string => typeof id === "string");
    nextState.minimizedTerminalIds = [...new Set(ids)];
  }

  const widths = value.terminalWidths;
  if (isRecord(widths)) {
    const terminalWidths = Object.entries(widths).reduce<Record<string, number>>(
      (acc, [id, width]) => {
        if (typeof width === "number" && Number.isFinite(width)) {
          acc[id] = width;
        }
        return acc;
      },
      {},
    );
    nextState.terminalWidths = terminalWidths;
  }

  if (Array.isArray(value.canvasOpenTerminalIds)) {
    nextState.canvasOpenTerminalIds = value.canvasOpenTerminalIds.filter(
      (id): id is string => typeof id === "string",
    );
  }

  if (Array.isArray(value.canvasOpenTentacleIds)) {
    nextState.canvasOpenTentacleIds = value.canvasOpenTentacleIds.filter(
      (id): id is string => typeof id === "string",
    );
  }

  if (
    typeof value.canvasTerminalsPanelWidth === "number" &&
    Number.isFinite(value.canvasTerminalsPanelWidth)
  ) {
    nextState.canvasTerminalsPanelWidth = value.canvasTerminalsPanelWidth;
  }

  return nextState;
};

export const pruneUiStateTerminalReferences = (
  uiState: PersistedUiState,
  terminals: Map<string, PersistedTerminal>,
): PersistedUiState => {
  const activeTerminalIds = new Set(terminals.keys());
  const nextState: PersistedUiState = {
    ...uiState,
  };

  if (nextState.minimizedTerminalIds) {
    nextState.minimizedTerminalIds = nextState.minimizedTerminalIds.filter((id) =>
      activeTerminalIds.has(id),
    );
  }

  if (nextState.terminalWidths) {
    nextState.terminalWidths = Object.entries(nextState.terminalWidths).reduce<
      Record<string, number>
    >((acc, [id, width]) => {
      if (activeTerminalIds.has(id)) {
        acc[id] = width;
      }
      return acc;
    }, {});
  }

  return nextState;
};

/**
 * Migrate a v1/v2 registry document to v3 terminal format.
 * Each old tentacle entry becomes a terminal where terminalId = tentacleId.
 * Child agents are dropped.
 */
const migrateV2ToV3 = (
  record: Record<string, unknown>,
  registryPath: string,
): Map<string, PersistedTerminal> => {
  const rawTentacles = record.tentacles;
  if (!Array.isArray(rawTentacles)) {
    throw new Error(`Invalid registry tentacles array (${registryPath}).`);
  }

  const terminals = new Map<string, PersistedTerminal>();
  for (const item of rawTentacles) {
    if (item === null || typeof item !== "object") {
      throw new Error(`Invalid tentacle entry in registry (${registryPath}).`);
    }

    const entry = item as Record<string, unknown>;
    const tentacleId = typeof entry.tentacleId === "string" ? entry.tentacleId : null;
    const tentacleName = typeof entry.tentacleName === "string" ? entry.tentacleName : null;
    const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : null;

    if (!tentacleId || !tentacleName || !createdAt) {
      throw new Error(`Incomplete tentacle entry in registry (${registryPath}).`);
    }

    const rawWorkspaceMode = entry.workspaceMode;
    const workspaceMode: TentacleWorkspaceMode =
      rawWorkspaceMode === "worktree" || rawWorkspaceMode === "shared"
        ? rawWorkspaceMode
        : "shared";

    if (terminals.has(tentacleId)) {
      throw new Error(`Duplicate tentacle id in registry (${registryPath}): ${tentacleId}`);
    }

    terminals.set(tentacleId, {
      terminalId: tentacleId,
      tentacleId,
      tentacleName,
      nameOrigin: inferTerminalNameOrigin(tentacleId, tentacleName),
      createdAt,
      workspaceMode,
    });
  }

  return terminals;
};

const parseV3Terminals = (
  record: Record<string, unknown>,
  registryPath: string,
): Map<string, PersistedTerminal> => {
  const rawTerminals = record.terminals;
  if (!Array.isArray(rawTerminals)) {
    throw new Error(`Invalid registry terminals array (${registryPath}).`);
  }

  const terminals = new Map<string, PersistedTerminal>();
  for (const item of rawTerminals) {
    if (item === null || typeof item !== "object") {
      throw new Error(`Invalid terminal entry in registry (${registryPath}).`);
    }

    const entry = item as Record<string, unknown>;
    const terminalId = typeof entry.terminalId === "string" ? entry.terminalId : null;
    const tentacleId = typeof entry.tentacleId === "string" ? entry.tentacleId : null;
    const tentacleName = typeof entry.tentacleName === "string" ? entry.tentacleName : null;
    const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : null;

    if (!terminalId || !tentacleId || !tentacleName || !createdAt) {
      throw new Error(`Incomplete terminal entry in registry (${registryPath}).`);
    }

    const rawWorkspaceMode = entry.workspaceMode;
    const workspaceMode: TentacleWorkspaceMode =
      rawWorkspaceMode === "worktree" || rawWorkspaceMode === "shared"
        ? rawWorkspaceMode
        : "shared";

    if (terminals.has(terminalId)) {
      throw new Error(`Duplicate terminal id in registry (${registryPath}): ${terminalId}`);
    }

    const terminal: PersistedTerminal = {
      terminalId,
      tentacleId,
      tentacleName,
      nameOrigin: isTerminalNameOrigin(entry.nameOrigin)
        ? entry.nameOrigin
        : inferTerminalNameOrigin(terminalId, tentacleName),
      createdAt,
      workspaceMode,
    };
    if (typeof entry.worktreeId === "string") terminal.worktreeId = entry.worktreeId;
    if (typeof entry.parentTerminalId === "string")
      terminal.parentTerminalId = entry.parentTerminalId;
    if (isTerminalAgentProvider(entry.agentProvider)) terminal.agentProvider = entry.agentProvider;
    if (typeof entry.agentModel === "string") terminal.agentModel = entry.agentModel;
    if (typeof entry.agentEffortTier === "string") terminal.agentEffortTier = entry.agentEffortTier;
    if (typeof entry.agentModelObserved === "string") {
      terminal.agentModelObserved = entry.agentModelObserved;
    }
    if (typeof entry.initialPrompt === "string") terminal.initialPrompt = entry.initialPrompt;
    if (typeof entry.initialInputDraft === "string") {
      terminal.initialInputDraft = entry.initialInputDraft;
    }
    if (typeof entry.autoRenamePromptContext === "string") {
      terminal.autoRenamePromptContext = entry.autoRenamePromptContext;
    }
    if (typeof entry.lastActiveAt === "string") terminal.lastActiveAt = entry.lastActiveAt;
    if (isTerminalLifecycleState(entry.lifecycleState)) {
      terminal.lifecycleState = entry.lifecycleState;
    }
    if (typeof entry.lifecycleReason === "string") {
      terminal.lifecycleReason = entry.lifecycleReason;
    }
    if (typeof entry.lifecycleUpdatedAt === "string") {
      terminal.lifecycleUpdatedAt = entry.lifecycleUpdatedAt;
    }
    if (
      typeof entry.processId === "number" &&
      Number.isInteger(entry.processId) &&
      entry.processId > 0
    ) {
      terminal.processId = entry.processId;
    }
    if (typeof entry.startedAt === "string") terminal.startedAt = entry.startedAt;
    if (typeof entry.endedAt === "string") terminal.endedAt = entry.endedAt;
    if (typeof entry.exitCode === "number" && Number.isFinite(entry.exitCode)) {
      terminal.exitCode = entry.exitCode;
    }
    if (
      (typeof entry.exitSignal === "number" && Number.isFinite(entry.exitSignal)) ||
      typeof entry.exitSignal === "string"
    ) {
      terminal.exitSignal = entry.exitSignal;
    }
    if (typeof entry.archivedAt === "string") terminal.archivedAt = entry.archivedAt;
    if (typeof entry.completedAt === "string") terminal.completedAt = entry.completedAt;
    const completionSummary = parseTerminalCompletionSummary(entry.completionSummary);
    if (completionSummary) terminal.completionSummary = completionSummary;
    terminals.set(terminalId, terminal);
  }

  return terminals;
};

const parseRegistryDocument = (
  raw: string,
  registryPath: string,
): {
  terminals: Map<string, PersistedTerminal>;
  uiState: PersistedUiState;
} => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid terminal registry JSON (${registryPath}): ${toErrorMessage(error)}`);
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`Invalid terminal registry shape (${registryPath}).`);
  }

  const record = parsed as Record<string, unknown>;
  const version = record.version;

  if (version !== 1 && version !== 2 && version !== TERMINAL_REGISTRY_VERSION) {
    throw new Error(`Unsupported terminal registry version in ${registryPath}: ${String(version)}`);
  }

  const terminals =
    version === 1 || version === 2
      ? migrateV2ToV3(record, registryPath)
      : parseV3Terminals(record, registryPath);

  return {
    terminals,
    uiState: pruneUiStateTerminalReferences(parsePersistedUiState(record.uiState), terminals),
  };
};

export const loadTerminalRegistry = (registryPath: string) => {
  if (!existsSync(registryPath)) {
    return {
      terminals: new Map<string, PersistedTerminal>(),
      uiState: {} as PersistedUiState,
    };
  }

  const raw = readFileSync(registryPath, "utf8");
  return parseRegistryDocument(raw, registryPath);
};

const serializeTerminalRegistry = (state: TerminalRegistryState) => {
  const document: TerminalRegistryDocument = {
    version: TERMINAL_REGISTRY_VERSION,
    terminals: [...state.terminals.values()],
    uiState: state.uiState,
  };

  return `${JSON.stringify(document, null, 2)}\n`;
};

const writeSerializedRegistrySync = (registryPath: string, serialized: string) => {
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, serialized, "utf8");
};

const writeSerializedRegistry = async (registryPath: string, serialized: string) => {
  mkdirSync(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, serialized, "utf8");
};

export const persistTerminalRegistry = (registryPath: string, state: TerminalRegistryState) => {
  writeSerializedRegistrySync(registryPath, serializeTerminalRegistry(state));
};

export const createTerminalRegistryPersistence = (registryPath: string) => {
  let pendingSerialized: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let writeLoopPromise: Promise<void> | null = null;
  let lastPersistedSerialized: string | null = null;

  const runWriteLoop = (): Promise<void> => {
    if (writeLoopPromise) {
      return writeLoopPromise;
    }

    if (pendingSerialized === null) {
      return Promise.resolve();
    }

    writeLoopPromise = (async () => {
      while (pendingSerialized !== null) {
        const serialized = pendingSerialized;
        pendingSerialized = null;

        try {
          await writeSerializedRegistry(registryPath, serialized);
          lastPersistedSerialized = serialized;
        } catch (error) {
          console.warn("[terminal-registry] Failed to persist registry:", error);
        }
      }
    })().finally(() => {
      writeLoopPromise = null;
      if (pendingSerialized !== null) {
        void runWriteLoop();
      }
    });

    return writeLoopPromise;
  };

  const clearDebounceTimer = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const flush = async () => {
    clearDebounceTimer();
    await runWriteLoop();
  };

  return {
    schedulePersist(state: TerminalRegistryState) {
      const serialized = serializeTerminalRegistry(state);
      if (
        serialized === pendingSerialized ||
        (pendingSerialized === null &&
          writeLoopPromise === null &&
          serialized === lastPersistedSerialized)
      ) {
        return;
      }

      pendingSerialized = serialized;
      clearDebounceTimer();
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runWriteLoop();
      }, REGISTRY_PERSIST_DEBOUNCE_MS);
    },

    flush,

    async close() {
      await flush();
    },
  };
};
