import { logVerbose } from "../logging";
import { AGENT_INJECT_SUBMIT_DELAY_MS, AGENT_PASTE_END, AGENT_PASTE_START } from "./constants";
import type { ChannelMessage, PersistedTerminal, TerminalSession } from "./types";

export const createChannelMessaging = (deps: {
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  writeInput: (terminalId: string, data: string) => boolean;
}) => {
  const { terminals, sessions, writeInput } = deps;
  const channelQueues = new Map<string, ChannelMessage[]>();
  let channelMessageCounter = 0;

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

    const undelivered = queue.filter((m) => !m.delivered);
    if (undelivered.length === 0) {
      return 0;
    }

    // Compose all pending messages into a single prompt injection. The paste
    // and the submitting Enter are written separately: combined in one write,
    // the TUI can treat the trailing return as part of the paste and leave the
    // whole message sitting unsent in the input box.
    const lines = undelivered.map(
      (m) => `[Channel message from ${m.fromTerminalId}]: ${m.content}`,
    );
    const paste = `${AGENT_PASTE_START}${lines.join("\n")}${AGENT_PASTE_END}`;

    if (!writeInput(terminalId, paste)) {
      return 0;
    }

    logVerbose(`[Channel] Delivering ${undelivered.length} message(s) to ${terminalId}`);

    for (const m of undelivered) {
      m.delivered = true;
    }

    setTimeout(() => {
      writeInput(terminalId, "\r");
    }, AGENT_INJECT_SUBMIT_DELAY_MS);
    return undelivered.length;
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
  };
};
