import { type TerminalSnapshot, buildTerminalList, isAgentRuntimeState, t } from "@octogent/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { NAV_INDEX } from "./app/constants";

import { useBackendLivenessPolling } from "./app/hooks/useBackendLivenessPolling";
import { OCTOBOSS_ID } from "./app/hooks/useCanvasGraphData";
import { useClaudeUsagePolling } from "./app/hooks/useClaudeUsagePolling";
import { useCodexUsagePolling } from "./app/hooks/useCodexUsagePolling";
import { useConsoleKeyboardShortcuts } from "./app/hooks/useConsoleKeyboardShortcuts";
import { useGitHubPrimaryViewModel } from "./app/hooks/useGitHubPrimaryViewModel";
import { useGithubSummaryPolling } from "./app/hooks/useGithubSummaryPolling";
import { useInitialColumnsHydration } from "./app/hooks/useInitialColumnsHydration";
import { useMonitorRuntime } from "./app/hooks/useMonitorRuntime";
import { usePersistedUiState } from "./app/hooks/usePersistedUiState";
import { useReconnectingSocket } from "./app/hooks/useReconnectingSocket";
import { useTentacleGitLifecycle } from "./app/hooks/useTentacleGitLifecycle";
import { useTerminalCompletionNotification } from "./app/hooks/useTerminalCompletionNotification";
import { useTerminalMutations } from "./app/hooks/useTerminalMutations";
import { useTerminalStateReconciliation } from "./app/hooks/useTerminalStateReconciliation";
import { useUsageHeatmapPolling } from "./app/hooks/useUsageHeatmapPolling";
import { useWorkspaceSetup } from "./app/hooks/useWorkspaceSetup";
import { LocaleProvider } from "./app/providers/LocaleProvider";
import {
  createTerminalRuntimeStateStore,
  getTerminalRuntimeStateInfo,
  stripTerminalRuntimeState,
  stripTerminalRuntimeStates,
} from "./app/terminalRuntimeStateStore";
import type { TerminalView } from "./app/types";
import { clampSidebarWidth } from "./app/uiStateNormalizers";
import { ActiveAgentsSidebar } from "./components/ActiveAgentsSidebar";
import { ConsolePrimaryNav } from "./components/ConsolePrimaryNav";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PrimaryViewRouter } from "./components/PrimaryViewRouter";
import { RuntimeStatusStrip } from "./components/RuntimeStatusStrip";
import { SidebarActionPanel } from "./components/SidebarActionPanel";
import { TelemetryTape } from "./components/TelemetryTape";
import { HttpTerminalSnapshotReader } from "./runtime/HttpTerminalSnapshotReader";
import {
  buildTerminalEventsSocketUrl,
  buildTerminalSnapshotsUrl,
} from "./runtime/runtimeEndpoints";

// Views that own the full canvas and never show the agents sidebar.
const SIDEBARLESS_NAV: ReadonlySet<number> = new Set([
  NAV_INDEX.flow,
  NAV_INDEX.agents,
  NAV_INDEX.activity,
  NAV_INDEX.codeIntel,
  NAV_INDEX.monitor,
  NAV_INDEX.settings,
]);

export const App = () => {
  const [terminals, setTerminals] = useState<TerminalView>([]);
  // Bumped when the server says deck content changed, so a page that never
  // made the change (a tentacle created from the CLI) still refetches.
  const [deckRevision, setDeckRevision] = useState(0);
  const [recentlyCreatedTerminal, setRecentlyCreatedTerminal] = useState<
    TerminalView[number] | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoveredGitHubOverviewPointIndex, setHoveredGitHubOverviewPointIndex] = useState<
    number | null
  >(null);
  const [deckSidebarContent, setDeckSidebarContent] = useState<ReactNode>(null);
  const [conversationsSidebarContent, setConversationsSidebarContent] = useState<ReactNode>(null);
  const [conversationsActionPanel, setConversationsActionPanel] = useState<ReactNode>(null);
  const [promptsSidebarContent, setPromptsSidebarContent] = useState<ReactNode>(null);
  const terminalEventsRefreshTimerRef = useRef<number | null>(null);
  const runtimeStateStoreRef = useRef(createTerminalRuntimeStateStore());
  const runtimeStateStore = runtimeStateStoreRef.current;

  const sortTerminalSnapshots = useCallback(
    (snapshots: TerminalView) =>
      [...snapshots].sort((left, right) => {
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }),
    [],
  );

  const {
    activePrimaryNav,
    setActivePrimaryNav,
    applyHydratedUiState,
    isActiveAgentsSectionExpanded,
    isAgentsSidebarVisible,
    isBottomTelemetryVisible,
    isClaudeUsageSectionExpanded,
    isCodexUsageSectionExpanded,
    isMonitorVisible,
    isRuntimeStatusStripVisible,
    isUiStateHydrated,
    minimizedTerminalIds,
    readUiState,
    setIsActiveAgentsSectionExpanded,
    setIsAgentsSidebarVisible,
    setIsBottomTelemetryVisible,
    setIsClaudeUsageSectionExpanded,
    setIsCodexUsageSectionExpanded,
    setIsMonitorVisible,
    setIsRuntimeStatusStripVisible,
    setIsUiStateHydrated,
    setMinimizedTerminalIds,
    setSidebarWidth,
    setTerminalCompletionSound,
    sidebarWidth,
    terminalCompletionSound,
    locale,
    setLocale,
    canvasOpenTerminalIds,
    setCanvasOpenTerminalIds,
    canvasOpenTentacleIds,
    setCanvasOpenTentacleIds,
    canvasTerminalsPanelWidth,
    setCanvasTerminalsPanelWidth,
  } = usePersistedUiState({ columns: terminals });
  const {
    workspaceSetup,
    isWorkspaceSetupLoading,
    workspaceSetupError,
    refreshWorkspaceSetup,
    runWorkspaceSetupStep,
  } = useWorkspaceSetup();
  const [runningWorkspaceSetupStepId, setRunningWorkspaceSetupStepId] = useState<
    | "initialize-workspace"
    | "ensure-gitignore"
    | "check-claude"
    | "check-git"
    | "check-curl"
    | "create-tentacles"
    | null
  >(null);

  const readColumns = useCallback(
    async (signal?: AbortSignal) => {
      const readerOptions: { endpoint: string; signal?: AbortSignal } = {
        endpoint: buildTerminalSnapshotsUrl(),
      };
      if (signal) {
        readerOptions.signal = signal;
      }
      const reader = new HttpTerminalSnapshotReader(readerOptions);
      const nextColumns = await buildTerminalList(reader);
      runtimeStateStore.syncFromTerminals(nextColumns);
      return stripTerminalRuntimeStates(nextColumns);
    },
    [runtimeStateStore],
  );

  const refreshColumns = useCallback(async () => {
    const nextColumns = await readColumns();
    setTerminals(nextColumns);
    return nextColumns;
  }, [readColumns]);

  const {
    clearPendingDeleteTerminal,
    confirmDeleteTerminal,
    createTerminal,
    isCreatingTerminal,
    isDeletingTerminalId,
    pendingDeleteTerminal,
    requestDeleteTerminal,
  } = useTerminalMutations({
    readColumns: async () => readColumns(),
    setColumns: setTerminals,
    setLoadError,
    setMinimizedTerminalIds,
  });

  const {
    gitStatusByTentacleId,
    gitStatusLoadingByTentacleId,
    pullRequestByTentacleId,
    pullRequestLoadingByTentacleId,
    openGitTentacleId,
    openGitTentacleStatus,
    openGitTentaclePullRequest,
    gitCommitMessageDraft,
    gitDialogError,
    isGitDialogLoading,
    isGitDialogMutating,
    setGitCommitMessageDraft,
    openTentacleGitActions,
    closeTentacleGitActions,
    commitTentacleChanges,
    commitAndPushTentacleBranch,
    pushTentacleBranch,
    syncTentacleBranch,
    mergeTentaclePullRequest,
  } = useTentacleGitLifecycle({
    columns: terminals,
  });

  useInitialColumnsHydration({
    readColumns,
    readUiState,
    applyHydratedUiState,
    setColumns: setTerminals,
    setLoadError,
    setIsLoading,
    setIsUiStateHydrated,
  });

  useEffect(() => {
    return () => {
      if (terminalEventsRefreshTimerRef.current !== null) {
        window.clearTimeout(terminalEventsRefreshTimerRef.current);
        terminalEventsRefreshTimerRef.current = null;
      }
    };
  }, []);

  const handleTerminalEventsMessage = useCallback(
    (data: string) => {
      try {
        const payload = JSON.parse(data) as
          | {
              type?: unknown;
              snapshot?: TerminalSnapshot;
              terminalId?: string;
              agentRuntimeState?: string;
              toolName?: string;
            }
          | undefined;
        if (!payload || typeof payload.type !== "string") {
          return;
        }

        if (payload.type === "terminal-created" || payload.type === "terminal-updated") {
          if (!payload.snapshot) {
            return;
          }
          const runtimeState = getTerminalRuntimeStateInfo(payload.snapshot);
          runtimeStateStore.setRuntimeState(payload.snapshot.terminalId, runtimeState);
          const structuralSnapshot = stripTerminalRuntimeState(payload.snapshot);
          if (payload.type === "terminal-created") {
            setRecentlyCreatedTerminal(structuralSnapshot as TerminalView[number]);
          }
          setTerminals((current) =>
            sortTerminalSnapshots([
              ...current.filter(
                (terminal) => terminal.terminalId !== structuralSnapshot.terminalId,
              ),
              structuralSnapshot,
            ]),
          );
          return;
        }

        if (payload.type === "terminal-state-changed") {
          if (!payload.terminalId || !isAgentRuntimeState(payload.agentRuntimeState)) {
            return;
          }
          runtimeStateStore.setRuntimeState(payload.terminalId, {
            state: payload.agentRuntimeState,
            ...(payload.toolName ? { toolName: payload.toolName } : {}),
          });
          return;
        }

        if (payload.type === "deck-changed") {
          setDeckRevision((current) => current + 1);
          return;
        }

        if (payload.type === "terminal-deleted") {
          if (!payload.terminalId) {
            return;
          }
          runtimeStateStore.removeTerminal(payload.terminalId);
          setTerminals((current) =>
            current.filter((terminal) => terminal.terminalId !== payload.terminalId),
          );
          return;
        }

        if (payload.type !== "terminal-list-changed") {
          return;
        }
      } catch {
        return;
      }

      if (terminalEventsRefreshTimerRef.current !== null) {
        window.clearTimeout(terminalEventsRefreshTimerRef.current);
      }
      terminalEventsRefreshTimerRef.current = window.setTimeout(() => {
        terminalEventsRefreshTimerRef.current = null;
        void refreshColumns();
      }, 100);
    },
    [refreshColumns, runtimeStateStore, sortTerminalSnapshots],
  );

  const handleTerminalEventsReconnect = useCallback(() => {
    // The socket may have missed create/update/state/deck events while the
    // server was away; refetch terminals and force deck consumers (canvas,
    // flow) to refetch too.
    void refreshColumns();
    setDeckRevision((current) => current + 1);
  }, [refreshColumns]);

  useReconnectingSocket({
    buildUrl: buildTerminalEventsSocketUrl,
    onMessage: handleTerminalEventsMessage,
    onReconnect: handleTerminalEventsReconnect,
  });

  const { codexUsageSnapshot, refreshCodexUsage } = useCodexUsagePolling();
  const { claudeUsageSnapshot, isRefreshingClaudeUsage, refreshClaudeUsage } =
    useClaudeUsagePolling();
  const backendLivenessStatus = useBackendLivenessPolling();
  const { githubRepoSummary, isRefreshingGitHubSummary, refreshGitHubRepoSummary } =
    useGithubSummaryPolling();
  const handleMaximizeTerminal = useCallback(
    (terminalId: string) => {
      setMinimizedTerminalIds((current) =>
        current.filter((currentTerminalId) => currentTerminalId !== terminalId),
      );
    },
    [setMinimizedTerminalIds],
  );
  const handleActiveTerminalIdsChange = useCallback(
    (activeTerminalIds: ReadonlySet<string>) => {
      runtimeStateStore.retainTerminalIds(activeTerminalIds);
    },
    [runtimeStateStore],
  );

  useTerminalStateReconciliation({
    columns: terminals,
    setMinimizedTerminalIds,
    onActiveTerminalIdsChange: handleActiveTerminalIdsChange,
  });
  const { playCompletionSoundPreview } = useTerminalCompletionNotification(
    runtimeStateStore,
    terminalCompletionSound,
  );
  const { heatmapData, isLoadingHeatmap, refreshHeatmap } = useUsageHeatmapPolling({
    enabled:
      isUiStateHydrated && (activePrimaryNav === NAV_INDEX.activity || isRuntimeStatusStripVisible),
  });

  useConsoleKeyboardShortcuts({ setActivePrimaryNav });
  const monitorRuntime = useMonitorRuntime({
    enabled: isUiStateHydrated && isMonitorVisible,
  });

  const {
    githubCommitCount30d,
    sparklinePoints,
    githubOverviewGraphSeries,
    githubOverviewGraphPolylinePoints,
    githubOverviewHoverLabel,
    githubStatusPill,
    githubRepoLabel,
    githubStarCountLabel,
    githubOpenIssuesLabel,
    githubOpenPrsLabel,
    githubRecentCommits,
  } = useGitHubPrimaryViewModel({
    githubRepoSummary,
    hoveredGitHubOverviewPointIndex,
    setHoveredGitHubOverviewPointIndex,
    locale,
  });
  const hasSidebarActionPanel =
    conversationsActionPanel !== null ||
    pendingDeleteTerminal !== null ||
    (openGitTentacleId !== null &&
      terminals.find((terminal) => terminal.tentacleId === openGitTentacleId)?.workspaceMode ===
        "worktree");

  const sidebarActionPanel = hasSidebarActionPanel ? (
    conversationsActionPanel ? (
      <>{conversationsActionPanel}</>
    ) : (
      <SidebarActionPanel
        pendingDeleteTerminal={pendingDeleteTerminal}
        isDeletingTerminalId={isDeletingTerminalId}
        clearPendingDeleteTerminal={clearPendingDeleteTerminal}
        confirmDeleteTerminal={confirmDeleteTerminal}
        openGitTentacleId={openGitTentacleId}
        columns={terminals}
        openGitTentacleStatus={openGitTentacleStatus}
        openGitTentaclePullRequest={openGitTentaclePullRequest}
        gitCommitMessageDraft={gitCommitMessageDraft}
        gitDialogError={gitDialogError}
        isGitDialogLoading={isGitDialogLoading}
        isGitDialogMutating={isGitDialogMutating}
        setGitCommitMessageDraft={setGitCommitMessageDraft}
        closeTentacleGitActions={closeTentacleGitActions}
        commitTentacleChanges={commitTentacleChanges}
        commitAndPushTentacleBranch={commitAndPushTentacleBranch}
        pushTentacleBranch={pushTentacleBranch}
        syncTentacleBranch={syncTentacleBranch}
        mergeTentaclePullRequest={mergeTentaclePullRequest}
        requestDeleteTerminal={requestDeleteTerminal}
      />
    )
  ) : null;

  useEffect(() => {
    if (!hasSidebarActionPanel || isAgentsSidebarVisible) {
      return;
    }
    setIsAgentsSidebarVisible(true);
  }, [isAgentsSidebarVisible, setIsAgentsSidebarVisible, hasSidebarActionPanel]);

  const handleTerminalRenamed = useCallback((terminalId: string, tentacleName: string) => {
    setTerminals((current) =>
      current.map((t) =>
        t.terminalId === terminalId ? { ...t, tentacleName, label: tentacleName } : t,
      ),
    );
  }, []);

  const handleTerminalActivity = useCallback((terminalId: string) => {
    setTerminals((current) =>
      current.map((t) => (t.terminalId === terminalId ? { ...t, hasUserPrompt: true } : t)),
    );
  }, []);

  const handleRunWorkspaceSetupStep = useCallback(
    async (
      stepId:
        | "initialize-workspace"
        | "ensure-gitignore"
        | "check-claude"
        | "check-git"
        | "check-curl"
        | "create-tentacles",
    ) => {
      setRunningWorkspaceSetupStepId(stepId);
      try {
        await runWorkspaceSetupStep(stepId);
      } finally {
        setRunningWorkspaceSetupStepId(null);
      }
    },
    [runWorkspaceSetupStep],
  );

  // Rendering before /api/ui-state hydrates would flash the default page (and
  // its nav highlight) for a beat on every reload of any other page; an empty
  // shell for those few milliseconds is invisible instead. The flag is set
  // even when hydration fails, so this can never blank the app permanently.
  if (!isUiStateHydrated) {
    return (
      <LocaleProvider locale={locale} setLocale={setLocale}>
        <div className="page console-shell" />
      </LocaleProvider>
    );
  }

  return (
    <LocaleProvider locale={locale} setLocale={setLocale}>
      <div className="page console-shell">
        {isRuntimeStatusStripVisible && (
          <RuntimeStatusStrip
            sparklinePoints={sparklinePoints}
            usageData={heatmapData}
            claudeUsage={claudeUsageSnapshot}
            isRefreshingClaudeUsage={isRefreshingClaudeUsage}
            onRefreshClaudeUsage={refreshClaudeUsage}
          />
        )}

        <ConsolePrimaryNav
          activePrimaryNav={activePrimaryNav}
          onPrimaryNavChange={setActivePrimaryNav}
        />

        <section
          className="console-main-canvas"
          aria-label={t(locale, "web.a11y.mainContentCanvas")}
        >
          <div
            className={`workspace-shell${isAgentsSidebarVisible && !SIDEBARLESS_NAV.has(activePrimaryNav) ? "" : " workspace-shell--full"}`}
          >
            {isAgentsSidebarVisible && !SIDEBARLESS_NAV.has(activePrimaryNav) && (
              <ActiveAgentsSidebar
                sidebarWidth={sidebarWidth}
                onSidebarWidthChange={(width) => {
                  setSidebarWidth(clampSidebarWidth(width));
                }}
                actionPanel={sidebarActionPanel}
                bodyContent={
                  activePrimaryNav === NAV_INDEX.deck
                    ? (deckSidebarContent ?? undefined)
                    : activePrimaryNav === NAV_INDEX.conversations
                      ? (conversationsSidebarContent ?? undefined)
                      : activePrimaryNav === NAV_INDEX.prompts
                        ? (promptsSidebarContent ?? undefined)
                        : undefined
                }
              />
            )}

            <ErrorBoundary label="PrimaryView">
              <PrimaryViewRouter
                activePrimaryNav={activePrimaryNav}
                flowPrimaryViewProps={{
                  columns: terminals,
                  deckRevision,
                  runtimeStateStore,
                  onOpenTerminal: (terminalId) => {
                    void terminalId;
                    setActivePrimaryNav(NAV_INDEX.agents);
                  },
                }}
                deckPrimaryViewProps={{
                  deckRevision,
                  onSidebarContent: setDeckSidebarContent,
                  workspaceSetup,
                  isWorkspaceSetupLoading,
                  workspaceSetupError,
                  onRefreshWorkspaceSetup: refreshWorkspaceSetup,
                  onRunWorkspaceSetupStep: runWorkspaceSetupStep,
                  suppressWorkspaceSetupCard: true,
                }}
                isMonitorVisible={isMonitorVisible}
                activityPrimaryViewProps={{
                  usageChartProps: {
                    data: heatmapData,
                    isLoading: isLoadingHeatmap,
                    onRefresh: refreshHeatmap,
                  },
                  githubPrimaryViewProps: {
                    githubCommitCount30d,
                    githubOpenIssuesLabel,
                    githubOpenPrsLabel,
                    githubRecentCommits,
                    githubOverviewGraphPolylinePoints,
                    githubOverviewGraphSeries,
                    githubOverviewHoverLabel,
                    githubRepoLabel,
                    githubStarCountLabel,
                    githubStatusPill,
                    hoveredGitHubOverviewPointIndex,
                    isRefreshingGitHubSummary,
                    onHoveredGitHubOverviewPointIndexChange: setHoveredGitHubOverviewPointIndex,
                    onRefresh: () => {
                      void refreshGitHubRepoSummary();
                    },
                  },
                }}
                monitorRuntime={monitorRuntime}
                settingsPrimaryViewProps={{
                  isMonitorVisible,
                  isRuntimeStatusStripVisible,
                  onMonitorVisibilityChange: setIsMonitorVisible,
                  onRuntimeStatusStripVisibilityChange: setIsRuntimeStatusStripVisible,
                  onPreviewTerminalCompletionSound: playCompletionSoundPreview,
                  onTerminalCompletionSoundChange: setTerminalCompletionSound,
                  terminalCompletionSound,
                  locale,
                  onLocaleChange: setLocale,
                }}
                canvasPrimaryViewProps={{
                  deckRevision,
                  columns: terminals,
                  runtimeStateStore,
                  isUiStateHydrated,
                  recentlyCreatedTerminal,
                  canvasOpenTerminalIds,
                  canvasOpenTentacleIds,
                  canvasTerminalsPanelWidth,
                  workspaceSetup,
                  isWorkspaceSetupLoading,
                  workspaceSetupError,
                  runningWorkspaceSetupStepId,
                  onRunWorkspaceSetupStep: handleRunWorkspaceSetupStep,
                  onLaunchWorkspaceSetupPlanner: async () => {
                    const response = await fetch("/api/terminals", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: "tentacle-planner",
                        workspaceMode: "shared",
                        agentProvider: "claude-code",
                        promptTemplate: "tentacle-planner",
                      }),
                    });
                    if (!response.ok) {
                      return undefined;
                    }
                    const snapshot = (await response.json()) as { terminalId?: string };
                    await refreshColumns();
                    if (typeof snapshot.terminalId !== "string") {
                      return undefined;
                    }
                    return snapshot.terminalId;
                  },
                  onCanvasOpenTerminalIdsChange: setCanvasOpenTerminalIds,
                  onCanvasOpenTentacleIdsChange: setCanvasOpenTentacleIds,
                  onCanvasTerminalsPanelWidthChange: setCanvasTerminalsPanelWidth,
                  onCreateAgent: async (tentacleId) => {
                    return await createTerminal("shared", undefined, tentacleId);
                  },
                  onCreateTerminal: async () => {
                    return await createTerminal("shared", undefined, OCTOBOSS_ID);
                  },
                  onCreateWorktreeTerminal: async () => {
                    return await createTerminal("worktree", undefined, OCTOBOSS_ID);
                  },
                  onCreateTentacle: async () => {
                    const response = await fetch("/api/deck/tentacles", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: "", description: "" }),
                    });
                    if (!response.ok) return;
                    await refreshColumns();
                  },
                  onSpawnSwarm: async (tentacleId, workspaceMode) => {
                    const response = await fetch(
                      `/api/deck/tentacles/${encodeURIComponent(tentacleId)}/swarm`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ workspaceMode }),
                      },
                    );
                    if (!response.ok) return;
                  },
                  onOctobossAction: async (action) => {
                    const response = await fetch("/api/terminals", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        workspaceMode: "shared",
                        tentacleId: OCTOBOSS_ID,
                        promptTemplate: action,
                      }),
                    });
                    if (!response.ok) return undefined;
                    const snapshot = (await response.json()) as { terminalId?: string };
                    await refreshColumns();
                    return typeof snapshot.terminalId === "string"
                      ? snapshot.terminalId
                      : undefined;
                  },
                  onTentacleAction: async (tentacleId, action) => {
                    const response = await fetch("/api/terminals", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        workspaceMode: "shared",
                        tentacleId,
                        promptTemplate: action,
                        promptVariables: {
                          tentacleId,
                        },
                      }),
                    });
                    if (!response.ok) return undefined;
                    const snapshot = (await response.json()) as { terminalId?: string };
                    await refreshColumns();
                    return typeof snapshot.terminalId === "string"
                      ? snapshot.terminalId
                      : undefined;
                  },
                  onNavigateToConversation: (_sessionId) => {
                    setActivePrimaryNav(NAV_INDEX.conversations);
                  },
                  onDeleteActiveSession: (terminalId, terminalName, workspaceMode) => {
                    requestDeleteTerminal(terminalId, terminalName, {
                      workspaceMode: workspaceMode === "worktree" ? "worktree" : "shared",
                      intent: "delete-terminal",
                    });
                  },
                  pendingDeleteTerminal,
                  isDeletingTerminalId,
                  onCancelDelete: clearPendingDeleteTerminal,
                  onConfirmDelete: () => {
                    void confirmDeleteTerminal();
                  },
                  onTerminalRenamed: handleTerminalRenamed,
                  onTerminalActivity: handleTerminalActivity,
                  onRefreshColumns: async () => {
                    await refreshColumns();
                  },
                }}
                conversationsEnabled={
                  isUiStateHydrated && activePrimaryNav === NAV_INDEX.conversations
                }
                onConversationsSidebarContent={setConversationsSidebarContent}
                onConversationsActionPanel={setConversationsActionPanel}
                promptsEnabled={isUiStateHydrated && activePrimaryNav === NAV_INDEX.prompts}
                onPromptsSidebarContent={setPromptsSidebarContent}
              />
            </ErrorBoundary>
          </div>
        </section>

        {isUiStateHydrated && isMonitorVisible && isBottomTelemetryVisible && (
          <TelemetryTape monitorFeed={monitorRuntime.monitorFeed} />
        )}
      </div>
    </LocaleProvider>
  );
};
