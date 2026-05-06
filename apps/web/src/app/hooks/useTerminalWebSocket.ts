import { type TerminalSnapshot, isAgentRuntimeState } from "@octogent/core";
import { useCallback, useEffect, useRef } from "react";

import type { TerminalRuntimeStateStore } from "../terminalRuntimeStateStore";
import {
  getTerminalRuntimeStateInfo,
  stripTerminalRuntimeState,
} from "../terminalRuntimeStateStore";
import type { TerminalView } from "../types";
import { buildTerminalEventsSocketUrl } from "../../runtime/runtimeEndpoints";

export const useTerminalWebSocket = ({
  runtimeStateStore,
  setTerminals,
  setRecentlyCreatedTerminal,
  refreshColumns,
}: {
  runtimeStateStore: TerminalRuntimeStateStore;
  setTerminals: React.Dispatch<React.SetStateAction<TerminalView>>;
  setRecentlyCreatedTerminal: React.Dispatch<React.SetStateAction<TerminalView[number] | null>>;
  refreshColumns: () => Promise<TerminalView>;
}) => {
  const refreshTimerRef = useRef<number | null>(null);

  const sortTerminalSnapshots = useCallback(
    (snapshots: TerminalView) =>
      [...snapshots].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      ),
    [],
  );

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const socket = new WebSocket(buildTerminalEventsSocketUrl());

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;

      try {
        const payload = JSON.parse(event.data) as
          | {
              type?: unknown;
              snapshot?: TerminalSnapshot;
              terminalId?: string;
              agentRuntimeState?: string;
              toolName?: string;
            }
          | undefined;

        if (!payload || typeof payload.type !== "string") return;

        if (payload.type === "terminal-created" || payload.type === "terminal-updated") {
          if (!payload.snapshot) return;
          const runtimeState = getTerminalRuntimeStateInfo(payload.snapshot);
          runtimeStateStore.setRuntimeState(payload.snapshot.terminalId, runtimeState);
          const structuralSnapshot = stripTerminalRuntimeState(payload.snapshot);
          if (payload.type === "terminal-created") {
            setRecentlyCreatedTerminal(structuralSnapshot as TerminalView[number]);
          }
          setTerminals((current) =>
            sortTerminalSnapshots([
              ...current.filter((t) => t.terminalId !== structuralSnapshot.terminalId),
              structuralSnapshot,
            ]),
          );
          return;
        }

        if (payload.type === "terminal-state-changed") {
          if (!payload.terminalId || !isAgentRuntimeState(payload.agentRuntimeState)) return;
          runtimeStateStore.setRuntimeState(payload.terminalId, {
            state: payload.agentRuntimeState,
            ...(payload.toolName ? { toolName: payload.toolName } : {}),
          });
          return;
        }

        if (payload.type === "terminal-deleted") {
          if (!payload.terminalId) return;
          runtimeStateStore.removeTerminal(payload.terminalId);
          setTerminals((current) =>
            current.filter((t) => t.terminalId !== payload.terminalId),
          );
          return;
        }

        if (payload.type !== "terminal-list-changed") return;
      } catch {
        return;
      }

      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void refreshColumns();
      }, 100);
    });

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      socket.close();
    };
  }, [refreshColumns, runtimeStateStore, setRecentlyCreatedTerminal, setTerminals, sortTerminalSnapshots]);
};
