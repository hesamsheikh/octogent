import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createShellEnvironmentMock, ensureSpawnHelperMock, spawnMock } = vi.hoisted(() => ({
  createShellEnvironmentMock: vi.fn(() => ({})),
  ensureSpawnHelperMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

vi.mock("../src/terminalRuntime/ptyEnvironment", () => ({
  createShellEnvironment: createShellEnvironmentMock,
  ensureNodePtySpawnHelperExecutable: ensureSpawnHelperMock,
}));

vi.mock("../src/terminalRuntime/screenRender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/terminalRuntime/screenRender")>();
  return { renderScreen: vi.fn(actual.renderScreen) };
});

import * as logging from "../src/logging";
import { renderScreen } from "../src/terminalRuntime/screenRender";
import { createSessionRuntime } from "../src/terminalRuntime/sessionRuntime";
import type { PersistedTerminal, TerminalSession } from "../src/terminalRuntime/types";

class FakePty extends EventEmitter {
  write = vi.fn();
  resize = vi.fn();
  kill = vi.fn();

  onData(listener: (chunk: string) => void) {
    this.on("data", listener);
    return {
      dispose: () => {
        this.off("data", listener);
      },
    };
  }

  onExit(listener: (event: { exitCode: number; signal: number }) => void) {
    this.on("exit", listener);
    return {
      dispose: () => {
        this.off("exit", listener);
      },
    };
  }

  emitData(chunk: string) {
    this.emit("data", chunk);
  }

  emitExit(event: { exitCode: number; signal: number }) {
    this.emit("exit", event);
  }
}

class FakeWebSocket extends EventEmitter {
  readyState = 1;
  sentMessages: string[] = [];
  send = vi.fn((payload: string) => {
    this.sentMessages.push(payload);
  });
  close = vi.fn(() => {
    if (this.readyState !== 1) {
      return;
    }

    this.readyState = 3;
    this.emit("close");
  });
}

class FakeWebSocketServer {
  nextSocket: FakeWebSocket | null = null;

  handleUpgrade = vi.fn(
    (
      _request: IncomingMessage,
      _socket: Duplex,
      _head: Buffer,
      callback: (socket: FakeWebSocket) => void,
    ) => {
      if (!this.nextSocket) {
        throw new Error("Missing websocket for upgrade.");
      }

      const socket = this.nextSocket;
      this.nextSocket = null;
      callback(socket);
    },
  );
}

const createUpgradeRequest = (tentacleId: string) =>
  ({
    url: `/api/terminals/${tentacleId}/ws`,
  }) as IncomingMessage;

const parseSentMessages = (socket: FakeWebSocket) =>
  socket.sentMessages.map((raw) => JSON.parse(raw) as { type: string; data?: string });

const renderScreenMock = vi.mocked(renderScreen);

// xterm parses writes on a timer, so fake-timer tests have to let it run.
const settle = async <T>(pending: Promise<T>): Promise<T> => {
  await vi.advanceTimersByTimeAsync(0);
  return pending;
};

describe("createSessionRuntime", () => {
  const temporaryDirectories: string[] = [];

  const createTemporaryDirectory = () => {
    const directory = mkdtempSync(join(tmpdir(), "octogent-session-runtime-test-"));
    temporaryDirectories.push(directory);
    return directory;
  };

  beforeEach(() => {
    createShellEnvironmentMock.mockClear();
    ensureSpawnHelperMock.mockClear();
    spawnMock.mockReset();
    renderScreenMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  it.each(["closeSession", "stopSession", "killSession", "exit", "close"] as const)(
    "saves the rendered screen on %s and accepts input in busy states",
    async (ending) => {
      vi.useFakeTimers();
      const directory = createTemporaryDirectory();
      const sessions = new Map<string, TerminalSession>();
      const terminals = new Map<string, PersistedTerminal>([
        [
          "worker",
          {
            terminalId: "worker",
            tentacleId: "worker",
            tentacleName: "worker",
            createdAt: new Date().toISOString(),
            workspaceMode: "shared",
          },
        ],
      ]);
      const pty = new FakePty();
      spawnMock.mockReturnValue(pty);
      const runtime = createSessionRuntime({
        websocketServer: new FakeWebSocketServer() as unknown as import("ws").WebSocketServer,
        terminals,
        sessions,
        getTentacleWorkspaceCwd: () => directory,
        isDebugPtyLogsEnabled: false,
        ptyLogDir: directory,
        transcriptDirectoryPath: directory,
      });
      runtime.startSession("worker");
      pty.write.mockClear();
      pty.emitData(
        "\x1b]0;Claude\x07\x1b[31mRead outside?\x1b[0m\r\n1. No\x1b[1;1H\x1b[2KRead outside?\x1b[2;1H1. Yes",
      );
      expect(await settle(runtime.getScreen("worker", 2))).toMatchObject({
        text: "Read outside?\n1. Yes",
        savedAt: null,
      });
      for (const state of ["processing", "waiting_for_permission"] as const) {
        const session = sessions.get("worker");
        if (session) session.agentState = state;
        expect(
          runtime.submitInput("worker", {
            text: "1",
            enter: true,
            keys: ["tab", "esc", "up", "down", "ctrl-c", "9", "enter"],
          }),
        ).toBe(true);
        expect(pty.write.mock.calls.at(-1)?.[0]).toBe("1\t\x1b\x1b[A\x1b[B\x039\r");
        await vi.advanceTimersByTimeAsync(150);
        expect(pty.write.mock.calls.at(-1)?.[0]).toBe("\r");
      }
      expect(runtime.submitInput("missing", { text: "x" })).toBe(false);
      expect(() => runtime.submitInput("worker", { keys: ["delete"] })).toThrow();
      expect(() => runtime.submitInput("worker", { text: "界".repeat(1400) })).toThrow();
      if (ending === "exit") pty.emitExit({ exitCode: 1, signal: 0 });
      else if (ending === "close") runtime.close();
      else runtime[ending]("worker");
      await vi.waitFor(() =>
        expect(readFileSync(join(directory, "worker.screen.txt"), "utf8")).toBe(
          "Read outside?\n1. Yes",
        ),
      );
      expect(await runtime.getScreen("worker", 1)).toMatchObject({
        text: "1. Yes",
        savedAt: expect.any(String),
      });
      expect(await runtime.getScreen("../worker")).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() =>
        expect(readFileSync(join(directory, "worker.jsonl"), "utf8")).toContain('"input_submit"'),
      );
      runtime.close();
    },
  );

  it("bounds saved screens, tolerates write failures, and cancels Enter on replacement", async () => {
    vi.useFakeTimers();
    const directory = createTemporaryDirectory();
    const transcriptDirectoryPath = join(directory, "transcripts");
    const sessions = new Map<string, TerminalSession>();
    const terminals = new Map<string, PersistedTerminal>([
      [
        "worker",
        {
          terminalId: "worker",
          tentacleId: "worker",
          tentacleName: "worker",
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);
    const runtime = createSessionRuntime({
      websocketServer: new FakeWebSocketServer() as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => directory,
      isDebugPtyLogsEnabled: false,
      ptyLogDir: directory,
      transcriptDirectoryPath,
    });
    runtime.startSession("worker");
    pty.emitData(Array.from({ length: 205 }, (_, i) => `line ${i}`).join("\r\n"));
    runtime.submitInput("worker", { text: "1", enter: true });
    runtime.stopSession("worker");
    expect((await runtime.getScreen("worker", 200))?.text.split("\n")).toHaveLength(200);
    expect((await runtime.getScreen("worker", 200))?.text).toMatch(/^line 5\n/);
    const replacement = new FakePty();
    spawnMock.mockReturnValue(replacement);
    runtime.startSession("worker");
    replacement.write.mockClear();
    await vi.advanceTimersByTimeAsync(150);
    expect(replacement.write).not.toHaveBeenCalled();
    rmSync(transcriptDirectoryPath, { recursive: true, force: true });
    writeFileSync(transcriptDirectoryPath, "not a directory");
    expect(() => runtime.closeSession("worker")).not.toThrow();
    // The deferred rendered save hits the same unwritable path and must stay silent.
    await vi.advanceTimersByTimeAsync(1);
    expect(sessions.size).toBe(0);
    expect(replacement.kill).toHaveBeenCalledOnce();
    runtime.close();
  });

  it("keeps the stripped screen when rendering fails and ignores a stale render", async () => {
    const directory = createTemporaryDirectory();
    const screenFile = join(directory, "worker.screen.txt");
    const sessions = new Map<string, TerminalSession>();
    const terminals = new Map<string, PersistedTerminal>([
      [
        "worker",
        {
          terminalId: "worker",
          tentacleId: "worker",
          tentacleName: "worker",
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const runtime = createSessionRuntime({
      websocketServer: new FakeWebSocketServer() as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => directory,
      isDebugPtyLogsEnabled: false,
      ptyLogDir: directory,
      transcriptDirectoryPath: directory,
    });
    const runSession = (output: string) => {
      const pty = new FakePty();
      spawnMock.mockReturnValue(pty);
      runtime.startSession("worker");
      runtime.resizeSession("worker", 100, 30);
      pty.emitData(output);
      runtime.stopSession("worker");
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    renderScreenMock.mockRejectedValueOnce(new Error("renderer unavailable"));
    runSession("Working 100%\rLimit reached\x1b[K");
    expect(renderScreenMock).toHaveBeenLastCalledWith(expect.any(String), {
      lines: 200,
      cols: 100,
      rows: 30,
    });
    await flush();
    expect(readFileSync(screenFile, "utf8")).toBe("Limit reached");

    let finishStaleRender: (text: string) => void = () => {};
    renderScreenMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStaleRender = resolve;
        }),
    );
    runSession("first session");
    runSession("second\x1b[1;1Hfirst");
    await vi.waitFor(() => expect(readFileSync(screenFile, "utf8")).toBe("firstd"));
    finishStaleRender("first session");
    await flush();
    expect(readFileSync(screenFile, "utf8")).toBe("firstd");
    runtime.close();
  });

  it("keeps a session alive across reconnects and replays scrollback history", () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
    });

    const firstSocket = new FakeWebSocket();
    websocketServer.nextSocket = firstSocket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);

    pty.emitData("first line\r\n");
    pty.emitData("second line\r\n");
    firstSocket.close();
    expect(sessions.has(tentacleId)).toBe(true);

    const secondSocket = new FakeWebSocket();
    websocketServer.nextSocket = secondSocket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);

    const secondMessages = parseSentMessages(secondSocket);
    expect(secondMessages.find((message) => message.type === "history")).toEqual({
      type: "history",
      data: "first line\r\nsecond line\r\n",
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(pty.write).toHaveBeenCalledTimes(1);

    runtime.close();
  });

  describe("codex rate-limit prompt", () => {
    // Trimmed live capture (2026-09-21): rows are painted by cursor address.
    const PROMPT =
      "\u001b[23;1H  \u001b[1mApproaching rate limits\u001b[24;1H\u001b[22m  Switch to gpt-5.6-luna for lower credit usage?\u001b[26;1H› 1. Switch to gpt-5.6-luna\u001b[27;1H  2. Keep current model\u001b[28;1H  3. Keep current model (never show again)";

    const startCodexSession = (onStateChange = vi.fn()) => {
      const terminalId = "codex-worker";
      const terminals = new Map<string, PersistedTerminal>([
        [
          terminalId,
          {
            terminalId,
            tentacleId: terminalId,
            tentacleName: terminalId,
            createdAt: new Date().toISOString(),
            workspaceMode: "shared",
            agentProvider: "codex",
          },
        ],
      ]);
      const sessions = new Map<string, TerminalSession>();
      const websocketServer = new FakeWebSocketServer();
      const pty = new FakePty();
      spawnMock.mockReturnValue(pty);
      const runtime = createSessionRuntime({
        websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
        terminals,
        sessions,
        getTentacleWorkspaceCwd: () => process.cwd(),
        isDebugPtyLogsEnabled: false,
        ptyLogDir: process.cwd(),
        transcriptDirectoryPath: createTemporaryDirectory(),
        sessionIdleGraceMs: 60_000,
        onStateChange,
      });
      websocketServer.nextSocket = new FakeWebSocket();
      runtime.handleUpgrade(createUpgradeRequest(terminalId), {} as Duplex, Buffer.alloc(0));
      pty.write.mockClear();
      return { runtime, pty, sessions, terminalId, onStateChange };
    };

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("keeps the operator's model by default: Down then Enter, once per paint", () => {
      const { runtime, pty } = startCodexSession();

      pty.emitData(PROMPT);
      pty.emitData(PROMPT); // the TUI repaints; the answer must not be sent twice

      expect(pty.write.mock.calls.map((call) => call[0])).toEqual(["\u001b[B\r"]);
      runtime.close();
    });

    it("parks the worker as waiting-for-user when the policy is ask", () => {
      vi.stubEnv("OCTOGENT_CODEX_RATE_LIMIT_PROMPT", "ask");
      const { runtime, pty, sessions, terminalId, onStateChange } = startCodexSession();

      pty.emitData(PROMPT);

      expect(pty.write).not.toHaveBeenCalled();
      expect(sessions.get(terminalId)?.agentState).toBe("waiting_for_user");
      expect(onStateChange).toHaveBeenCalledWith(
        terminalId,
        "waiting_for_user",
        "codex rate-limit prompt",
      );
      runtime.close();
    });
  });

  it("reports PTY output as activity, throttled to one tick per burst", () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);
    const onOutputActivity = vi.fn();

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath: createTemporaryDirectory(),
      sessionIdleGraceMs: 60_000,
      onOutputActivity,
    });
    websocketServer.nextSocket = new FakeWebSocket();
    runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0));

    // A spinner redraws many times a second; only the first chunk of a burst
    // should count, so the registry is not rewritten on every frame.
    pty.emitData("⠋ thinking");
    pty.emitData("⠙ thinking");
    pty.emitData("⠹ thinking");

    expect(onOutputActivity).toHaveBeenCalledTimes(1);
    expect(onOutputActivity).toHaveBeenCalledWith(tentacleId);

    runtime.close();
  });

  it("records a provider error banner once, however often it repaints", () => {
    const terminal: PersistedTerminal = {
      terminalId: "worker",
      tentacleId: "worker",
      tentacleName: "worker",
      createdAt: new Date().toISOString(),
      workspaceMode: "shared",
      agentProvider: "codex",
      lifecycleState: "running",
    };
    const terminals = new Map([["worker", terminal]]);
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);
    const onTerminalUpdated = vi.fn();
    const logVerbose = vi.spyOn(logging, "logVerbose").mockImplementation(() => {});
    const runtime = createSessionRuntime({
      websocketServer: new FakeWebSocketServer() as unknown as import("ws").WebSocketServer,
      terminals,
      sessions: new Map<string, TerminalSession>(),
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath: createTemporaryDirectory(),
      onTerminalUpdated,
    });
    runtime.startSession("worker");

    const banner =
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 15th, 2026 11:51 AM.";
    pty.emitData(`\x1b[31m■\x1b[39m ${banner.slice(0, 30)}`);
    expect(onTerminalUpdated).not.toHaveBeenCalled();
    pty.emitData(`${banner.slice(30)}\r\n`);
    for (let frame = 0; frame < 5; frame++) {
      pty.emitData(`\x1b[8;1H■ ${banner}\x1b[9;1H› `);
    }

    expect(onTerminalUpdated).toHaveBeenCalledExactlyOnceWith("worker");
    expect(terminal).toMatchObject({
      lifecycleState: "running",
      lifecycleReason: `provider error: ${banner}`,
      providerError: { kind: "usage-limit", message: banner, at: expect.any(String) },
    });
    expect(logVerbose).toHaveBeenCalledWith(
      expect.stringMatching(/provider error.*worker.*usage-limit/i),
    );

    // A different wall is news again.
    pty.emitData("\r\n  ⎿  API Error: Connection lost mid-response\r\n");
    expect(onTerminalUpdated).toHaveBeenCalledTimes(2);
    expect(terminal.providerError?.kind).toBe("api-error");

    runtime.close();
    logVerbose.mockRestore();
  });

  it("closes idle sessions after the configured grace timeout", () => {
    vi.useFakeTimers();

    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 1000,
      scrollbackMaxBytes: 1024,
    });

    const socket = new FakeWebSocket();
    websocketServer.nextSocket = socket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);
    socket.close();

    expect(sessions.has(tentacleId)).toBe(true);
    vi.advanceTimersByTime(999);
    expect(sessions.has(tentacleId)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(sessions.has(tentacleId)).toBe(false);

    runtime.close();
  });

  it("disposes PTY subscriptions when a session is closed", () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
    });

    expect(runtime.startSession(tentacleId)).toBe(true);
    expect(pty.listenerCount("data")).toBe(1);
    expect(pty.listenerCount("exit")).toBe(1);

    expect(runtime.closeSession(tentacleId)).toBe(true);

    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(pty.listenerCount("data")).toBe(0);
    expect(pty.listenerCount("exit")).toBe(0);
    expect(sessions.has(tentacleId)).toBe(false);

    runtime.close();
  });

  it("clears delayed prompt timers when a prompted session is closed", () => {
    vi.useFakeTimers();

    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
          initialPrompt: "Investigate and report back.",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
    });

    expect(runtime.startSession(tentacleId)).toBe(true);
    expect(pty.write).toHaveBeenNthCalledWith(1, "claude --permission-mode auto\r");

    expect(runtime.closeSession(tentacleId)).toBe(true);
    vi.advanceTimersByTime(40_000);

    expect(pty.write).toHaveBeenCalledTimes(1);
    expect(sessions.has(tentacleId)).toBe(false);

    runtime.close();
  });

  it("runs session timers without holding the process open and drops them on close", () => {
    vi.useFakeTimers();

    const terminalId = "terminal-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        terminalId,
        {
          terminalId,
          tentacleId: terminalId,
          tentacleName: terminalId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    spawnMock.mockReturnValue(new FakePty());
    const runtime = createSessionRuntime({
      websocketServer: new FakeWebSocketServer() as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath: createTemporaryDirectory(),
    });
    const callback = vi.fn();

    expect(runtime.scheduleSessionTimer(terminalId, callback, 1_000)).toBe(false);
    expect(runtime.startSession(terminalId)).toBe(true);
    expect(runtime.scheduleSessionTimer(terminalId, callback, 1_000)).toBe(true);
    const timers = [...(sessions.get(terminalId)?.promptTimers ?? [])];
    expect(timers).toHaveLength(1);
    expect(timers.every((timer) => !timer.hasRef())).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(callback).toHaveBeenCalledTimes(1);

    expect(runtime.scheduleSessionTimer(terminalId, callback, 1_000)).toBe(true);
    runtime.closeSession(terminalId);
    vi.advanceTimersByTime(60_000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(runtime.scheduleSessionTimer(terminalId, callback, 1_000)).toBe(false);

    runtime.close();
  });

  it("adds the existing tentacles directory to a worktree Claude bootstrap", () => {
    const tentacleId = "tentacle-1";
    const workspaceCwd = createTemporaryDirectory();
    const tentaclesDirectory = join(workspaceCwd, ".octogent", "tentacles");
    mkdirSync(tentaclesDirectory, { recursive: true });
    mkdirSync(join(workspaceCwd, ".octogent", "worktrees", tentacleId), { recursive: true });
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "worktree",
          agentProvider: "claude-code",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      workspaceCwd,
      getTentacleWorkspaceCwd: () => join(workspaceCwd, ".octogent", "worktrees", tentacleId),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: workspaceCwd,
      transcriptDirectoryPath: createTemporaryDirectory(),
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
    });

    expect(runtime.startSession(tentacleId)).toBe(true);
    expect(pty.write).toHaveBeenNthCalledWith(
      1,
      `claude --permission-mode auto --add-dir '${tentaclesDirectory}'\r`,
    );

    runtime.close();
  });

  it("releases headless prompted sessions after keepalive is dropped", () => {
    vi.useFakeTimers();

    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
          initialPrompt: "Investigate and report back.",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 1_000,
      scrollbackMaxBytes: 1024,
    });

    expect(runtime.startSession(tentacleId)).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(sessions.has(tentacleId)).toBe(true);

    expect(runtime.releaseSessionKeepAlive(tentacleId)).toBe(true);
    vi.advanceTimersByTime(999);
    expect(sessions.has(tentacleId)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(sessions.has(tentacleId)).toBe(false);

    runtime.close();
  });

  it("removes exited sessions without killing the already-exited PTY", () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
    });

    expect(runtime.startSession(tentacleId)).toBe(true);
    pty.emitExit({ exitCode: 0, signal: 0 });

    expect(pty.kill).not.toHaveBeenCalled();
    expect(pty.listenerCount("data")).toBe(0);
    expect(pty.listenerCount("exit")).toBe(0);
    expect(sessions.has(tentacleId)).toBe(false);

    runtime.close();
  });

  it("enforces the configured max concurrent terminal sessions before spawning", () => {
    const terminals = new Map<string, PersistedTerminal>([
      [
        "tentacle-1",
        {
          terminalId: "tentacle-1",
          tentacleId: "tentacle-1",
          tentacleName: "tentacle-1",
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
      [
        "tentacle-2",
        {
          terminalId: "tentacle-2",
          tentacleId: "tentacle-2",
          tentacleName: "tentacle-2",
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const firstPty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(firstPty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
      maxConcurrentSessions: 1,
    });

    expect(runtime.startSession("tentacle-1")).toBe(true);
    expect(runtime.startSession("tentacle-2")).toBe(false);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(sessions.has("tentacle-1")).toBe(true);
    expect(sessions.has("tentacle-2")).toBe(false);

    runtime.close();
  });

  it("truncates oversize chunks to the configured scrollback size", () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 8,
    });

    const firstSocket = new FakeWebSocket();
    websocketServer.nextSocket = firstSocket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);
    pty.emitData("123456789012");
    firstSocket.close();

    const secondSocket = new FakeWebSocket();
    websocketServer.nextSocket = secondSocket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);

    const secondMessages = parseSentMessages(secondSocket);
    expect(secondMessages.find((message) => message.type === "history")).toEqual({
      type: "history",
      data: "56789012",
    });

    runtime.close();
  });

  it("strips a broken leading ANSI fragment from replayed history after truncation", () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 18,
    });

    const firstSocket = new FakeWebSocket();
    websocketServer.nextSocket = firstSocket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);
    pty.emitData("\u001b[48;2;55;55;55mHELLO\r\n");
    firstSocket.close();

    const secondSocket = new FakeWebSocket();
    websocketServer.nextSocket = secondSocket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);

    const secondMessages = parseSentMessages(secondSocket);
    expect(secondMessages.find((message) => message.type === "history")).toEqual({
      type: "history",
      data: "HELLO\r\n",
    });

    runtime.close();
  });

  it("ignores duplicate resize payloads for the same terminal size", () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
    });

    const socket = new FakeWebSocket();
    websocketServer.nextSocket = socket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);

    socket.emit("message", JSON.stringify({ type: "resize", cols: 120, rows: 35 }));
    socket.emit("message", JSON.stringify({ type: "resize", cols: 120, rows: 35 }));
    socket.emit("message", JSON.stringify({ type: "resize", cols: 121, rows: 35 }));

    expect(pty.resize).toHaveBeenCalledTimes(1);
    expect(pty.resize).toHaveBeenLastCalledWith(121, 35);

    runtime.close();
  });

  it("writes normalized transcript events for each terminal session", async () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
    });

    const socket = new FakeWebSocket();
    websocketServer.nextSocket = socket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);

    socket.emit("message", JSON.stringify({ type: "input", data: "echo hi\r" }));
    pty.emitData("\u001b[31mred\u001b[0m\r\n");
    runtime.close();

    const transcriptPath = join(transcriptDirectoryPath, `${encodeURIComponent(tentacleId)}.jsonl`);
    type TranscriptEvent = { type: string; text?: string; reason?: string };

    // The file appearing does not mean the stream flushed a whole line, so wait
    // for content that parses rather than for the path to exist.
    const readTranscriptEvents = (): TranscriptEvent[] => {
      if (!existsSync(transcriptPath)) {
        return [];
      }
      const contents = readFileSync(transcriptPath, "utf8").trim();
      if (!contents) {
        return [];
      }
      try {
        return contents.split(/\r?\n/).map((line) => JSON.parse(line) as TranscriptEvent);
      } catch {
        return [];
      }
    };

    let transcriptEvents: TranscriptEvent[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      transcriptEvents = readTranscriptEvents();
      if (
        transcriptEvents.some((event) => event.type === "session_start") &&
        transcriptEvents.some((event) => event.type === "session_end")
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(transcriptEvents.some((event) => event.type === "session_start")).toBe(true);
    expect(
      transcriptEvents.some(
        (event) => event.type === "session_end" && event.reason === "session_close",
      ),
    ).toBe(true);
  });

  describe("initial prompt delivery", () => {
    const terminalId = "terminal-1";
    const prompt = "Investigate and report back.\nInclude your findings.";
    const paste = `\u001b[200~${prompt}\u001b[201~`;
    let runtime: ReturnType<typeof createSessionRuntime>;

    const makeHarness = (overrides: Partial<PersistedTerminal> = {}) => {
      const terminal: PersistedTerminal = {
        terminalId,
        tentacleId: "tentacle-1",
        tentacleName: "Worker",
        createdAt: new Date().toISOString(),
        workspaceMode: "shared",
        lifecycleState: "running",
        initialPrompt: prompt,
        ...overrides,
      };
      const terminals = new Map([[terminalId, terminal]]);
      const sessions = new Map<string, TerminalSession>();
      const pty = new FakePty();
      const onTerminalUpdated = vi.fn();
      const logVerbose = vi.spyOn(logging, "logVerbose").mockImplementation(() => {});
      spawnMock.mockReturnValue(pty);
      runtime = createSessionRuntime({
        websocketServer: new FakeWebSocketServer() as unknown as import("ws").WebSocketServer,
        terminals,
        sessions,
        getTentacleWorkspaceCwd: () => process.cwd(),
        isDebugPtyLogsEnabled: false,
        ptyLogDir: process.cwd(),
        transcriptDirectoryPath: createTemporaryDirectory(),
        onTerminalUpdated,
      });
      expect(runtime.startSession(terminalId)).toBe(true);
      expect(pty.write).toHaveBeenCalledTimes(1);
      return { terminal, terminals, sessions, pty, onTerminalUpdated, logVerbose };
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-07T04:34:00Z"));
    });

    afterEach(() => {
      runtime?.close();
      vi.restoreAllMocks();
    });

    it.each(["claude-code", "codex"] as const)(
      "waits for %s readiness, submits once, and ignores duplicate readiness and fallback",
      (agentProvider) => {
        const { pty, sessions, terminal, onTerminalUpdated } = makeHarness({ agentProvider });
        vi.advanceTimersByTime(8_000);
        expect(pty.write).toHaveBeenCalledTimes(1);

        runtime.sendInitialPromptNow(terminalId);
        runtime.sendInitialPromptNow(terminalId);
        expect(pty.write.mock.calls.slice(1)).toEqual([[paste]]);
        expect(sessions.get(terminalId)?.initialPromptSentAt).toBe(Date.now());
        vi.advanceTimersByTime(149);
        expect(pty.write).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(1);
        expect(pty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"]]);

        runtime.acknowledgeInitialPrompt(terminalId);
        expect(sessions.get(terminalId)?.isInitialPromptAcknowledged).toBe(true);
        runtime.sendInitialPromptNow(terminalId);
        vi.advanceTimersByTime(60_000);
        expect(pty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"]]);
        expect(terminal.lifecycleReason).toBeUndefined();
        expect(onTerminalUpdated).not.toHaveBeenCalled();
      },
    );

    it("falls back after 15 seconds and never retries without a session-start hook", () => {
      const { pty, terminal, onTerminalUpdated } = makeHarness();
      vi.advanceTimersByTime(14_999);
      expect(pty.write).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(pty.write.mock.calls.slice(1)).toEqual([[paste]]);
      vi.advanceTimersByTime(150);
      expect(pty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"]]);

      vi.advanceTimersByTime(60_000);
      expect(pty.write).toHaveBeenCalledTimes(3);
      expect(terminal.lifecycleReason).toBeUndefined();
      expect(onTerminalUpdated).not.toHaveBeenCalled();
    });

    it("retries an unacknowledged prompt exactly once and reports the second timeout", () => {
      const { pty, terminal, onTerminalUpdated, logVerbose } = makeHarness();
      runtime.sendInitialPromptNow(terminalId);
      vi.advanceTimersByTime(9_999);
      expect(pty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"]]);
      vi.advanceTimersByTime(1);
      expect(pty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"], [paste]]);
      expect(logVerbose).toHaveBeenCalledWith(
        expect.stringMatching(/initial.prompt.*retry.*terminal-1/i),
      );
      vi.advanceTimersByTime(150);
      expect(pty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"], [paste], ["\r"]]);
      expect(terminal.lifecycleReason).toBeUndefined();

      vi.advanceTimersByTime(9_849);
      expect(onTerminalUpdated).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(terminal.lifecycleReason).toBe("initial prompt not acknowledged");
      expect(terminal.lifecycleState).toBe("running");
      expect(onTerminalUpdated).toHaveBeenCalledExactlyOnceWith(terminalId);
      runtime.sendInitialPromptNow(terminalId);
      vi.advanceTimersByTime(60_000);
      expect(pty.write).toHaveBeenCalledTimes(5);
      expect(onTerminalUpdated).toHaveBeenCalledTimes(1);
    });

    it.each([10_150, 20_001])(
      "accepts acknowledgement after %i ms without more retries",
      (delay) => {
        const { pty, terminal, sessions, onTerminalUpdated } = makeHarness();
        runtime.sendInitialPromptNow(terminalId);
        vi.advanceTimersByTime(delay);
        runtime.acknowledgeInitialPrompt(terminalId);
        runtime.acknowledgeInitialPrompt(terminalId);
        expect(sessions.get(terminalId)?.isInitialPromptAcknowledged).toBe(true);
        expect(terminal.lifecycleReason).toBeUndefined();
        expect(onTerminalUpdated).toHaveBeenCalledTimes(delay > 20_000 ? 2 : 0);
        vi.advanceTimersByTime(60_000);
        expect(pty.write).toHaveBeenCalledTimes(5);
        expect(terminal.lifecycleReason).toBeUndefined();
      },
    );

    it.each([16_000, 26_000])(
      "verifies a fallback send when readiness arrives at %i ms",
      (delay) => {
        const { pty } = makeHarness();
        vi.advanceTimersByTime(delay);
        expect(pty.write).toHaveBeenCalledTimes(3);
        runtime.sendInitialPromptNow(terminalId);
        runtime.sendInitialPromptNow(terminalId);
        expect(pty.write).toHaveBeenCalledTimes(3);
        vi.advanceTimersByTime(Math.max(0, 25_000 - delay));
        expect(pty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"], [paste]]);
        vi.advanceTimersByTime(150);
        runtime.acknowledgeInitialPrompt(terminalId);
        vi.advanceTimersByTime(60_000);
        expect(pty.write).toHaveBeenCalledTimes(5);
      },
    );

    it("does not retry a fallback prompt already acknowledged before readiness", () => {
      const { pty } = makeHarness();
      vi.advanceTimersByTime(15_150);
      runtime.acknowledgeInitialPrompt(terminalId);
      vi.advanceTimersByTime(20_000);
      runtime.sendInitialPromptNow(terminalId);
      vi.advanceTimersByTime(60_000);
      expect(pty.write).toHaveBeenCalledTimes(3);
    });

    it("reports whether a prompt submit acknowledged the initial prompt", () => {
      makeHarness();
      expect(runtime.acknowledgeInitialPrompt(terminalId)).toBe(false);
      runtime.sendInitialPromptNow(terminalId);
      // Only the first submit after the paste belongs to the initial prompt;
      // later ones are left for channel messages.
      expect(runtime.acknowledgeInitialPrompt(terminalId)).toBe(true);
      expect(runtime.acknowledgeInitialPrompt(terminalId)).toBe(false);
      expect(runtime.acknowledgeInitialPrompt("unknown")).toBe(false);
    });

    it("ignores acknowledgements before sending and hooks for unknown sessions", () => {
      const { pty, sessions } = makeHarness();
      runtime.acknowledgeInitialPrompt(terminalId);
      runtime.sendInitialPromptNow("unknown");
      runtime.acknowledgeInitialPrompt("unknown");
      expect(sessions.get(terminalId)?.isInitialPromptAcknowledged).not.toBe(true);
      expect(pty.write).toHaveBeenCalledTimes(1);
      runtime.sendInitialPromptNow(terminalId);
      vi.advanceTimersByTime(10_150);
      expect(pty.write).toHaveBeenCalledTimes(5);
    });

    it.each([0, 150, 10_000, 10_150])(
      "cancels pending writes and verification when closed at %i ms",
      (delay) => {
        const { pty, onTerminalUpdated } = makeHarness();
        runtime.sendInitialPromptNow(terminalId);
        vi.advanceTimersByTime(delay);
        const writesBeforeClose = pty.write.mock.calls.length;
        runtime.closeSession(terminalId);
        runtime.sendInitialPromptNow(terminalId);
        runtime.acknowledgeInitialPrompt(terminalId);
        vi.advanceTimersByTime(60_000);
        expect(pty.write).toHaveBeenCalledTimes(writesBeforeClose);
        expect(onTerminalUpdated).not.toHaveBeenCalled();
      },
    );

    it("does not apply an old session's verification to a replacement session", () => {
      const { pty, sessions, onTerminalUpdated } = makeHarness();
      runtime.sendInitialPromptNow(terminalId);
      vi.advanceTimersByTime(150);
      const previousSession = sessions.get(terminalId);
      sessions.delete(terminalId);
      const replacementPty = new FakePty();
      spawnMock.mockReturnValue(replacementPty);
      runtime.startSession(terminalId);
      vi.advanceTimersByTime(20_000);
      expect(pty.write).toHaveBeenCalledTimes(3);
      expect(replacementPty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"]]);
      expect(onTerminalUpdated).not.toHaveBeenCalled();
      runtime.closeSession(terminalId);
      if (previousSession) sessions.set(terminalId, previousSession);
    });

    it("keeps concurrent workers' readiness and acknowledgements separate", () => {
      const { terminal, terminals, pty } = makeHarness();
      vi.advanceTimersByTime(1_000);
      const secondId = "terminal-2";
      terminals.set(secondId, { ...terminal, terminalId: secondId });
      const secondPty = new FakePty();
      spawnMock.mockReturnValue(secondPty);
      runtime.startSession(secondId);
      vi.advanceTimersByTime(7_000);
      expect(pty.write).toHaveBeenCalledTimes(1);
      expect(secondPty.write).toHaveBeenCalledTimes(1);
      runtime.sendInitialPromptNow(secondId);
      vi.advanceTimersByTime(150);
      runtime.acknowledgeInitialPrompt(secondId);
      vi.advanceTimersByTime(1_000);
      expect(pty.write).toHaveBeenCalledTimes(1);
      runtime.sendInitialPromptNow(terminalId);
      vi.advanceTimersByTime(10_150);
      expect(pty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"], [paste], ["\r"]]);
      expect(secondPty.write.mock.calls.slice(1)).toEqual([[paste], ["\r"]]);
    });

    it("preserves a later lifecycle verdict when verification times out or is acknowledged", () => {
      const { terminal, onTerminalUpdated } = makeHarness();
      runtime.sendInitialPromptNow(terminalId);
      vi.advanceTimersByTime(10_150);
      terminal.lifecycleState = "stalled";
      terminal.lifecycleReason = "no transcript activity";
      vi.advanceTimersByTime(10_000);
      runtime.acknowledgeInitialPrompt(terminalId);
      expect(terminal.lifecycleState).toBe("stalled");
      expect(terminal.lifecycleReason).toBe("no transcript activity");
      expect(onTerminalUpdated).not.toHaveBeenCalled();
    });
  });

  it("pastes an initial input draft without submitting it", () => {
    vi.useFakeTimers();

    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
          initialInputDraft: "You are working on docs.",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 1_000,
      scrollbackMaxBytes: 1_024,
    });

    const socket = new FakeWebSocket();
    websocketServer.nextSocket = socket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);

    expect(pty.write).toHaveBeenNthCalledWith(1, "claude --permission-mode auto\r");

    runtime.sendInitialPromptNow(tentacleId);
    runtime.acknowledgeInitialPrompt(tentacleId);
    expect(pty.write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4_000);
    expect(pty.write).toHaveBeenNthCalledWith(2, "\u001b[200~You are working on docs.\u001b[201~");

    vi.advanceTimersByTime(150);
    expect(pty.write).toHaveBeenCalledTimes(2);

    runtime.close();
  });

  it("reports runtime state changes through the state-change callback", () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    const transcriptDirectoryPath = createTemporaryDirectory();
    const onStateChange = vi.fn();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
      onStateChange,
    });

    const socket = new FakeWebSocket();
    websocketServer.nextSocket = socket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);

    socket.emit("message", JSON.stringify({ type: "input", data: "echo hi\r" }));

    expect(onStateChange).toHaveBeenCalledWith(tentacleId, "processing", undefined);

    runtime.close();
  });

  it("reports session lifecycle start and exit through callbacks", () => {
    const tentacleId = "tentacle-1";
    const terminals = new Map<string, PersistedTerminal>([
      [
        tentacleId,
        {
          terminalId: tentacleId,
          tentacleId,
          tentacleName: tentacleId,
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
        },
      ],
    ]);
    const sessions = new Map<string, TerminalSession>();
    const websocketServer = new FakeWebSocketServer();
    const pty = new FakePty();
    Object.defineProperty(pty, "pid", { value: 3210 });
    const transcriptDirectoryPath = createTemporaryDirectory();
    const onSessionStart = vi.fn();
    const onSessionEnd = vi.fn();
    spawnMock.mockReturnValue(pty);

    const runtime = createSessionRuntime({
      websocketServer: websocketServer as unknown as import("ws").WebSocketServer,
      terminals,
      sessions,
      getTentacleWorkspaceCwd: () => process.cwd(),
      isDebugPtyLogsEnabled: false,
      ptyLogDir: process.cwd(),
      transcriptDirectoryPath,
      sessionIdleGraceMs: 60_000,
      scrollbackMaxBytes: 1024,
      onSessionStart,
      onSessionEnd,
    });

    const socket = new FakeWebSocket();
    websocketServer.nextSocket = socket;
    expect(
      runtime.handleUpgrade(createUpgradeRequest(tentacleId), {} as Duplex, Buffer.alloc(0)),
    ).toBe(true);

    expect(onSessionStart).toHaveBeenCalledWith(
      tentacleId,
      expect.objectContaining({
        processId: 3210,
        startedAt: expect.any(String),
      }),
    );

    pty.emit("exit", { exitCode: 7, signal: 0 });

    expect(onSessionEnd).toHaveBeenCalledWith(
      tentacleId,
      expect.objectContaining({
        reason: "pty_exit",
        exitCode: 7,
        signal: 0,
        endedAt: expect.any(String),
      }),
    );
    expect(sessions.has(tentacleId)).toBe(false);

    runtime.close();
  });

  it("builds each session's environment from the project and the terminal's inherited variables", () => {
    const workspaceCwd = createTemporaryDirectory();
    const terminals = new Map<string, PersistedTerminal>([
      [
        "worker",
        {
          terminalId: "worker",
          tentacleId: "worker",
          tentacleName: "worker",
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
          inheritedEnv: ["VIRTUAL_ENV"],
        },
      ],
    ]);
    const shellEnv = { PATH: "/usr/bin", VIRTUAL_ENV: "/caller/.venv" };
    createShellEnvironmentMock.mockReturnValueOnce(shellEnv);
    spawnMock.mockReturnValue(new FakePty());
    const getInheritedEnv = vi.fn(() => ({ VIRTUAL_ENV: "/caller/.venv" }));
    const runtime = createSessionRuntime({
      websocketServer: new FakeWebSocketServer() as unknown as import("ws").WebSocketServer,
      terminals,
      sessions: new Map<string, TerminalSession>(),
      workspaceCwd,
      getTentacleWorkspaceCwd: () => workspaceCwd,
      getInheritedEnv,
      getApiBaseUrl: () => "http://127.0.0.1:9999",
      isDebugPtyLogsEnabled: false,
      ptyLogDir: workspaceCwd,
      transcriptDirectoryPath: workspaceCwd,
    });

    runtime.startSession("worker");

    expect(getInheritedEnv).toHaveBeenCalledWith("worker");
    expect(createShellEnvironmentMock).toHaveBeenCalledWith({
      octogentSessionId: "worker",
      apiBaseUrl: "http://127.0.0.1:9999",
      workspaceCwd,
      inheritedEnv: { VIRTUAL_ENV: "/caller/.venv" },
    });
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ env: shellEnv });
    runtime.close();
  });

  it("notes recorded inherited names whose values did not survive a restart", () => {
    const logVerbose = vi.spyOn(logging, "logVerbose").mockImplementation(() => {});
    const workspaceCwd = createTemporaryDirectory();
    const terminals = new Map<string, PersistedTerminal>([
      [
        "worker",
        {
          terminalId: "worker",
          tentacleId: "worker",
          tentacleName: "worker",
          createdAt: new Date().toISOString(),
          workspaceMode: "shared",
          inheritedEnv: ["PATH", "VIRTUAL_ENV"],
        },
      ],
    ]);
    spawnMock.mockReturnValue(new FakePty());
    const runtime = createSessionRuntime({
      websocketServer: new FakeWebSocketServer() as unknown as import("ws").WebSocketServer,
      terminals,
      sessions: new Map<string, TerminalSession>(),
      workspaceCwd,
      getTentacleWorkspaceCwd: () => workspaceCwd,
      getInheritedEnv: () => undefined,
      isDebugPtyLogsEnabled: false,
      ptyLogDir: workspaceCwd,
      transcriptDirectoryPath: workspaceCwd,
    });

    runtime.startSession("worker");

    expect(createShellEnvironmentMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ inheritedEnv: expect.anything() }),
    );
    expect(logVerbose).toHaveBeenCalledWith(
      expect.stringMatching(/inherited env PATH, VIRTUAL_ENV .*session=worker/),
    );
    logVerbose.mockRestore();
    runtime.close();
  });
});
