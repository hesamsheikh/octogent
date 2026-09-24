import type { PersistedTerminal, TerminalSession } from "./types";

export const isWaitingForAttention = (state: string): boolean =>
  state === "waiting_for_permission" || state === "waiting_for_user";

export const updateTerminalAttention = (
  terminal: PersistedTerminal,
  state: TerminalSession["agentState"],
  toolName?: string,
): boolean => {
  const kind =
    state === "waiting_for_permission"
      ? "permission"
      : state === "waiting_for_user"
        ? "user"
        : undefined;
  if (!kind) {
    const changed =
      terminal.attentionSince !== undefined ||
      terminal.attentionKind !== undefined ||
      terminal.attentionToolName !== undefined;
    terminal.attentionSince = undefined;
    terminal.attentionKind = undefined;
    terminal.attentionToolName = undefined;
    return changed;
  }
  // Repeated notifications must not restart the clock for the same dialog.
  const changed =
    terminal.attentionKind !== kind ||
    !terminal.attentionSince ||
    terminal.attentionToolName !== toolName;
  if (terminal.attentionKind !== kind || !terminal.attentionSince) {
    terminal.attentionSince = new Date().toISOString();
  }
  terminal.attentionKind = kind;
  if (toolName) terminal.attentionToolName = toolName;
  else terminal.attentionToolName = undefined;
  return changed;
};
