import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node-pty", () => ({ spawn: spawnMock }));

vi.mock("../src/terminalRuntime/ptyEnvironment", () => ({
  createShellEnvironment: vi.fn(() => ({})),
  ensureNodePtySpawnHelperExecutable: vi.fn(),
}));

import { createTerminalRuntime } from "../src/terminalRuntime";

class FakePty extends EventEmitter {
  write = vi.fn();
  resize = vi.fn();
  kill = vi.fn();

  onData(listener: (chunk: string) => void) {
    this.on("data", listener);
    return { dispose: () => this.off("data", listener) };
  }

  onExit(listener: (event: { exitCode: number; signal: number }) => void) {
    this.on("exit", listener);
    return { dispose: () => this.off("exit", listener) };
  }
}

const BANNER =
  "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 15th, 2026 11:51 AM.";

describe("provider errors in the terminal runtime", () => {
  let runtime: ReturnType<typeof createTerminalRuntime>;
  let workspaceCwd: string;

  afterEach(async () => {
    await runtime?.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    if (workspaceCwd) rmSync(workspaceCwd, { recursive: true, force: true });
    spawnMock.mockReset();
  });

  const startWorker = () => {
    vi.useFakeTimers();
    vi.stubEnv("OCTOGENT_TERMINAL_STALL_MS", "60000");
    workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-provider-error-"));
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);
    runtime = createTerminalRuntime({ workspaceCwd });
    const { terminalId } = runtime.createTerminal({
      agentProvider: "codex",
      initialPrompt: "do work",
    });
    vi.advanceTimersByTime(5_000);
    return { terminalId, pty };
  };

  const snapshot = () => runtime.listTerminalSnapshots()[0];
  const readRecord = () =>
    JSON.parse(readFileSync(join(workspaceCwd, ".octogent/state/tentacles.json"), "utf8"))
      .terminals[0];

  it("surfaces the banner, keeps it through a stall, and clears it on the next tool call", async () => {
    const { terminalId, pty } = startWorker();
    pty.emit("data", `\x1b[31m■\x1b[39m ${BANNER}\r\n› `);

    expect(snapshot()).toMatchObject({
      lifecycleState: "running",
      lifecycleReason: `provider error: ${BANNER}`,
      providerError: { kind: "usage-limit", message: BANNER, at: expect.any(String) },
    });
    vi.advanceTimersByTime(200);
    await vi.waitFor(() => expect(readRecord().providerError?.kind).toBe("usage-limit"));

    // The stall that follows names the wall instead of "no transcript activity".
    vi.advanceTimersByTime(90_000);
    expect(snapshot()).toMatchObject({
      lifecycleState: "stalled",
      lifecycleReason: `provider error: ${BANNER}`,
    });
    // A new prompt alone is not progress: the agent may hit the same wall.
    runtime.handleHook("user-prompt-submit", { prompt: "continue" }, terminalId);
    expect(snapshot()).toMatchObject({
      lifecycleState: "running",
      lifecycleReason: `provider error: ${BANNER}`,
    });

    runtime.handleHook("pre-tool-use", { tool_name: "Bash" }, terminalId);
    expect(snapshot()?.providerError).toBeUndefined();
    expect(snapshot()?.lifecycleReason).toBeUndefined();
    vi.advanceTimersByTime(200);
    await vi.waitFor(() => expect(readRecord().providerError).toBeUndefined());
  });

  it("clears the error when a Stop hook yields a verdict", () => {
    const { terminalId, pty } = startWorker();
    pty.emit("data", "  ⎿  API Error: Connection lost mid-response\r\n");
    expect(snapshot()?.providerError?.kind).toBe("api-error");

    runtime.handleHook(
      "stop",
      { cwd: workspaceCwd, transcript_path: join(workspaceCwd, "missing-rollout") },
      terminalId,
    );
    expect(snapshot()?.lifecycleState).toBe("completed");
    expect(snapshot()?.providerError).toBeUndefined();
  });
});
