import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

import type { PrimaryNavIndex } from "../constants";
import type { TerminalAgentProvider, TerminalView, TerminalWorkspaceMode } from "../types";
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
    if (!response.ok) return undefined;
    const snapshot = (await response.json()) as { terminalId?: string };
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
    const response = await fetch("/api/deck/tentacles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", description: "" }),
    });
    if (!response.ok) return;
    await refreshColumns();
  }, [refreshColumns]);

  const onSpawnSwarm = useCallback(
    async (tentacleId: string, workspaceMode: TerminalWorkspaceMode) => {
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
    [],
  );

  const onOctobossAction = useCallback(
    async (action: string) => {
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
      return typeof snapshot.terminalId === "string" ? snapshot.terminalId : undefined;
    },
    [refreshColumns],
  );

  const onTentacleAction = useCallback(
    async (tentacleId: string, action: string) => {
      const response = await fetch("/api/terminals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceMode: "shared",
          tentacleId,
          promptTemplate: action,
          promptVariables: { tentacleId },
        }),
      });
      if (!response.ok) return undefined;
      const snapshot = (await response.json()) as { terminalId?: string };
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
