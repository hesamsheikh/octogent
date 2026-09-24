import { logVerbose } from "../logging";
import {
  AGENT_INJECT_ACK_TIMEOUT_MS,
  AGENT_INJECT_SUBMIT_DELAY_MS,
  AGENT_PASTE_END,
  AGENT_PASTE_START,
} from "./constants";
import type { ChannelMessage, PersistedTerminal, TerminalSession } from "./types";

const MAX_DELIVERY_ATTEMPTS = 2;
const CHANNEL_UNACKNOWLEDGED_REASON = "channel message not acknowledged";

// One injection still waiting for the agent's prompt-submit hook.
type UnconfirmedBatch = {
  messages: ChannelMessage[];
  // Hooks had shown up before it was sent, so silence means the input was lost
  // (a dialog took it, say) rather than that nobody reports submits.
  isVerified: boolean;
  // The acknowledgement timed out while the agent was busy; resend when idle.
  isRetryDue: boolean;
};

export const createChannelMessaging = (deps: {
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  writeInput: (terminalId: string, data: string) => boolean;
  /** Runs a callback against the live session; the timer dies with the session. */
  scheduleSessionTimer: (terminalId: string, callback: () => void, delayMs: number) => boolean;
  /** Persists and broadcasts a terminal record changed here. */
  onTerminalUpdated?: (terminalId: string) => void;
}) => {
  const { terminals, sessions, writeInput, scheduleSessionTimer, onTerminalUpdated } = deps;
  const channelQueues = new Map<string, ChannelMessage[]>();
  // Keyed by session, so a restarted terminal never inherits the old batch.
  const unconfirmedBatches = new WeakMap<TerminalSession, UnconfirmedBatch>();
  let channelMessageCounter = 0;

  const writeBatch = (
    terminalId: string,
    session: TerminalSession,
    batch: UnconfirmedBatch,
  ): boolean => {
    // Compose all pending messages into a single prompt injection. The paste
    // and the submitting Enter are written separately: combined in one write,
    // the TUI can treat the trailing return as part of the paste and leave the
    // whole message sitting unsent in the input box.
    const lines = batch.messages.map(
      (m) => `[Channel message from ${m.fromTerminalId}]: ${m.content}`,
    );
    const paste = `${AGENT_PASTE_START}${lines.join("\n")}${AGENT_PASTE_END}`;

    if (!writeInput(terminalId, paste)) {
      return false;
    }

    const now = new Date().toISOString();
    for (const m of batch.messages) {
      m.delivered = true;
      m.deliveredAt ??= now;
      m.deliveryAttempts = (m.deliveryAttempts ?? 0) + 1;
    }

    scheduleSessionTimer(
      terminalId,
      () => writeInput(terminalId, "\r"),
      AGENT_INJECT_SUBMIT_DELAY_MS,
    );

    batch.isRetryDue = false;
    unconfirmedBatches.set(session, batch);
    if (batch.isVerified) {
      scheduleSessionTimer(
        terminalId,
        () => verifyBatch(terminalId, session, batch),
        AGENT_INJECT_ACK_TIMEOUT_MS,
      );
    }
    return true;
  };

  const verifyBatch = (terminalId: string, session: TerminalSession, batch: UnconfirmedBatch) => {
    if (unconfirmedBatches.get(session) !== batch) {
      return;
    }

    const attempts = batch.messages[0]?.deliveryAttempts ?? 0;
    if (attempts < MAX_DELIVERY_ATTEMPTS) {
      batch.isRetryDue = true;
      deliverChannelMessages(terminalId);
      return;
    }

    unconfirmedBatches.delete(session);
    for (const m of batch.messages) {
      m.failed = "not acknowledged";
    }
    logVerbose(
      `[Channel] ${batch.messages.length} message(s) not acknowledged by ${terminalId} after ${attempts} deliveries`,
    );

    const terminal = terminals.get(terminalId);
    if (terminal?.lifecycleState === "running") {
      terminal.lifecycleReason = CHANNEL_UNACKNOWLEDGED_REASON;
      terminal.lifecycleUpdatedAt = new Date().toISOString();
      onTerminalUpdated?.(terminalId);
    }
  };

  const deliverChannelMessages = (terminalId: string): number => {
    const queue = channelQueues.get(terminalId);
    if (!queue || queue.length === 0) {
      return 0;
    }

    const session = sessions.get(terminalId);
    if (!session || session.agentState !== "idle") {
      return 0;
    }

    // An idle session is not enough: after the agent exits, the shell behind
    // the PTY is still "idle", and text injected there vanishes into bash.
    // A message stays queued until a session with a live transcript exists.
    if (session.hasTranscriptEnded) {
      return 0;
    }

    const unconfirmed = unconfirmedBatches.get(session);
    if (unconfirmed?.isRetryDue) {
      if (!writeBatch(terminalId, session, unconfirmed)) {
        return 0;
      }
      logVerbose(
        `[Channel] Re-delivering ${unconfirmed.messages.length} unacknowledged message(s) to ${terminalId}`,
      );
      return unconfirmed.messages.length;
    }
    // One awaited batch at a time: a prompt submit cannot say which of two
    // batches it confirms. Later messages wait for the receipt or the failure.
    if (unconfirmed?.isVerified) {
      return 0;
    }

    const undelivered = queue.filter((m) => !m.delivered);
    if (undelivered.length === 0) {
      return 0;
    }

    const batch: UnconfirmedBatch = {
      messages: undelivered,
      isVerified: session.hasSeenHook === true,
      isRetryDue: false,
    };
    if (!writeBatch(terminalId, session, batch)) {
      return 0;
    }

    logVerbose(`[Channel] Delivering ${undelivered.length} message(s) to ${terminalId}`);
    return undelivered.length;
  };

  // Called for a prompt submit the initial prompt did not claim.
  const acknowledgeChannelMessages = (terminalId: string) => {
    const session = sessions.get(terminalId);
    const batch = session ? unconfirmedBatches.get(session) : undefined;
    if (session && batch) {
      unconfirmedBatches.delete(session);
      const acknowledgedAt = new Date().toISOString();
      for (const m of batch.messages) {
        m.acknowledgedAt = acknowledgedAt;
      }
      logVerbose(`[Channel] ${terminalId} acknowledged ${batch.messages.length} message(s)`);
    }

    // The agent is taking input again, so the earlier failure no longer
    // describes it; the failed messages themselves stay marked.
    const terminal = terminals.get(terminalId);
    if (terminal?.lifecycleReason === CHANNEL_UNACKNOWLEDGED_REASON) {
      terminal.lifecycleReason = undefined;
      terminal.lifecycleUpdatedAt = new Date().toISOString();
      onTerminalUpdated?.(terminalId);
    }
  };

  return {
    sendChannelMessage(
      toTerminalId: string,
      fromTerminalId: string,
      content: string,
    ): ChannelMessage | null {
      if (!terminals.has(toTerminalId)) {
        return null;
      }

      channelMessageCounter += 1;
      const message: ChannelMessage = {
        messageId: `msg-${channelMessageCounter}`,
        fromTerminalId,
        toTerminalId,
        content,
        timestamp: new Date().toISOString(),
        delivered: false,
      };

      const queue = channelQueues.get(toTerminalId) ?? [];
      queue.push(message);
      channelQueues.set(toTerminalId, queue);

      logVerbose(
        `[Channel] Queued message ${message.messageId} from=${fromTerminalId} to=${toTerminalId}`,
      );

      // Attempt immediate delivery; deliverChannelMessages holds the guards
      // (idle, live transcript), so a refused attempt just leaves it queued.
      deliverChannelMessages(toTerminalId);

      return message;
    },

    listChannelMessages(terminalId: string): ChannelMessage[] {
      return channelQueues.get(terminalId) ?? [];
    },

    deliverChannelMessages,
    acknowledgeChannelMessages,
  };
};
