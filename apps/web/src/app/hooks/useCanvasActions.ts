import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

import type { PrimaryNavIndex } from "../constants";
import type { TerminalAgentProvider, TerminalView, TerminalWorkspaceMode } from "../types";
import { apiClient } from "../../runtime/apiClient";
import {
  buildDeckSwarmUrl,
  buildDeckTentaclesUrl,
  buildTerminalsUrl,
} from "../../runtime/runtimeEndpoints";
import { OCTOBOSS_ID } from "./useCanvasGraphData";

export const useCanvasActions = ({
  createTerminal,
  refreshColumns,
  setActivePrimaryNav,
  requestDeleteTerminal,
}: {
  createTerminal: (
    workspaceMode: TerminalWorkspaceMode,
    agentProvider?: TerminalAgentProvider,
    tentacleId?: string,
  ) => Promise<string | undefined>;
  refreshColumns: () => Promise<TerminalView>;
  setActivePrimaryNav: Dispatch<SetStateAction<PrimaryNavIndex>>;
  requestDeleteTerminal: (
    terminalId: string,
    terminalName: string,
    options: { workspaceMode: TerminalWorkspaceMode; intent: "close-terminal" | "delete-terminal" },
  ) => void;
}) => {
  const onLaunchWorkspaceSetupPlanner = useCallback(async () => {
    const snapshot = await apiClient
      .post<{ terminalId?: string }>(buildTerminalsUrl(), {
        name: "tentacle-planner",
        workspaceMode: "shared",
        agentProvider: "claude-code",
        promptTemplate: "tentacle-planner",
      })
      .catch(() => undefined);
    if (!snapshot) return undefined;
    await refreshColumns();
    return typeof snapshot.terminalId === "string" ? snapshot.terminalId : undefined;
  }, [refreshColumns]);

  const onCreateAgent = useCallback(
    async (tentacleId: string) => createTerminal("shared", undefined, tentacleId),
    [createTerminal],
  );

  const onCreateTerminal = useCallback(
    async () => createTerminal("shared", undefined, OCTOBOSS_ID),
    [createTerminal],
  );

  const onCreateWorktreeTerminal = useCallback(
    async () => createTerminal("worktree", undefined, OCTOBOSS_ID),
    [createTerminal],
  );

  const onCreateTentacle = useCallback(async () => {
    await apiClient
      .post(buildDeckTentaclesUrl(), { name: "", description: "" })
      .catch(() => undefined);
    await refreshColumns();
  }, [refreshColumns]);

  const onSpawnSwarm = useCallback(
    async (tentacleId: string, workspaceMode: TerminalWorkspaceMode) => {
      await apiClient
        .post(buildDeckSwarmUrl(tentacleId), { workspaceMode })
        .catch(() => undefined);
    },
    [],
  );

  const onOctobossAction = useCallback(
    async (action: string) => {
      const snapshot = await apiClient
        .post<{ terminalId?: string }>(buildTerminalsUrl(), {
          workspaceMode: "shared",
          tentacleId: OCTOBOSS_ID,
          promptTemplate: action,
        })
        .catch(() => undefined);
      if (!snapshot) return undefined;
      await refreshColumns();
      return typeof snapshot.terminalId === "string" ? snapshot.terminalId : undefined;
    },
    [refreshColumns],
  );

  const onTentacleAction = useCallback(
    async (tentacleId: string, action: string) => {
      const snapshot = await apiClient
        .post<{ terminalId?: string }>(buildTerminalsUrl(), {
          workspaceMode: "shared",
          tentacleId,
          promptTemplate: action,
          promptVariables: { tentacleId },
        })
        .catch(() => undefined);
      if (!snapshot) return undefined;
      await refreshColumns();
      return typeof snapshot.terminalId === "string" ? snapshot.terminalId : undefined;
    },
    [refreshColumns],
  );

  const onNavigateToConversation = useCallback(
    (_sessionId: string) => {
      setActivePrimaryNav(6 as PrimaryNavIndex);
    },
    [setActivePrimaryNav],
  );

  const onCloseActiveSession = useCallback(
    (terminalId: string, terminalName: string, workspaceMode?: string) => {
      requestDeleteTerminal(terminalId, terminalName, {
        workspaceMode: workspaceMode === "worktree" ? "worktree" : "shared",
        intent: "close-terminal",
      });
    },
    [requestDeleteTerminal],
  );

  const onDeleteActiveSession = useCallback(
    (terminalId: string, terminalName: string, workspaceMode?: string) => {
      requestDeleteTerminal(terminalId, terminalName, {
        workspaceMode: workspaceMode === "worktree" ? "worktree" : "shared",
        intent: "delete-terminal",
      });
    },
    [requestDeleteTerminal],
  );

  return {
    onLaunchWorkspaceSetupPlanner,
    onCreateAgent,
    onCreateTerminal,
    onCreateWorktreeTerminal,
    onCreateTentacle,
    onSpawnSwarm,
    onOctobossAction,
    onTentacleAction,
    onNavigateToConversation,
    onCloseActiveSession,
    onDeleteActiveSession,
  };
};
