import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as logging from "../src/logging";
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
    hasSeenHook: true,
    ...overrides,
  }) as TerminalSession;

const makeHarness = (
  options: {
    session?: TerminalSession | null;
    writeOk?: boolean;
    terminal?: Partial<PersistedTerminal>;
  } = {},
) => {
  const terminal = {
    terminalId: "t-1",
    lifecycleState: "running",
    ...options.terminal,
  } as PersistedTerminal;
  const terminals = new Map<string, PersistedTerminal>([["t-1", terminal]]);
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
  // Stands in for the session runtime, which owns these timers and drops them
  // with the session.
  const sessionTimers = new Set<ReturnType<typeof setTimeout>>();
  const scheduleSessionTimer = vi.fn(
    (terminalId: string, callback: () => void, delayMs: number) => {
      if (!sessions.has(terminalId)) {
        return false;
      }
      const timer = setTimeout(() => {
        sessionTimers.delete(timer);
        callback();
      }, delayMs);
      sessionTimers.add(timer);
      return true;
    },
  );
  const closeSession = () => {
    for (const timer of sessionTimers) {
      clearTimeout(timer);
    }
    sessionTimers.clear();
    sessions.delete("t-1");
  };
  const onTerminalUpdated = vi.fn();
  const messaging = createChannelMessaging({
    terminals,
    sessions,
    writeInput,
    scheduleSessionTimer,
    onTerminalUpdated,
  });
  return { messaging, writes, writeInput, sessions, terminal, closeSession, onTerminalUpdated };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe("channel acknowledgement", () => {
  const paste = (content: string) =>
    `${AGENT_PASTE_START}[Channel message from sender]: ${content}${AGENT_PASTE_END}`;

  it("keeps a batch unconfirmed until the next prompt submit confirms all of it", () => {
    vi.setSystemTime(new Date("2026-09-21T08:00:00Z"));
    const { messaging, writes, sessions } = makeHarness({
      session: makeSession({ agentState: "processing" }),
    });
    messaging.sendChannelMessage("t-1", "sender", "first");
    messaging.sendChannelMessage("t-1", "sender", "second");
    const session = sessions.get("t-1");
    if (session) {
      session.agentState = "idle";
    }

    expect(messaging.deliverChannelMessages("t-1")).toBe(2);
    const batch = messaging.listChannelMessages("t-1");
    for (const message of batch) {
      expect(message).toMatchObject({
        delivered: true,
        deliveredAt: "2026-09-21T08:00:00.000Z",
        deliveryAttempts: 1,
      });
      expect(message.acknowledgedAt).toBeUndefined();
    }

    vi.advanceTimersByTime(2_000);
    messaging.acknowledgeChannelMessages("t-1");
    for (const message of batch) {
      expect(message.acknowledgedAt).toBe("2026-09-21T08:00:02.000Z");
    }

    vi.advanceTimersByTime(60_000);
    expect(writes).toHaveLength(2);
    expect(batch.every((message) => message.failed === undefined)).toBe(true);
  });

  it("re-delivers an unacknowledged batch once, then marks it failed and flags the terminal", () => {
    const logVerbose = vi.spyOn(logging, "logVerbose").mockImplementation(() => {});
    const { messaging, writes, terminal, onTerminalUpdated } = makeHarness();
    const message = messaging.sendChannelMessage("t-1", "sender", "ping");

    vi.advanceTimersByTime(9_999);
    expect(writes).toEqual([paste("ping"), "\r"]);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual([paste("ping"), "\r", paste("ping")]);
    expect(message?.deliveryAttempts).toBe(2);
    expect(logVerbose).toHaveBeenCalledWith(expect.stringMatching(/re-?deliver.*t-1/i));
    vi.advanceTimersByTime(AGENT_INJECT_SUBMIT_DELAY_MS);
    expect(writes).toEqual([paste("ping"), "\r", paste("ping"), "\r"]);

    vi.advanceTimersByTime(9_849);
    expect(message?.failed).toBeUndefined();
    expect(onTerminalUpdated).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(message).toMatchObject({ failed: "not acknowledged", deliveryAttempts: 2 });
    expect(message?.acknowledgedAt).toBeUndefined();
    expect(logVerbose).toHaveBeenCalledWith(expect.stringMatching(/not acknowledged.*t-1/i));
    expect(terminal.lifecycleState).toBe("running");
    expect(terminal.lifecycleReason).toBe("channel message not acknowledged");
    expect(onTerminalUpdated).toHaveBeenCalledExactlyOnceWith("t-1");

    vi.advanceTimersByTime(60_000);
    expect(writes).toHaveLength(4);
  });

  it("never re-delivers when the session has not shown working hooks", () => {
    // A hook-less agent never acknowledges anything; a retry would hand it the
    // same message twice.
    const { messaging, writes, onTerminalUpdated } = makeHarness({
      session: makeSession({ hasSeenHook: false }),
    });
    const message = messaging.sendChannelMessage("t-1", "sender", "ping");

    vi.advanceTimersByTime(60_000);
    expect(writes).toEqual([paste("ping"), "\r"]);
    expect(message).toMatchObject({ delivered: true, deliveryAttempts: 1 });
    expect(message?.failed).toBeUndefined();
    expect(onTerminalUpdated).not.toHaveBeenCalled();

    // Nothing is awaited, so later messages are not held back either.
    expect(messaging.sendChannelMessage("t-1", "sender", "again")?.delivered).toBe(true);
  });

  it("holds later messages while a batch awaits its acknowledgement", () => {
    const { messaging, writes } = makeHarness();
    const first = messaging.sendChannelMessage("t-1", "sender", "ping");
    const later = messaging.sendChannelMessage("t-1", "sender", "later");
    expect(later?.delivered).toBe(false);

    vi.advanceTimersByTime(AGENT_INJECT_SUBMIT_DELAY_MS);
    messaging.acknowledgeChannelMessages("t-1");
    expect(first?.acknowledgedAt).toEqual(expect.any(String));
    expect(later?.acknowledgedAt).toBeUndefined();

    expect(messaging.deliverChannelMessages("t-1")).toBe(1);
    expect(writes).toEqual([paste("ping"), "\r", paste("later")]);
  });

  it("re-delivers only once the agent is idle again", () => {
    // An Enter written into a permission dialog would answer it, so the retry
    // takes the same guards as the first delivery.
    const { messaging, writes, sessions } = makeHarness();
    const message = messaging.sendChannelMessage("t-1", "sender", "ping");
    const session = sessions.get("t-1");
    if (session) {
      session.agentState = "waiting_for_permission";
    }

    vi.advanceTimersByTime(60_000);
    expect(writes).toEqual([paste("ping"), "\r"]);
    expect(message?.failed).toBeUndefined();

    if (session) {
      session.agentState = "idle";
    }
    expect(messaging.deliverChannelMessages("t-1")).toBe(1);
    vi.advanceTimersByTime(AGENT_INJECT_SUBMIT_DELAY_MS);
    expect(writes).toEqual([paste("ping"), "\r", paste("ping"), "\r"]);
    vi.advanceTimersByTime(10_000);
    expect(message).toMatchObject({ failed: "not acknowledged", deliveryAttempts: 2 });
  });

  it("clears its lifecycle reason on the next acknowledgement", () => {
    const { messaging, terminal, onTerminalUpdated } = makeHarness();
    const lost = messaging.sendChannelMessage("t-1", "sender", "ping");
    vi.advanceTimersByTime(20_000);
    expect(terminal.lifecycleReason).toBe("channel message not acknowledged");

    const next = messaging.sendChannelMessage("t-1", "sender", "again");
    expect(next?.delivered).toBe(true);
    messaging.acknowledgeChannelMessages("t-1");

    expect(next?.acknowledgedAt).toEqual(expect.any(String));
    expect(lost).toMatchObject({ failed: "not acknowledged" });
    expect(lost?.acknowledgedAt).toBeUndefined();
    expect(terminal.lifecycleReason).toBeUndefined();
    expect(onTerminalUpdated).toHaveBeenCalledTimes(2);
  });

  it("flags only a running terminal and leaves other lifecycle reasons alone", () => {
    const { messaging, terminal, onTerminalUpdated } = makeHarness({
      terminal: { lifecycleState: "completed" },
    });
    const message = messaging.sendChannelMessage("t-1", "sender", "ping");
    vi.advanceTimersByTime(20_000);
    expect(message?.failed).toBe("not acknowledged");
    expect(terminal.lifecycleReason).toBeUndefined();

    terminal.lifecycleState = "stalled";
    terminal.lifecycleReason = "no transcript activity";
    messaging.acknowledgeChannelMessages("t-1");
    expect(terminal.lifecycleReason).toBe("no transcript activity");
    expect(onTerminalUpdated).not.toHaveBeenCalled();
  });

  it("stops verifying once the session closes", () => {
    const { messaging, writes, terminal, closeSession } = makeHarness();
    const message = messaging.sendChannelMessage("t-1", "sender", "ping");
    closeSession();

    vi.advanceTimersByTime(60_000);
    expect(writes).toEqual([paste("ping")]);
    expect(message).toMatchObject({ delivered: true, deliveryAttempts: 1 });
    expect(message?.failed).toBeUndefined();
    expect(terminal.lifecycleReason).toBeUndefined();
    expect(() => messaging.acknowledgeChannelMessages("t-1")).not.toThrow();
    expect(() => messaging.acknowledgeChannelMessages("unknown")).not.toThrow();
  });
});
