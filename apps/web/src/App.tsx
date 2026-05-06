import { buildTerminalList } from "@octogent/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useBackendLivenessPolling } from "./app/hooks/useBackendLivenessPolling";
import { useCanvasActions } from "./app/hooks/useCanvasActions";
import { useClaudeUsagePolling } from "./app/hooks/useClaudeUsagePolling";
import { useCodexUsagePolling } from "./app/hooks/useCodexUsagePolling";
import { useConsoleKeyboardShortcuts } from "./app/hooks/useConsoleKeyboardShortcuts";
import { useGitHubPrimaryViewModel } from "./app/hooks/useGitHubPrimaryViewModel";
import { useGithubSummaryPolling } from "./app/hooks/useGithubSummaryPolling";
import { useInitialColumnsHydration } from "./app/hooks/useInitialColumnsHydration";
import { useMonitorRuntime } from "./app/hooks/useMonitorRuntime";
import { usePersistedUiState } from "./app/hooks/usePersistedUiState";
import { useTentacleGitLifecycle } from "./app/hooks/useTentacleGitLifecycle";
import { useTerminalCompletionNotification } from "./app/hooks/useTerminalCompletionNotification";
import { useTerminalMutations } from "./app/hooks/useTerminalMutations";
import { useTerminalStateReconciliation } from "./app/hooks/useTerminalStateReconciliation";
import { useTerminalWebSocket } from "./app/hooks/useTerminalWebSocket";
import { useUsageHeatmapPolling } from "./app/hooks/useUsageHeatmapPolling";
import { useWorkspaceSetup } from "./app/hooks/useWorkspaceSetup";
import { useWorkspaceSetupStep } from "./app/hooks/useWorkspaceSetupStep";
import {
  createTerminalRuntimeStateStore,
  stripTerminalRuntimeStates,
} from "./app/terminalRuntimeStateStore";
import type { TerminalView } from "./app/types";
import { clampSidebarWidth } from "./app/uiStateNormalizers";
import { ActiveAgentsSidebar } from "./components/ActiveAgentsSidebar";
import { ConsolePrimaryNav } from "./components/ConsolePrimaryNav";
import { PrimaryViewRouter } from "./components/PrimaryViewRouter";
import { RuntimeStatusStrip } from "./components/RuntimeStatusStrip";
import { SidebarActionPanel } from "./components/SidebarActionPanel";
import { TelemetryTape } from "./components/TelemetryTape";
import { HttpTerminalSnapshotReader } from "./runtime/HttpTerminalSnapshotReader";
import { buildTerminalSnapshotsUrl } from "./runtime/runtimeEndpoints";

export const App = () => {
  const [terminals, setTerminals] = useState<TerminalView>([]);
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
  const runtimeStateStoreRef = useRef(createTerminalRuntimeStateStore());
  const runtimeStateStore = runtimeStateStoreRef.current;

  const readColumns = useCallback(
    async (signal?: AbortSignal) => {
      const readerOptions: { endpoint: string; signal?: AbortSignal } = {
        endpoint: buildTerminalSnapshotsUrl(),
      };
      if (signal) readerOptions.signal = signal;
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

  const { runningWorkspaceSetupStepId, handleRunWorkspaceSetupStep } = useWorkspaceSetupStep({
    runWorkspaceSetupStep,
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
  } = useTentacleGitLifecycle({ columns: terminals });

  useInitialColumnsHydration({
    readColumns,
    readUiState,
    applyHydratedUiState,
    setColumns: setTerminals,
    setLoadError,
    setIsLoading,
    setIsUiStateHydrated,
  });

  useTerminalWebSocket({
    runtimeStateStore,
    setTerminals,
    setRecentlyCreatedTerminal,
    refreshColumns,
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
        current.filter((id) => id !== terminalId),
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
    enabled: isUiStateHydrated && (activePrimaryNav === 3 || isRuntimeStatusStripVisible),
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
  });

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

  const canvasActions = useCanvasActions({
    createTerminal,
    refreshColumns,
    setActivePrimaryNav,
    requestDeleteTerminal,
  });

  const hasSidebarActionPanel =
    conversationsActionPanel !== null ||
    pendingDeleteTerminal !== null ||
    (openGitTentacleId !== null &&
      terminals.find((t) => t.tentacleId === openGitTentacleId)?.workspaceMode === "worktree");

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
    if (!hasSidebarActionPanel || isAgentsSidebarVisible) return;
    setIsAgentsSidebarVisible(true);
  }, [isAgentsSidebarVisible, setIsAgentsSidebarVisible, hasSidebarActionPanel]);

  const sidebarHidden =
    !isAgentsSidebarVisible ||
    activePrimaryNav === 1 ||
    activePrimaryNav === 3 ||
    activePrimaryNav === 4 ||
    activePrimaryNav === 5 ||
    activePrimaryNav === 8;

  return (
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

      <section className="console-main-canvas" aria-label="Main content canvas">
        <div className={`workspace-shell${sidebarHidden ? " workspace-shell--full" : ""}`}>
          {!sidebarHidden && (
            <ActiveAgentsSidebar
              sidebarWidth={sidebarWidth}
              onSidebarWidthChange={(width) => {
                setSidebarWidth(clampSidebarWidth(width));
              }}
              actionPanel={sidebarActionPanel}
              bodyContent={
                activePrimaryNav === 2
                  ? (deckSidebarContent ?? undefined)
                  : activePrimaryNav === 6
                    ? (conversationsSidebarContent ?? undefined)
                    : activePrimaryNav === 7
                      ? (promptsSidebarContent ?? undefined)
                      : undefined
              }
            />
          )}

          <PrimaryViewRouter
            activePrimaryNav={activePrimaryNav}
            deckPrimaryViewProps={{
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
                onRefresh: () => { void refreshGitHubRepoSummary(); },
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
            }}
            canvasPrimaryViewProps={{
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
              onLaunchWorkspaceSetupPlanner: canvasActions.onLaunchWorkspaceSetupPlanner,
              onCanvasOpenTerminalIdsChange: setCanvasOpenTerminalIds,
              onCanvasOpenTentacleIdsChange: setCanvasOpenTentacleIds,
              onCanvasTerminalsPanelWidthChange: setCanvasTerminalsPanelWidth,
              onCreateAgent: canvasActions.onCreateAgent,
              onCreateTerminal: canvasActions.onCreateTerminal,
              onCreateWorktreeTerminal: canvasActions.onCreateWorktreeTerminal,
              onCreateTentacle: canvasActions.onCreateTentacle,
              onSpawnSwarm: canvasActions.onSpawnSwarm,
              onOctobossAction: canvasActions.onOctobossAction,
              onTentacleAction: canvasActions.onTentacleAction,
              onNavigateToConversation: canvasActions.onNavigateToConversation,
              onCloseActiveSession: canvasActions.onCloseActiveSession,
              onDeleteActiveSession: canvasActions.onDeleteActiveSession,
              pendingDeleteTerminal,
              isDeletingTerminalId,
              onCancelDelete: clearPendingDeleteTerminal,
              onConfirmDelete: () => { void confirmDeleteTerminal(); },
              onTerminalRenamed: handleTerminalRenamed,
              onTerminalActivity: handleTerminalActivity,
              onRefreshColumns: async () => { await refreshColumns(); },
            }}
            conversationsEnabled={isUiStateHydrated && activePrimaryNav === 6}
            onConversationsSidebarContent={setConversationsSidebarContent}
            onConversationsActionPanel={setConversationsActionPanel}
            promptsEnabled={isUiStateHydrated && activePrimaryNav === 7}
            onPromptsSidebarContent={setPromptsSidebarContent}
          />
        </div>
      </section>

      {isUiStateHydrated && isMonitorVisible && isBottomTelemetryVisible && (
        <TelemetryTape monitorFeed={monitorRuntime.monitorFeed} />
      )}
    </div>
  );
};
