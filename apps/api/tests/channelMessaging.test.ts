import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChannelMessaging } from "../src/terminalRuntime/channelMessaging";
import {
  AGENT_INJECT_SUBMIT_DELAY_MS,
  AGENT_PASTE_END,
  AGENT_PASTE_START,
} from "../src/terminalRuntime/constants";
import type { PersistedTerminal, TerminalSession } from "../src/terminalRuntime/types";

const makeSession = (overrides: Partial<TerminalSession> = {}): TerminalSession =>
  ({
    agentState: "idle",
    hasTranscriptEnded: false,
    ...overrides,
  }) as TerminalSession;

const makeHarness = (options: { session?: TerminalSession | null; writeOk?: boolean } = {}) => {
  const terminals = new Map<string, PersistedTerminal>([
    ["t-1", { terminalId: "t-1" } as PersistedTerminal],
  ]);
  const sessions = new Map<string, TerminalSession>();
  if (options.session !== null) {
    sessions.set("t-1", options.session ?? makeSession());
  }
  const writes: string[] = [];
  const writeInput = vi.fn((_terminalId: string, data: string) => {
    if (options.writeOk === false) {
      return false;
    }
    writes.push(data);
    return true;
  });
  const messaging = createChannelMessaging({ terminals, sessions, writeInput });
  return { messaging, writes, writeInput, sessions };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("channel delivery", () => {
  it("injects as a bracketed paste and submits with a delayed Enter", () => {
    const { messaging, writes } = makeHarness();

    messaging.sendChannelMessage("t-1", "sender", "please review");

    expect(writes).toEqual([
      `${AGENT_PASTE_START}[Channel message from sender]: please review${AGENT_PASTE_END}`,
    ]);

    vi.advanceTimersByTime(AGENT_INJECT_SUBMIT_DELAY_MS);
    // The Enter arrives on its own after the paste has settled; sending both in
    // one write let the TUI swallow the submit and strand the message unsent.
    expect(writes).toEqual([
      `${AGENT_PASTE_START}[Channel message from sender]: please review${AGENT_PASTE_END}`,
      "\r",
    ]);
    expect(messaging.listChannelMessages("t-1")[0]?.delivered).toBe(true);
  });

  it("batches several pending messages into one injection", () => {
    const { messaging, writes, sessions } = makeHarness();
    const session = sessions.get("t-1");
    if (session) {
      session.agentState = "processing";
    }

    messaging.sendChannelMessage("t-1", "a", "first");
    messaging.sendChannelMessage("t-1", "b", "second");
    expect(writes).toEqual([]);

    if (session) {
      session.agentState = "idle";
    }
    expect(messaging.deliverChannelMessages("t-1")).toBe(2);
    expect(writes[0]).toContain("[Channel message from a]: first");
    expect(writes[0]).toContain("[Channel message from b]: second");
  });

  it("keeps a message queued when the agent's transcript has ended", () => {
    // The session's shell is alive but the agent behind it exited; injecting
    // there sends the text into a bare shell and the message is lost.
    const { messaging, writes } = makeHarness({
      session: makeSession({ hasTranscriptEnded: true }),
    });

    const message = messaging.sendChannelMessage("t-1", "sender", "hello?");

    expect(writes).toEqual([]);
    expect(message?.delivered).toBe(false);
    expect(messaging.deliverChannelMessages("t-1")).toBe(0);
  });

  it("keeps a message queued while the agent is busy", () => {
    const { messaging, writes } = makeHarness({
      session: makeSession({ agentState: "processing" }),
    });

    const message = messaging.sendChannelMessage("t-1", "sender", "later");

    expect(writes).toEqual([]);
    expect(message?.delivered).toBe(false);
  });

  it("does not mark a message delivered when the write fails", () => {
    const { messaging } = makeHarness({ writeOk: false });

    const message = messaging.sendChannelMessage("t-1", "sender", "lost?");

    expect(message?.delivered).toBe(false);
    expect(messaging.listChannelMessages("t-1")[0]?.delivered).toBe(false);
  });

  it("does nothing without a live session", () => {
    const { messaging } = makeHarness({ session: null });

    const message = messaging.sendChannelMessage("t-1", "sender", "anyone?");

    expect(message?.delivered).toBe(false);
    expect(messaging.deliverChannelMessages("t-1")).toBe(0);
  });

  it("refuses a message for an unknown terminal", () => {
    const { messaging } = makeHarness();

    expect(messaging.sendChannelMessage("nope", "sender", "x")).toBeNull();
  });
});
