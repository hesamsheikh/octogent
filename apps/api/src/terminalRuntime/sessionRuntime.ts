import { type WriteStream, createWriteStream, existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import { type IPty, spawn } from "node-pty";
import type { WebSocket, WebSocketServer } from "ws";

import { type AgentRuntimeState, AgentStateTracker } from "../agentStateDetection";
import {
  DEFAULT_AGENT_PROVIDER,
  TERMINAL_BOOTSTRAP_COMMANDS,
  TERMINAL_MAX_CONCURRENT_SESSIONS,
  TERMINAL_SCROLLBACK_MAX_BYTES,
  TERMINAL_SESSION_IDLE_GRACE_MS,
} from "./constants";
import {
  type ConversationTranscriptEvent,
  type ConversationTranscriptEventPayload,
  type SessionEndTranscriptEvent,
  ensureTranscriptDirectory,
  transcriptFilenameForSession,
} from "./conversations";
import { broadcastMessage, getTerminalId, sendMessage } from "./protocol";
import { createShellEnvironment, ensureNodePtySpawnHelperExecutable } from "./ptyEnvironment";
import { toErrorMessage } from "./systemClients";
import type {
  DirectSessionListener,
  PersistedTerminal,
  TerminalSession,
  TerminalSessionEndDetails,
  TerminalSessionStartDetails,
} from "./types";

type CreateSessionRuntimeOptions = {
  websocketServer: WebSocketServer;
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  resolveTerminalSession?: (terminalId: string) => {
    sessionId: string;
    tentacleId: string;
  } | null;
  getTentacleWorkspaceCwd: (tentacleId: string) => string;
  isDebugPtyLogsEnabled: boolean;
  ptyLogDir: string;
  transcriptDirectoryPath: string;
  sessionIdleGraceMs?: number;
  scrollbackMaxBytes?: number;
  maxConcurrentSessions?: number;
  onStateChange?: (terminalId: string, state: AgentRuntimeState, toolName?: string) => void;
  onSessionStart?: (terminalId: string, details: TerminalSessionStartDetails) => void;
  onSessionEnd?: (terminalId: string, details: TerminalSessionEndDetails) => void;
};

const ANSI_BEL = String.fromCharCode(0x07);
const ANSI_ESCAPE = String.fromCharCode(0x1b);
const BROKEN_OSC_TAIL_RE = new RegExp(
  `^\\][^${ANSI_BEL}${ANSI_ESCAPE}]*(?:${ANSI_BEL}|${ANSI_ESCAPE}\\\\)`,
);

export const createSessionRuntime = ({
  websocketServer,
  terminals,
  sessions,
  resolveTerminalSession,
  getTentacleWorkspaceCwd,
  isDebugPtyLogsEnabled,
  ptyLogDir,
  transcriptDirectoryPath,
  sessionIdleGraceMs = TERMINAL_SESSION_IDLE_GRACE_MS,
  scrollbackMaxBytes = TERMINAL_SCROLLBACK_MAX_BYTES,
  maxConcurrentSessions = TERMINAL_MAX_CONCURRENT_SESSIONS,
  onStateChange,
  onSessionStart,
  onSessionEnd,
}: CreateSessionRuntimeOptions) => {
  const DEFAULT_PTY_COLS = 120;
  const DEFAULT_PTY_ROWS = 35;
  const sessionLimit = Number.isFinite(maxConcurrentSessions)
    ? Math.max(1, Math.floor(maxConcurrentSessions))
    : TERMINAL_MAX_CONCURRENT_SESSIONS;

  const getShellLaunch = () => {
    if (process.platform === "win32") {
      return {
        command: process.env.ComSpec ?? "cmd.exe",
        args: [],
      };
    }

    const shellFromEnvironment = process.env.SHELL?.trim();
    if (shellFromEnvironment && shellFromEnvironment.length > 0) {
      return {
        command: shellFromEnvironment,
        args: ["-i"],
      };
    }

    return {
      command: "/bin/bash",
      args: ["-i"],
    };
  };

  const createDebugLog = (sessionId: string) => {
    if (!isDebugPtyLogsEnabled) {
      return undefined;
    }

    mkdirSync(ptyLogDir, { recursive: true });
    const filename = `${sessionId}-${Date.now()}.log`;
    return createWriteStream(join(ptyLogDir, filename), {
      flags: "a",
      encoding: "utf8",
    });
  };

  const appendDebugLog = (session: TerminalSession, line: string) => {
    session.debugLog?.write(`${new Date().toISOString()} ${line}\n`);
  };

  const createTranscriptLog = (sessionId: string) => {
    ensureTranscriptDirectory(transcriptDirectoryPath);
    const filename = transcriptFilenameForSession(sessionId);
    const stream = createWriteStream(join(transcriptDirectoryPath, filename), {
      flags: "a",
      encoding: "utf8",
    });
    stream.on("error", () => {
      // Keep terminal flow alive even if transcript writes fail.
    });
    return stream;
  };

  const appendTranscriptEvent = (
    session: TerminalSession,
    sessionId: string,
    event: ConversationTranscriptEventPayload,
  ) => {
    if (!session.transcriptLog) {
      return;
    }

    const nextEventCount = (session.transcriptEventCount ?? 0) + 1;
    session.transcriptEventCount = nextEventCount;
    const payload: ConversationTranscriptEvent = {
      ...event,
      eventId: `${sessionId}:${nextEventCount}`,
      sessionId,
      tentacleId: session.tentacleId,
    } as ConversationTranscriptEvent;
    session.transcriptLog.write(`${JSON.stringify(payload)}\n`);
  };

  const closeTranscript = (
    session: TerminalSession,
    sessionId: string,
    event: ConversationTranscriptEventPayload,
  ) => {
    if (session.hasTranscriptEnded) {
      return;
    }

    appendTranscriptEvent(session, sessionId, event);
    session.hasTranscriptEnded = true;
    session.transcriptLog?.end();
    session.transcriptLog = undefined;
  };

  const emitStateIfChanged = (
    session: TerminalSession,
    sessionId: string,
    nextState: AgentRuntimeState | null,
  ) => {
    if (!nextState || nextState === session.agentState) {
      return;
    }

    session.agentState = nextState;
    appendDebugLog(session, `state-change session=${sessionId} state=${nextState}`);
    appendTranscriptEvent(session, sessionId, {
      type: "state_change",
      state: nextState,
      timestamp: new Date().toISOString(),
    });
    onStateChange?.(sessionId, nextState, session.lastToolName);
    broadcastMessage(session, {
      type: "state",
      state: nextState,
      ...(session.lastToolName ? { toolName: session.lastToolName } : {}),
    });
  };

  const resolveSession =
    resolveTerminalSession ??
    ((terminalId: string) => {
      if (!terminals.has(terminalId)) {
        return null;
      }
      const terminal = terminals.get(terminalId);
      return {
        sessionId: terminalId,
        tentacleId: terminal?.tentacleId ?? terminalId,
      };
    });

  const clearIdleCloseTimer = (session: TerminalSession) => {
    if (!session.idleCloseTimer) {
      return;
    }

    clearTimeout(session.idleCloseTimer);
    session.idleCloseTimer = undefined;
  };

  const clearPromptTimers = (session: TerminalSession) => {
    if (!session.promptTimers) {
      return;
    }

    for (const timer of session.promptTimers) {
      clearTimeout(timer);
    }
    session.promptTimers.clear();
  };

  const schedulePromptTimer = (
    session: TerminalSession,
    sessionId: string,
    callback: () => void,
    delayMs: number,
  ) => {
    const timer = setTimeout(() => {
      session.promptTimers?.delete(timer);
      if (session.isClosed || sessions.get(sessionId) !== session) {
        return;
      }

      callback();
    }, delayMs);

    if (!session.promptTimers) {
      session.promptTimers = new Set();
    }
    session.promptTimers.add(timer);
  };

  const appendScrollback = (session: TerminalSession, chunk: string) => {
    let nextChunk = chunk;
    let nextChunkBytes = Buffer.byteLength(nextChunk, "utf8");
    if (nextChunkBytes > scrollbackMaxBytes) {
      const chunkBuffer = Buffer.from(nextChunk, "utf8");
      nextChunk = chunkBuffer.subarray(chunkBuffer.length - scrollbackMaxBytes).toString("utf8");
      nextChunkBytes = Buffer.byteLength(nextChunk, "utf8");
      session.scrollbackChunks = [];
      session.scrollbackBytes = 0;
    }

    session.scrollbackChunks.push(nextChunk);
    session.scrollbackBytes += nextChunkBytes;
    while (session.scrollbackBytes > scrollbackMaxBytes && session.scrollbackChunks.length > 0) {
      const removedChunk = session.scrollbackChunks.shift();
      if (!removedChunk) {
        break;
      }

      session.scrollbackBytes -= Buffer.byteLength(removedChunk, "utf8");
    }
  };

  const stripBrokenLeadingAnsi = (text: string): string => {
    let nextText = text;

    while (nextText.length > 0) {
      if (nextText.startsWith("\u001b")) {
        return nextText;
      }

      const oscMatch = nextText.match(BROKEN_OSC_TAIL_RE);
      if (oscMatch) {
        nextText = nextText.slice(oscMatch[0].length);
        continue;
      }

      const csiTailMatch = nextText.match(/^\[[0-9:;<=>?]*[ -/]*[@-~]/);
      if (csiTailMatch) {
        nextText = nextText.slice(csiTailMatch[0].length);
        continue;
      }

      const orphanedCsiTailMatch = nextText.match(
        /^(?=[0-9:;<=>?]*[;:<=>?])[0-9:;<=>?]*[ -/]*[@-~]/,
      );
      if (orphanedCsiTailMatch) {
        nextText = nextText.slice(orphanedCsiTailMatch[0].length);
        continue;
      }

      break;
    }

    return nextText;
  };

  const sendHistory = (websocket: WebSocket, session: TerminalSession) => {
    if (session.scrollbackChunks.length === 0) {
      return;
    }

    sendMessage(websocket, {
      type: "history",
      data: stripBrokenLeadingAnsi(session.scrollbackChunks.join("")),
    });
  };

  const teardownSession = (
    sessionId: string,
    session: TerminalSession,
    event: Omit<SessionEndTranscriptEvent, "eventId" | "sessionId" | "tentacleId">,
    options: { killPty: boolean; killSignal?: string },
  ): void => {
    if (session.isClosed) {
      return;
    }

    session.isClosed = true;
    clearIdleCloseTimer(session);
    clearPromptTimers(session);
    closeTranscript(session, sessionId, event);
    onSessionEnd?.(sessionId, {
      reason:
        event.reason === "pty_exit" ||
        event.reason === "operator_stop" ||
        event.reason === "operator_kill"
          ? event.reason
          : "session_close",
      endedAt: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
      ...(typeof event.exitCode === "number" ? { exitCode: event.exitCode } : {}),
      ...(typeof event.signal === "number" || typeof event.signal === "string"
        ? { signal: event.signal }
        : {}),
    });

    if (session.statePollTimer) {
      clearInterval(session.statePollTimer);
      session.statePollTimer = undefined;
    }

    for (const disposable of session.ptyDisposables ?? []) {
      try {
        disposable.dispose();
      } catch {
        // Ignore listener cleanup errors; the PTY teardown below is still required.
      }
    }
    session.ptyDisposables = [];

    if (options.killPty) {
      try {
        session.pty?.kill(options.killSignal);
      } catch {
        // Ignore teardown errors; session will still be discarded.
      }
    }

    for (const client of session.clients) {
      if (client.readyState === 1) {
        client.close();
      }
    }
    session.clients.clear();
    session.directListeners.clear();
    session.debugLog?.end();
    session.debugLog = undefined;

    if (sessions.get(sessionId) === session) {
      sessions.delete(sessionId);
    }

    // Reliability fix: drop the heavy references that hold the IPty's
    // master FD alive. The disposables above remove our listeners, but
    // the IPty object itself is held by `session.pty` (and indirectly
    // by the data/exit closure scopes that captured `session`). Null
    // them out explicitly so the next GC pass can release the FD —
    // otherwise PTY allocations accumulate until `kern.tty.ptmx_max`
    // is exhausted (default 511 on macOS, ~10-20 min of usage).
    //
    // This runs on a `setImmediate` boundary so any in-flight node-pty
    // callbacks (the exit handler especially) finish first.
    setImmediate(() => {
      session.pty = null;
      session.scrollbackChunks = [];
      session.scrollbackBytes = 0;
      session.transcriptLog = undefined;
    });
  };

  const closeSession = (sessionId: string): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }

    teardownSession(
      sessionId,
      session,
      {
        type: "session_end",
        reason: "session_close",
        timestamp: new Date().toISOString(),
      },
      { killPty: true },
    );
    return true;
  };

  const stopSession = (sessionId: string): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }

    teardownSession(
      sessionId,
      session,
      {
        type: "session_end",
        reason: "operator_stop",
        timestamp: new Date().toISOString(),
      },
      { killPty: true },
    );
    return true;
  };

  const killSession = (sessionId: string, signal = "SIGKILL"): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }

    teardownSession(
      sessionId,
      session,
      {
        type: "session_end",
        reason: "operator_kill",
        signal,
        timestamp: new Date().toISOString(),
      },
      { killPty: true, killSignal: signal },
    );
    return true;
  };

  const INITIAL_PROMPT_DELAY_MS = 4_000;
  const INITIAL_PROMPT_SUBMIT_DELAY_MS = 150;
  const BRACKETED_PASTE_START = "\x1b[200~";
  const BRACKETED_PASTE_END = "\x1b[201~";

  const scheduleIdleCloseIfNeeded = (session: TerminalSession, sessionId: string) => {
    if (session.isClosed || sessions.get(sessionId) !== session) {
      return;
    }

    if (session.keepAliveWithoutClients) {
      return;
    }

    if (session.clients.size > 0 || session.directListeners.size > 0) {
      return;
    }

    appendDebugLog(
      session,
      `idle-grace-start session=${sessionId} timeoutMs=${sessionIdleGraceMs}`,
    );
    clearIdleCloseTimer(session);
    session.idleCloseTimer = setTimeout(() => {
      appendDebugLog(session, `idle-grace-expired session=${sessionId}`);
      closeSession(sessionId);
    }, sessionIdleGraceMs);
  };

  const ensureAgentBootstrapped = (sessionId: string, session: TerminalSession) => {
    if (session.isBootstrapCommandSent) {
      return;
    }

    session.isBootstrapCommandSent = true;
    const terminal = terminals.get(session.terminalId);
    const provider = terminal?.agentProvider ?? DEFAULT_AGENT_PROVIDER;

    const bootstrapCommand =
      TERMINAL_BOOTSTRAP_COMMANDS[provider] ?? TERMINAL_BOOTSTRAP_COMMANDS[DEFAULT_AGENT_PROVIDER];
    appendDebugLog(session, `bootstrap session=${sessionId} command=${bootstrapCommand}`);
    session.pty?.write(`${bootstrapCommand}\r`);

    // Schedule initial prompt injection after Claude Code has had time to boot.
    if (session.initialPrompt && !session.isInitialPromptSent) {
      schedulePromptTimer(
        session,
        sessionId,
        () => {
          if (session.isInitialPromptSent) {
            return;
          }
          session.isInitialPromptSent = true;
          appendDebugLog(session, `initial-prompt session=${sessionId}`);
          const prompt = session.initialPrompt ?? "";
          session.pty?.write(`${BRACKETED_PASTE_START}${prompt}${BRACKETED_PASTE_END}`);
          schedulePromptTimer(
            session,
            sessionId,
            () => {
              appendDebugLog(session, `initial-prompt-submit session=${sessionId}`);
              session.pty?.write("\r");
            },
            INITIAL_PROMPT_SUBMIT_DELAY_MS,
          );
        },
        INITIAL_PROMPT_DELAY_MS,
      );
    }

    if (session.initialInputDraft && !session.isInitialInputDraftSent && !session.initialPrompt) {
      schedulePromptTimer(
        session,
        sessionId,
        () => {
          if (session.isInitialInputDraftSent) {
            return;
          }
          session.isInitialInputDraftSent = true;
          appendDebugLog(session, `initial-input-draft session=${sessionId}`);
          const draft = session.initialInputDraft ?? "";
          session.pty?.write(`${BRACKETED_PASTE_START}${draft}${BRACKETED_PASTE_END}`);
        },
        INITIAL_PROMPT_DELAY_MS,
      );
    }
  };

  const ensureSession = (sessionId: string, tentacleId: string) => {
    const existingSession = sessions.get(sessionId);
    if (existingSession) {
      return existingSession;
    }

    if (sessions.size >= sessionLimit) {
      throw new Error(
        `Terminal session limit reached (${sessionLimit}). Close an existing terminal session or increase OCTOGENT_MAX_TERMINAL_SESSIONS.`,
      );
    }

    const terminalRecord = terminals.get(sessionId);

    const tentacleCwd = getTentacleWorkspaceCwd(tentacleId);
    if (!existsSync(tentacleCwd)) {
      throw new Error(`Terminal working directory does not exist: ${tentacleCwd}`);
    }

    ensureNodePtySpawnHelperExecutable();
    const shellLaunch = getShellLaunch();

    let pty: IPty;
    try {
      pty = spawn(shellLaunch.command, shellLaunch.args, {
        cols: DEFAULT_PTY_COLS,
        rows: DEFAULT_PTY_ROWS,
        cwd: tentacleCwd,
        env: createShellEnvironment({ octogentSessionId: sessionId }),
        name: "xterm-256color",
      });
    } catch (error) {
      throw new Error(
        `Unable to start terminal shell (${shellLaunch.command}): ${toErrorMessage(error)}`,
      );
    }

    const stateTracker = new AgentStateTracker();
    const debugLog = createDebugLog(sessionId);
    const transcriptLog = createTranscriptLog(sessionId);
    const session: TerminalSession = {
      terminalId: sessionId,
      tentacleId,
      pty,
      clients: new Set(),
      directListeners: new Set(),
      cols: DEFAULT_PTY_COLS,
      rows: DEFAULT_PTY_ROWS,
      agentState: stateTracker.currentState,
      stateTracker,
      isBootstrapCommandSent: false,
      scrollbackChunks: [],
      scrollbackBytes: 0,
      transcriptEventCount: 0,
      pendingInput: "",
      hasTranscriptEnded: false,
      keepAliveWithoutClients: Boolean(terminalRecord?.initialPrompt),
    };
    if (debugLog) {
      session.debugLog = debugLog;
    }
    session.transcriptLog = transcriptLog;

    appendDebugLog(session, `session-start session=${sessionId} tentacle=${tentacleId}`);
    const processId =
      typeof pty.pid === "number" && Number.isInteger(pty.pid) && pty.pid > 0 ? pty.pid : undefined;
    onSessionStart?.(sessionId, {
      startedAt: new Date().toISOString(),
      ...(processId ? { processId } : {}),
    });
    appendTranscriptEvent(session, sessionId, {
      type: "session_start",
      timestamp: new Date().toISOString(),
    });
    session.statePollTimer = setInterval(() => {
      emitStateIfChanged(session, sessionId, session.stateTracker.poll(Date.now()));
    }, 300);

    // session.pty is guaranteed non-null here (just assigned ~80 lines up).
    // The non-null assertion documents intent for the type checker.
    const dataDisposable = session.pty!.onData((chunk) => {
      if (session.isClosed) {
        return;
      }

      appendDebugLog(session, `pty-output session=${sessionId} chunk=${JSON.stringify(chunk)}`);
      appendScrollback(session, chunk);
      const nextState = session.stateTracker.observeChunk(chunk, Date.now());
      broadcastMessage(session, {
        type: "output",
        data: chunk,
      });
      emitStateIfChanged(session, sessionId, nextState);
    });

    const exitDisposable = session.pty!.onExit(({ exitCode, signal }) => {
      if (session.isClosed) {
        return;
      }

      const message = `\r\n[terminal exited (code ${exitCode}, signal ${signal})]\r\n`;
      broadcastMessage(session, {
        type: "output",
        data: message,
      });

      appendDebugLog(
        session,
        `session-exit session=${sessionId} code=${exitCode} signal=${signal}`,
      );
      teardownSession(
        sessionId,
        session,
        {
          type: "session_end",
          reason: "pty_exit",
          ...(Number.isFinite(exitCode) ? { exitCode } : {}),
          ...(Number.isFinite(signal) ? { signal } : {}),
          timestamp: new Date().toISOString(),
        },
        { killPty: false },
      );
    });
    session.ptyDisposables = [dataDisposable, exitDisposable];

    // Propagate initial prompt from the terminal definition, if set.
    if (terminalRecord?.initialPrompt) {
      session.initialPrompt = terminalRecord.initialPrompt;
    }
    if (terminalRecord?.initialInputDraft) {
      session.initialInputDraft = terminalRecord.initialInputDraft;
    }

    sessions.set(sessionId, session);
    return session;
  };

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    const terminalId = getTerminalId(request);
    if (!terminalId) {
      return false;
    }

    const resolvedSession = resolveSession(terminalId);
    if (!resolvedSession) {
      return false;
    }
    const { sessionId, tentacleId } = resolvedSession;

    websocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      let session: TerminalSession;
      try {
        session = ensureSession(sessionId, tentacleId);
      } catch (error) {
        sendMessage(websocket, {
          type: "output",
          data: `\r\n[terminal failed to start: ${toErrorMessage(error)}]\r\n`,
        });
        websocket.close();
        return;
      }

      session.clients.add(websocket);
      appendDebugLog(session, `ws-open session=${sessionId} clients=${session.clients.size}`);
      clearIdleCloseTimer(session);
      ensureAgentBootstrapped(sessionId, session);
      sendHistory(websocket, session);
      sendMessage(websocket, {
        type: "state",
        state: session.agentState,
      });

      websocket.on("message", (raw: unknown) => {
        if (session.isClosed) {
          return;
        }

        const text =
          typeof raw === "string" ? raw : raw instanceof Buffer ? raw.toString() : String(raw);
        try {
          const payload = JSON.parse(text) as
            | { type: "input"; data: string }
            | { type: "resize"; cols: number; rows: number };

          if (payload.type === "input" && typeof payload.data === "string") {
            appendDebugLog(
              session,
              `ws-input session=${sessionId} data=${JSON.stringify(payload.data)}`,
            );
            session.pty?.write(payload.data);
            if (/[\r\n]/.test(payload.data)) {
              emitStateIfChanged(
                session,
                sessionId,
                session.stateTracker.observeSubmit(Date.now()),
              );
            }
            return;
          }

          if (
            payload.type === "resize" &&
            Number.isFinite(payload.cols) &&
            Number.isFinite(payload.rows)
          ) {
            const nextCols = Math.max(20, Math.floor(payload.cols));
            const nextRows = Math.max(10, Math.floor(payload.rows));
            if (session.cols === nextCols && session.rows === nextRows) {
              return;
            }

            session.cols = nextCols;
            session.rows = nextRows;
            session.pty?.resize(nextCols, nextRows);
          }
        } catch {
          session.pty?.write(text);
        }
      });

      websocket.on("close", () => {
        if (session.isClosed) {
          return;
        }

        session.clients.delete(websocket);
        appendDebugLog(session, `ws-close session=${sessionId} clients=${session.clients.size}`);
        scheduleIdleCloseIfNeeded(session, sessionId);
      });
    });

    return true;
  };

  const close = () => {
    for (const sessionId of sessions.keys()) {
      closeSession(sessionId);
    }
  };

  const connectDirect = (
    terminalId: string,
    listener: DirectSessionListener,
  ): (() => void) | null => {
    const resolvedSession = resolveSession(terminalId);
    if (!resolvedSession) {
      return null;
    }
    const { sessionId, tentacleId } = resolvedSession;

    let session: TerminalSession;
    try {
      session = ensureSession(sessionId, tentacleId);
    } catch {
      return null;
    }

    session.directListeners.add(listener);
    clearIdleCloseTimer(session);
    ensureAgentBootstrapped(sessionId, session);

    // Send history and current state to the new listener
    if (session.scrollbackChunks.length > 0) {
      listener({ type: "history", data: session.scrollbackChunks.join("") });
    }
    listener({ type: "state", state: session.agentState });

    return () => {
      if (session.isClosed) {
        return;
      }

      session.directListeners.delete(listener);
      scheduleIdleCloseIfNeeded(session, sessionId);
    };
  };

  const startSession = (terminalId: string): boolean => {
    const resolvedSession = resolveSession(terminalId);
    if (!resolvedSession) {
      return false;
    }

    const { sessionId, tentacleId } = resolvedSession;
    let session: TerminalSession;
    try {
      session = ensureSession(sessionId, tentacleId);
    } catch {
      return false;
    }

    clearIdleCloseTimer(session);
    ensureAgentBootstrapped(sessionId, session);
    return true;
  };

  const writeInput = (terminalId: string, data: string): boolean => {
    const session = sessions.get(terminalId);
    if (!session || session.isClosed) {
      return false;
    }

    session.pty?.write(data);
    if (/[\r\n]/.test(data)) {
      emitStateIfChanged(session, terminalId, session.stateTracker.observeSubmit(Date.now()));
    }
    return true;
  };

  const resizeSession = (terminalId: string, cols: number, rows: number): boolean => {
    const session = sessions.get(terminalId);
    if (!session || session.isClosed) {
      return false;
    }

    const nextCols = Math.max(20, Math.floor(cols));
    const nextRows = Math.max(10, Math.floor(rows));
    if (session.cols === nextCols && session.rows === nextRows) {
      return true;
    }

    session.cols = nextCols;
    session.rows = nextRows;
    session.pty?.resize(nextCols, nextRows);
    return true;
  };

  const releaseSessionKeepAlive = (terminalId: string): boolean => {
    const session = sessions.get(terminalId);
    if (!session || session.isClosed) {
      return false;
    }

    session.keepAliveWithoutClients = false;
    scheduleIdleCloseIfNeeded(session, terminalId);
    return true;
  };

  return {
    closeSession,
    stopSession,
    killSession,
    handleUpgrade,
    connectDirect,
    startSession,
    writeInput,
    resizeSession,
    releaseSessionKeepAlive,
    close,
    getSessionCapacity: () => ({
      active: sessions.size,
      max: sessionLimit,
    }),
  };
};
