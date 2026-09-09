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
import type { GitClient } from "../src/terminalRuntime";

class RecordingGitClient implements GitClient {
  removedWorktreePaths: string[] = [];
  removedBranchNames: string[] = [];
  failingWorktreeIds: string[] = [];

  assertAvailable(): void {}

  isRepository(): boolean {
    return true;
  }

  addWorktree(): void {}

  removeWorktree({ path }: { cwd: string; path: string }): void {
    if (this.failingWorktreeIds.some((worktreeId) => path.endsWith(worktreeId))) {
      throw new Error(`simulated removal failure for ${path}`);
    }
    // Mirror real git behavior: the worktree directory is gone afterwards.
    rmSync(path, { recursive: true, force: true });
    this.removedWorktreePaths.push(path);
  }

  removeBranch({ branchName }: { cwd: string; branchName: string }): void {
    this.removedBranchNames.push(branchName);
  }

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

const seedWorktreeTerminal = (terminalId: string, overrides: SeedTerminal): SeedTerminal => ({
  terminalId,
  tentacleId: terminalId,
  tentacleName: terminalId,
  createdAt: hoursAgo(200),
  workspaceMode: "worktree",
  ...overrides,
});

const completionSummary = (merged: boolean): Record<string, unknown> => ({
  taskLine: null,
  commits: [{ hash: "abc1234", message: "feat: work" }],
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  branch: "octogent/branch",
  merged,
  durationMs: 1000,
  workspaceMode: "worktree",
});

describe("worktree gc", () => {
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

  const startServer = async (seededTerminals: SeedTerminal[], gitClient: RecordingGitClient) => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-worktree-gc-test-"));
    temporaryDirectories.push(workspaceCwd);

    const stateDir = join(workspaceCwd, ".octogent", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "tentacles.json"),
      `${JSON.stringify({ version: 3, terminals: seededTerminals }, null, 2)}\n`,
      "utf8",
    );

    for (const terminal of seededTerminals) {
      if (terminal.workspaceMode !== "worktree") {
        continue;
      }
      const worktreeId = String(terminal.worktreeId ?? terminal.tentacleId);
      mkdirSync(join(workspaceCwd, ".octogent", "worktrees", worktreeId), { recursive: true });
    }

    const apiServer = createApiServer({
      workspaceCwd,
      gitClient,
    });
    const address = await apiServer.start(0, "127.0.0.1");
    stopServer = () => apiServer.stop();
    return `http://${address.host}:${address.port}`;
  };

  const postGc = async (baseUrl: string, query = "") => {
    const response = await fetch(`${baseUrl}/api/worktrees/gc${query}`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      dryRun: boolean;
      candidates: Array<{ worktreeId: string; terminalIds: string[] }>;
      reclaimedWorktreeIds: string[];
      failedWorktreeIds: string[];
    };
  };

  it("reclaims merged worktrees when the archive sweep archives them, never unmerged ones", async () => {
    const gitClient = new RecordingGitClient();
    await startServer(
      [
        seedWorktreeTerminal("wt-merged", {
          lifecycleState: "completed",
          lifecycleUpdatedAt: hoursAgo(100),
        }),
        seedWorktreeTerminal("wt-merged-summary", {
          lifecycleState: "stopped",
          lifecycleUpdatedAt: hoursAgo(100),
          completionSummary: completionSummary(true),
        }),
        seedWorktreeTerminal("wt-unmerged", {
          lifecycleState: "stopped",
          lifecycleUpdatedAt: hoursAgo(100),
          completionSummary: completionSummary(false),
        }),
        seedWorktreeTerminal("wt-review", {
          lifecycleState: "awaiting-review",
          lifecycleUpdatedAt: hoursAgo(1000),
        }),
      ],
      gitClient,
    );

    const removedIds = gitClient.removedWorktreePaths.map((path) => path.split("/").pop());
    expect(removedIds.sort()).toEqual(["wt-merged", "wt-merged-summary"]);
    expect(gitClient.removedBranchNames.sort()).toEqual([
      "octogent/wt-merged",
      "octogent/wt-merged-summary",
    ]);
    // The iron rule: unmerged work is never deleted, no matter how old.
    expect(removedIds).not.toContain("wt-unmerged");
    expect(removedIds).not.toContain("wt-review");
  });

  it("lists candidates on dry run without touching git, then reclaims on a real run", async () => {
    const gitClient = new RecordingGitClient();
    const baseUrl = await startServer(
      [
        seedWorktreeTerminal("wt-done", {
          lifecycleState: "completed",
          lifecycleUpdatedAt: hoursAgo(1),
          archivedAt: hoursAgo(1),
        }),
        seedWorktreeTerminal("wt-keep", {
          lifecycleState: "stopped",
          lifecycleUpdatedAt: hoursAgo(1),
          archivedAt: hoursAgo(1),
          completionSummary: completionSummary(false),
        }),
        {
          terminalId: "sh-1",
          tentacleId: "sh-1",
          tentacleName: "sh-1",
          createdAt: hoursAgo(200),
          workspaceMode: "shared",
          lifecycleState: "completed",
          lifecycleUpdatedAt: hoursAgo(1),
          archivedAt: hoursAgo(1),
        },
      ],
      gitClient,
    );

    const dryRun = await postGc(baseUrl, "?dryRun=1");
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.candidates.map((candidate) => candidate.worktreeId)).toEqual(["wt-done"]);
    expect(dryRun.reclaimedWorktreeIds).toEqual([]);
    expect(gitClient.removedWorktreePaths).toEqual([]);
    expect(gitClient.removedBranchNames).toEqual([]);

    const real = await postGc(baseUrl);
    expect(real.dryRun).toBe(false);
    expect(real.reclaimedWorktreeIds).toEqual(["wt-done"]);
    expect(real.failedWorktreeIds).toEqual([]);
    const removedIds = gitClient.removedWorktreePaths.map((path) => path.split("/").pop());
    expect(removedIds).toEqual(["wt-done"]);
    expect(removedIds).not.toContain("wt-keep");

    // A second run finds nothing left to reclaim.
    gitClient.removedWorktreePaths.length = 0;
    const again = await postGc(baseUrl);
    expect(again.candidates).toEqual([]);
  });

  it("skips a worktree while any record sharing it is not reclaimable", async () => {
    const gitClient = new RecordingGitClient();
    const baseUrl = await startServer(
      [
        seedWorktreeTerminal("t-parent", {
          worktreeId: "wt-shared",
          lifecycleState: "completed",
          lifecycleUpdatedAt: hoursAgo(1),
          archivedAt: hoursAgo(1),
        }),
        seedWorktreeTerminal("t-child", {
          worktreeId: "wt-shared",
          lifecycleState: "awaiting-review",
          lifecycleUpdatedAt: hoursAgo(1),
        }),
      ],
      gitClient,
    );

    const result = await postGc(baseUrl);
    expect(result.candidates).toEqual([]);
    expect(gitClient.removedWorktreePaths).toEqual([]);
  });

  it("reports removal failures without throwing", async () => {
    const gitClient = new RecordingGitClient();
    gitClient.failingWorktreeIds.push("wt-fail");
    const baseUrl = await startServer(
      [
        seedWorktreeTerminal("wt-fail", {
          lifecycleState: "completed",
          lifecycleUpdatedAt: hoursAgo(1),
          archivedAt: hoursAgo(1),
        }),
      ],
      gitClient,
    );

    const result = await postGc(baseUrl);
    expect(result.reclaimedWorktreeIds).toEqual([]);
    expect(result.failedWorktreeIds).toEqual(["wt-fail"]);
  });

  it("rejects non-POST methods", async () => {
    const gitClient = new RecordingGitClient();
    const baseUrl = await startServer([], gitClient);

    const response = await fetch(`${baseUrl}/api/worktrees/gc`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status).toBe(405);
  });
});
