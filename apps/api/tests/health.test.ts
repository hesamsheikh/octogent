import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

import { createApiServer } from "../src/createApiServer";
import type { GitClient } from "../src/terminalRuntime";

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

const ROOT_PACKAGE_JSON_PATH = fileURLToPath(new URL("../../../package.json", import.meta.url));

describe("GET /api/health", () => {
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
  });

  const startServer = async (options: Partial<Parameters<typeof createApiServer>[0]> = {}) => {
    const workspaceCwd =
      options.workspaceCwd ??
      (() => {
        const directory = mkdtempSync(join(tmpdir(), "octogent-api-health-test-"));
        temporaryDirectories.push(directory);
        return directory;
      })();
    const apiServer = createApiServer({
      workspaceCwd,
      gitClient: options.gitClient ?? new FakeGitClient(),
      ...options,
    });
    const address = await apiServer.start(0, "127.0.0.1");
    stopServer = () => apiServer.stop();
    return `http://${address.host}:${address.port}`;
  };

  it("reports a full health snapshot with terminal counts", async () => {
    const baseUrl = await startServer();

    for (let index = 0; index < 2; index += 1) {
      const createResponse = await fetch(`${baseUrl}/api/terminals`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });
      expect(createResponse.status).toBe(201);
    }

    const response = await fetch(`${baseUrl}/api/health`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      status: string;
      uptimeMs: number;
      version: string;
      eventLoopDelayP95Ms: number;
      ptySessions: number;
      terminals: Record<string, number>;
      terminalEventClients: number;
    };

    const rootPackageJson = JSON.parse(readFileSync(ROOT_PACKAGE_JSON_PATH, "utf8")) as {
      version: string;
    };

    expect(payload).toMatchObject({
      status: "ok",
      version: rootPackageJson.version,
      ptySessions: 0,
      terminalEventClients: 0,
      terminals: {
        registered: 2,
        running: 0,
        stopped: 0,
        exited: 0,
        stale: 0,
        stalled: 0,
        "awaiting-review": 0,
        completed: 0,
      },
    });
    expect(payload.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(payload.eventLoopDelayP95Ms).toBeGreaterThanOrEqual(0);
    // The delay is reported in milliseconds rounded to one decimal place.
    expect(Math.round(payload.eventLoopDelayP95Ms * 10) / 10).toBe(payload.eventLoopDelayP95Ms);
  });

  it("returns an empty terminal count breakdown when no terminals exist", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/health`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      ptySessions: 0,
      terminalEventClients: 0,
      terminals: {
        registered: 0,
        running: 0,
        stopped: 0,
        exited: 0,
        stale: 0,
        stalled: 0,
        "awaiting-review": 0,
        completed: 0,
      },
    });
  });

  it("returns 405 for unsupported methods on /api/health", async () => {
    const baseUrl = await startServer();

    const response = await fetch(`${baseUrl}/api/health`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });
});
