import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { TerminalAgentProvider, TerminalView, TerminalWorkspaceMode } from "../types";
import { apiClient } from "../../runtime/apiClient";
import { buildTerminalUrl, buildTerminalsUrl } from "../../runtime/runtimeEndpoints";

export type PendingDeleteTerminal = {
  terminalId: string;
  tentacleName: string;
  workspaceMode: TerminalWorkspaceMode;
  intent: "close-terminal" | "delete-terminal" | "cleanup-worktree";
};

type UseTerminalMutationsOptions = {
  readColumns: () => Promise<TerminalView>;
  setColumns: Dispatch<SetStateAction<TerminalView>>;
  setLoadError: Dispatch<SetStateAction<string | null>>;
  setMinimizedTerminalIds: Dispatch<SetStateAction<string[]>>;
};

type UseTerminalMutationsResult = {
  editingTerminalId: string | null;
  terminalNameDraft: string;
  isCreatingTerminal: boolean;
  isDeletingTerminalId: string | null;
  pendingDeleteTerminal: PendingDeleteTerminal | null;
  setTerminalNameDraft: Dispatch<SetStateAction<string>>;
  setEditingTerminalId: Dispatch<SetStateAction<string | null>>;
  beginTerminalNameEdit: (terminalId: string, currentTerminalName: string) => void;
  submitTerminalRename: (terminalId: string, currentTerminalName: string) => Promise<void>;
  createTerminal: (
    workspaceMode: TerminalWorkspaceMode,
    agentProvider?: TerminalAgentProvider,
    tentacleId?: string,
  ) => Promise<string | undefined>;
  requestDeleteTerminal: (
    terminalId: string,
    terminalName: string,
    options?: {
      workspaceMode?: TerminalWorkspaceMode;
      intent?: "close-terminal" | "delete-terminal" | "cleanup-worktree";
    },
  ) => void;
  confirmDeleteTerminal: () => Promise<void>;
  clearPendingDeleteTerminal: () => void;
  cancelTerminalRename: () => void;
};

export const useTerminalMutations = ({
  readColumns,
  setColumns,
  setLoadError,
  setMinimizedTerminalIds,
}: UseTerminalMutationsOptions): UseTerminalMutationsResult => {
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [terminalNameDraft, setTerminalNameDraft] = useState("");
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false);
  const [isDeletingTerminalId, setIsDeletingTerminalId] = useState<string | null>(null);
  const [pendingDeleteTerminal, setPendingDeleteTerminal] = useState<PendingDeleteTerminal | null>(
    null,
  );
  const cancelTerminalNameSubmitRef = useRef(false);

  const beginTerminalNameEdit = useCallback(
    (terminalId: string, currentTerminalName: string) => {
      setLoadError(null);
      setEditingTerminalId(terminalId);
      setTerminalNameDraft(currentTerminalName);
    },
    [setLoadError],
  );

  const submitTerminalRename = useCallback(
    async (terminalId: string, currentTerminalName: string) => {
      if (cancelTerminalNameSubmitRef.current) {
        cancelTerminalNameSubmitRef.current = false;
        return;
      }

      const trimmedName = terminalNameDraft.trim();
      if (trimmedName.length === 0) {
        setLoadError("Terminal name cannot be empty.");
        return;
      }

      if (trimmedName === currentTerminalName) {
        setEditingTerminalId(null);
        return;
      }

      try {
        setLoadError(null);
        await apiClient.patch(buildTerminalUrl(terminalId), { name: trimmedName });
        const nextColumns = await readColumns();
        setColumns(nextColumns);
        setEditingTerminalId(null);
      } catch {
        setLoadError("Unable to rename terminal.");
      }
    },
    [readColumns, setColumns, setLoadError, terminalNameDraft],
  );

  const createTerminal = useCallback(
    async (
      workspaceMode: TerminalWorkspaceMode,
      agentProvider?: TerminalAgentProvider,
      tentacleId?: string,
    ) => {
      try {
        setIsCreatingTerminal(true);
        setLoadError(null);
        const createdSnapshot = await apiClient.post<{
          terminalId?: unknown;
          tentacleName?: unknown;
        }>(buildTerminalsUrl(), {
          workspaceMode,
          agentProvider: agentProvider ?? "claude-code",
          ...(tentacleId ? { tentacleId } : {}),
        });

        const nextColumns = await readColumns();
        setColumns(nextColumns);

        const createdTerminalId =
          typeof createdSnapshot.terminalId === "string" ? createdSnapshot.terminalId : null;
        if (!createdTerminalId) {
          return undefined;
        }

        const createdEntry = nextColumns.find((entry) => entry.terminalId === createdTerminalId);
        const createdTerminalName =
          createdEntry?.tentacleName ??
          (typeof createdSnapshot.tentacleName === "string"
            ? createdSnapshot.tentacleName
            : createdTerminalId);
        setMinimizedTerminalIds((current) => current.filter((id) => id !== createdTerminalId));
        beginTerminalNameEdit(createdTerminalId, createdTerminalName);
        return createdTerminalId;
      } catch {
        setLoadError("Unable to create a new terminal.");
        return undefined;
      } finally {
        setIsCreatingTerminal(false);
      }
    },
    [beginTerminalNameEdit, readColumns, setColumns, setLoadError, setMinimizedTerminalIds],
  );

  const requestDeleteTerminal = useCallback(
    (
      terminalId: string,
      terminalName: string,
      options?: {
        workspaceMode?: TerminalWorkspaceMode;
        intent?: "close-terminal" | "delete-terminal" | "cleanup-worktree";
      },
    ) => {
      setLoadError(null);
      setPendingDeleteTerminal({
        terminalId,
        tentacleName: terminalName,
        workspaceMode: options?.workspaceMode ?? "shared",
        intent: options?.intent ?? "delete-terminal",
      });
    },
    [setLoadError],
  );

  const confirmDeleteTerminal = useCallback(async () => {
    if (!pendingDeleteTerminal) {
      return;
    }

    const { terminalId } = pendingDeleteTerminal;
    try {
      setLoadError(null);
      setIsDeletingTerminalId(terminalId);
      await apiClient.delete(buildTerminalUrl(terminalId));

      if (editingTerminalId === terminalId) {
        setEditingTerminalId(null);
        setTerminalNameDraft("");
      }
      setMinimizedTerminalIds((current) =>
        current.filter((currentTerminalId) => currentTerminalId !== terminalId),
      );

      const nextColumns = await readColumns();
      setColumns(nextColumns);
      setPendingDeleteTerminal(null);
    } catch {
      setLoadError("Unable to delete terminal.");
    } finally {
      setIsDeletingTerminalId(null);
    }
  }, [
    editingTerminalId,
    pendingDeleteTerminal,
    readColumns,
    setColumns,
    setLoadError,
    setMinimizedTerminalIds,
  ]);

  const clearPendingDeleteTerminal = useCallback(() => {
    setPendingDeleteTerminal(null);
  }, []);

  const cancelTerminalRename = useCallback(() => {
    cancelTerminalNameSubmitRef.current = true;
    setEditingTerminalId(null);
    setTerminalNameDraft("");
  }, []);

  return {
    editingTerminalId,
    terminalNameDraft,
    isCreatingTerminal,
    isDeletingTerminalId,
    pendingDeleteTerminal,
    setTerminalNameDraft,
    setEditingTerminalId,
    beginTerminalNameEdit,
    submitTerminalRename,
    createTerminal,
    requestDeleteTerminal,
    confirmDeleteTerminal,
    clearPendingDeleteTerminal,
    cancelTerminalRename,
  };
};
