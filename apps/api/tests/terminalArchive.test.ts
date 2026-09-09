import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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

import { createApiServer } from "../src/createApiServer";
import { type GitClient, createTerminalRuntime } from "../src/terminalRuntime";

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
}

class FakeGitClient implements GitClient {
  assertAvailable(): void {}

  isRepository(): boolean {
    return true;
  }

  addWorktree(): void {}

  removeWorktree(): void {}

  removeBranch(): void {}

  readWorktreeStatus(): ReturnType<GitClient["readWorktreeStatus"]> {
    return {
      branchName: "main",
      upstreamBranchName: null,
      isDirty: false,
      aheadCount: 0,
      behindCount: 0,
      insertedLineCount: 0,
      deletedLineCount: 0,
      hasConflicts: false,
      changedFiles: [],
      defaultBaseBranchName: "main",
    };
  }

  commitAll(): void {}

  pushCurrentBranch(): void {}

  syncWithBase(): void {}

  readCurrentBranchPullRequest(): null {
    return null;
  }

  createPullRequest(): null {
    return null;
  }

  mergeCurrentBranchPullRequest(): void {}
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

type SeedTerminal = Record<string, unknown>;

const seedTerminal = (terminalId: string, overrides: SeedTerminal): SeedTerminal => ({
  terminalId,
  tentacleId: terminalId,
  tentacleName: terminalId,
  createdAt: hoursAgo(200),
  workspaceMode: "shared",
  ...overrides,
});

describe("terminal archiving", () => {
  let stopServer: (() => Promise<void>) | null = null;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    if (stopServer) {
      await stopServer();
      stopServer = null;
    }

    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
    spawnMock.mockReset();
  });

  const startServer = async (seededTerminals?: SeedTerminal[]) => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-terminal-archive-test-"));
    temporaryDirectories.push(workspaceCwd);

    if (seededTerminals) {
      const stateDir = join(workspaceCwd, ".octogent", "state");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        join(stateDir, "tentacles.json"),
        `${JSON.stringify({ version: 3, terminals: seededTerminals }, null, 2)}\n`,
        "utf8",
      );
    }

    const apiServer = createApiServer({
      workspaceCwd,
      gitClient: new FakeGitClient(),
    });
    const address = await apiServer.start(0, "127.0.0.1");
    stopServer = () => apiServer.stop();
    return `http://${address.host}:${address.port}`;
  };

  const fetchSnapshots = async (baseUrl: string, query = "") => {
    const response = await fetch(`${baseUrl}/api/terminal-snapshots${query}`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Array<Record<string, unknown>>;
  };

  it("auto-archives expired completed/stopped records at startup but never awaiting-review", async () => {
    const baseUrl = await startServer([
      seedTerminal("term-old-completed", {
        lifecycleState: "completed",
        lifecycleUpdatedAt: hoursAgo(100),
      }),
      seedTerminal("term-old-stopped", {
        lifecycleState: "stopped",
        lifecycleUpdatedAt: hoursAgo(100),
      }),
      seedTerminal("term-fresh-stopped", {
        lifecycleState: "stopped",
        lifecycleUpdatedAt: hoursAgo(1),
      }),
      seedTerminal("term-old-review", {
        lifecycleState: "awaiting-review",
        lifecycleUpdatedAt: hoursAgo(1000),
      }),
    ]);

    const visible = await fetchSnapshots(baseUrl);
    const visibleIds = visible.map((snapshot) => snapshot.terminalId);
    expect(visibleIds).toEqual(["term-fresh-stopped", "term-old-review"]);

    const all = await fetchSnapshots(baseUrl, "?includeArchived=1");
    const byId = new Map(all.map((snapshot) => [snapshot.terminalId, snapshot]));
    expect(all).toHaveLength(4);
    expect(typeof byId.get("term-old-completed")?.archivedAt).toBe("string");
    expect(typeof byId.get("term-old-stopped")?.archivedAt).toBe("string");
    expect(byId.get("term-fresh-stopped")?.archivedAt).toBeUndefined();
    expect(byId.get("term-old-review")?.archivedAt).toBeUndefined();
    expect(byId.get("term-old-review")?.lifecycleState).toBe("awaiting-review");
  });

  it("on a new dispatch, removes finished ephemeral terminals but only archives deck ones", async () => {
    const baseUrl = await startServer([
      seedTerminal("term-ephemeral", {
        lifecycleState: "stopped",
        lifecycleUpdatedAt: hoursAgo(1),
      }),
      seedTerminal("term-deck", {
        tentacleId: "deck-tent",
        lifecycleState: "completed",
        lifecycleUpdatedAt: hoursAgo(1),
      }),
    ]);

    // Make term-deck's tentacle a durable deck tentacle (a folder on disk);
    // term-ephemeral keeps its synthetic tentacle and stays throwaway.
    const cwd = temporaryDirectories[temporaryDirectories.length - 1];
    if (cwd) {
      mkdirSync(join(cwd, ".octogent", "tentacles", "deck-tent"), { recursive: true });
    }

    // A new top-level dispatch is the next batch and triggers the sweep.
    await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const all = await fetchSnapshots(baseUrl, "?includeArchived=1");
    const byId = new Map(all.map((snapshot) => [snapshot.terminalId, snapshot]));
    // Ephemeral: gone outright (not even in the archived listing).
    expect(byId.has("term-ephemeral")).toBe(false);
    // Deck: archived (hidden by default) but still on disk — the iron rule.
    expect(typeof byId.get("term-deck")?.archivedAt).toBe("string");
  });

  it("archives a non-running terminal on demand and hides it from the default listing", async () => {
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { terminalId: string };

    const archiveResponse = await fetch(`${baseUrl}/api/terminals/${created.terminalId}/archive`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(archiveResponse.status).toBe(200);
    const archived = (await archiveResponse.json()) as Record<string, unknown>;
    expect(typeof archived.archivedAt).toBe("string");

    expect(await fetchSnapshots(baseUrl)).toHaveLength(0);
    const all = await fetchSnapshots(baseUrl, "?includeArchived=1");
    expect(all).toHaveLength(1);
    expect(all[0]?.terminalId).toBe(created.terminalId);
  });

  it("returns 404 when archiving an unknown terminal", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/terminals/missing/archive`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(response.status).toBe(404);
  });

  it("refuses to archive a running terminal", async () => {
    spawnMock.mockReturnValue(new FakePty());
    const baseUrl = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentProvider: "codex", initialPrompt: "do work" }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { terminalId: string };

    const archiveResponse = await fetch(`${baseUrl}/api/terminals/${created.terminalId}/archive`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(archiveResponse.status).toBe(409);
    const payload = (await archiveResponse.json()) as { error: string };
    expect(payload.error).toMatch(/running/i);

    const all = await fetchSnapshots(baseUrl, "?includeArchived=1");
    expect(all[0]?.archivedAt).toBeUndefined();
  });

  it("archives all completed terminals on demand, leaving other states alone", async () => {
    const baseUrl = await startServer([
      seedTerminal("term-completed-fresh", {
        lifecycleState: "completed",
        lifecycleUpdatedAt: hoursAgo(1),
      }),
      seedTerminal("term-stopped-fresh", {
        lifecycleState: "stopped",
        lifecycleUpdatedAt: hoursAgo(1),
      }),
      seedTerminal("term-review", {
        lifecycleState: "awaiting-review",
        lifecycleUpdatedAt: hoursAgo(1),
      }),
    ]);

    const response = await fetch(`${baseUrl}/api/terminals/archive-completed`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { archivedTerminalIds: string[] };
    expect(payload.archivedTerminalIds).toEqual(["term-completed-fresh"]);

    const visibleIds = (await fetchSnapshots(baseUrl)).map((snapshot) => snapshot.terminalId);
    expect(visibleIds).toEqual(["term-stopped-fresh", "term-review"]);
  });
});

describe("headless worker cleanup", () => {
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
    vi.stubEnv("OCTOGENT_TERMINAL_RELEASE_AFTER_TURN", undefined);
    vi.stubEnv("OCTOGENT_TERMINAL_IDLE_GRACE_MS", "300000");
    vi.stubEnv("OCTOGENT_TERMINAL_RETENTION_HOURS", "1");
    workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-worker-cleanup-"));
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);
    runtime = createTerminalRuntime({ workspaceCwd, gitClient: new FakeGitClient() });
    const { terminalId } = runtime.createTerminal({
      agentProvider: "codex",
      initialPrompt: "do work",
    });
    vi.advanceTimersByTime(5000);
    const stopTurn = () =>
      runtime.handleHook(
        "stop",
        {
          cwd: workspaceCwd,
          transcript_path: join(workspaceCwd, "missing-rollout"),
          last_assistant_message: "first turn done",
        },
        terminalId,
      );
    stopTurn();
    return { terminalId, pty };
  };

  it("delivers a later channel message after a completed worker outlives the idle grace", () => {
    const { terminalId, pty } = startWorker();
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(pty.kill).not.toHaveBeenCalled();
    expect(runtime.listTerminalSnapshots()[0]?.lifecycleState).toBe("completed");
    pty.write.mockClear();
    expect(runtime.sendChannelMessage(terminalId, "orchestrator", "continue")?.delivered).toBe(
      true,
    );
    vi.advanceTimersByTime(1000);
    expect(pty.write).toHaveBeenCalledWith(
      expect.stringContaining("[Channel message from orchestrator]: continue"),
    );
    expect(pty.write).toHaveBeenCalledWith("\r");
  });

  it.each(["manual", "completed", "retention"])(
    "releases an idle worker when archived by %s",
    (path) => {
      const { terminalId, pty } = startWorker();
      if (path === "manual") runtime.archiveTerminal(terminalId);
      if (path === "completed") expect(runtime.archiveCompletedTerminals()).toEqual([terminalId]);
      if (path === "retention") vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      expect(
        runtime
          .listTerminalSnapshots({ includeArchived: true })
          .find((t) => t.terminalId === terminalId)?.archivedAt,
      ).toEqual(expect.any(String));
      expect(pty.kill).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300000);
      expect(pty.kill).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["stop", "delete"])("closes a kept-alive worker immediately on %s", (path) => {
    const { terminalId, pty } = startWorker();
    if (path === "stop") runtime.stopTerminal(terminalId);
    if (path === "delete") runtime.deleteTerminal(terminalId);
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(runtime.readHealthCounts().ptySessions).toBe(0);
  });

  it("keeps a kept-alive idle worker through the next batch's dispatch", () => {
    // The orchestrator may dispatch B while A waits to be continued over the
    // channel; a live PTY means "still in use", idle or not.
    const { terminalId, pty } = startWorker();
    runtime.createTerminal({});
    expect(pty.kill).not.toHaveBeenCalled();
    expect(
      runtime.listTerminalSnapshots().find((t) => t.terminalId === terminalId)?.lifecycleState,
    ).toBe("completed");
  });

  it("protects a completed worker that has started another turn from archiving and sweeps", () => {
    const { terminalId, pty } = startWorker();
    runtime.handleHook("user-prompt-submit", { prompt: "continue" }, terminalId);
    expect(() => runtime.archiveTerminal(terminalId)).toThrow(/running/i);
    expect(runtime.archiveCompletedTerminals()).toEqual([]);
    runtime.createTerminal({});
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(pty.kill).not.toHaveBeenCalled();
    expect(runtime.listTerminalSnapshots().some((t) => t.terminalId === terminalId)).toBe(true);
  });
});
