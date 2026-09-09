import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

import { createApiServer } from "../src/createApiServer";
import type { GitClient } from "../src/terminalRuntime";

// Minimal IPty-compatible stub so createTerminal doesn't throw.
const fakePty = {
  onData: vi.fn(() => ({ dispose: vi.fn() })),
  onExit: vi.fn(() => ({ dispose: vi.fn() })),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 1,
  process: "claude",
  cols: 80,
  rows: 24,
};

class FakeGitClient implements GitClient {
  private readonly worktrees = new Map<
    string,
    { branchName: string; baseRef: string; cwd: string }
  >();
  private readonly branches = new Set<string>();

  assertAvailable(): void {}
  isRepository(): boolean {
    return true;
  }

  addWorktree({
    cwd,
    path,
    branchName,
    baseRef,
  }: { cwd: string; path: string; branchName: string; baseRef: string }): void {
    if (this.worktrees.has(path)) throw new Error(`Worktree already exists: ${path}`);
    mkdirSync(path, { recursive: true });
    this.branches.add(branchName);
    this.worktrees.set(path, { cwd, branchName, baseRef });
  }

  removeWorktree({ path }: { cwd: string; path: string }): void {
    this.worktrees.delete(path);
  }
  removeBranch({ branchName }: { cwd: string; branchName: string }): void {
    this.branches.delete(branchName);
  }

  readWorktreeStatus() {
    return {
      branchName: "octogent/test",
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
  readCurrentBranchPullRequest() {
    return null;
  }
  createPullRequest() {
    return null;
  }
  mergeCurrentBranchPullRequest(): void {}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeTentacle = (workspaceCwd: string, tentacleId: string, todo = "") => {
  const dir = join(workspaceCwd, ".octogent/tentacles", tentacleId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "CONTEXT.md"), `# ${tentacleId}\n\nTest tentacle.\n`);
  writeFileSync(join(dir, "todo.md"), todo || "# Todo\n");
  return dir;
};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("deck API routes", () => {
  let stopServer: (() => Promise<void>) | null = null;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    if (stopServer) {
      await stopServer();
      stopServer = null;
    }
    for (const dir of temporaryDirectories) {
      rmSync(dir, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
    spawnMock.mockReset();
  });

  const startServer = async (workspaceCwd?: string) => {
    const cwd =
      workspaceCwd ??
      (() => {
        const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
        temporaryDirectories.push(dir);
        return dir;
      })();

    spawnMock.mockReturnValue(fakePty);

    const server = createApiServer({ workspaceCwd: cwd, gitClient: new FakeGitClient() });
    const address = await server.start(0, "127.0.0.1");
    stopServer = () => server.stop();
    return { baseUrl: `http://${address.host}:${address.port}`, workspaceCwd: cwd };
  };

  // ── GET /api/deck/tentacles ────────────────────────────────────────────────

  describe("GET /api/deck/tentacles", () => {
    it("returns an empty array when no tentacles exist", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual([]);
    });

    it("returns a list of tentacles when they exist", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "alpha");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles`);
      expect(res.status).toBe(200);
      const tentacles = (await res.json()) as { tentacleId: string }[];
      expect(tentacles).toHaveLength(1);
      expect(tentacles[0]?.tentacleId).toBe("alpha");
    });

    it("returns 405 for unsupported methods", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles`, { method: "DELETE" });
      expect(res.status).toBe(405);
    });
  });

  // ── POST /api/deck/tentacles ───────────────────────────────────────────────

  describe("POST /api/deck/tentacles", () => {
    it("creates a tentacle and returns 201", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "my-tentacle", description: "Does stuff", color: "#ff0000" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { tentacleId: string; displayName: string };
      expect(body.tentacleId).toBe("my-tentacle");
      expect(body.displayName).toBe("my-tentacle");
    });

    it("returns 400 when name is empty", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", description: "x" }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
    });

    it("returns 400 when a tentacle with the same name already exists", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "existing");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "existing" }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
    });

    it("stores suggestedSkills on the new tentacle", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "skilled", suggestedSkills: ["typescript", "testing"] }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { suggestedSkills: string[] };
      expect(body.suggestedSkills).toEqual(["testing", "typescript"]); // sorted
    });
  });

  // ── GET /api/deck/skills ───────────────────────────────────────────────────

  describe("GET /api/deck/skills", () => {
    it("returns an array (empty when no skills are defined)", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/skills`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("returns 405 for POST", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/skills`, { method: "POST" });
      expect(res.status).toBe(405);
    });
  });

  // ── DELETE /api/deck/tentacles/:id ────────────────────────────────────────

  describe("DELETE /api/deck/tentacles/:id", () => {
    it("deletes an existing tentacle and returns 204", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "to-delete");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/to-delete`, { method: "DELETE" });
      expect(res.status).toBe(204);
    });

    it("returns 404 for a non-existent tentacle", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles/ghost`, { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("returns 405 for GET on the item route", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "alpha");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/alpha`, { method: "GET" });
      expect(res.status).toBe(405);
    });
  });

  // ── GET /api/deck/tentacles/:id/files/:name ───────────────────────────────

  describe("GET /api/deck/tentacles/:id/files/:name", () => {
    it("returns the vault file contents", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "vault-test");
      writeFileSync(join(dir, ".octogent/tentacles/vault-test/notes.md"), "# Notes\n\nHello.");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/vault-test/files/notes.md`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Hello.");
    });

    it("returns 404 when the file does not exist", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "vault-test");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/vault-test/files/missing.md`);
      expect(res.status).toBe(404);
    });

    it("returns 405 for POST on vault file route", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "vault-test");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/vault-test/files/todo.md`, {
        method: "POST",
      });
      expect(res.status).toBe(405);
    });
  });

  // ── PATCH /api/deck/tentacles/:id/skills ─────────────────────────────────

  describe("PATCH /api/deck/tentacles/:id/skills", () => {
    it("updates suggested skills and returns the updated tentacle", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "skill-test");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/skill-test/skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestedSkills: ["react", "vitest"] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { suggestedSkills: string[] };
      expect(body.suggestedSkills).toContain("react");
    });

    it("returns 400 when suggestedSkills is missing", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "skill-test");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/skill-test/skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: ["react"] }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for a non-existent tentacle", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles/ghost/skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestedSkills: ["react"] }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 405 for GET on skills route", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "skill-test");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/skill-test/skills`);
      expect(res.status).toBe(405);
    });
  });

  // ── PATCH /api/deck/tentacles/:id/todo/toggle ─────────────────────────────

  describe("PATCH /api/deck/tentacles/:id/todo/toggle", () => {
    const todoContent = "# Todo\n- [ ] First task\n- [x] Done task\n";

    it("marks an item as done", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "toggle-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/toggle-test/todo/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 0, done: true }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { done: boolean }[] };
      expect(body.items[0]?.done).toBe(true);
    });

    it("marks an item as not done", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "toggle-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/toggle-test/todo/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 1, done: false }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { done: boolean }[] };
      expect(body.items[1]?.done).toBe(false);
    });

    it("returns 400 when itemIndex or done are missing", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "toggle-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/toggle-test/todo/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 0 }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for an out-of-range item index", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "toggle-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/toggle-test/todo/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 99, done: true }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /api/deck/tentacles/:id/todo/edit ───────────────────────────────

  describe("PATCH /api/deck/tentacles/:id/todo/edit", () => {
    const todoContent = "# Todo\n- [ ] Original text\n";

    it("renames a todo item", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "edit-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/edit-test/todo/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 0, text: "Updated text" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { text: string }[] };
      expect(body.items[0]?.text).toBe("Updated text");
    });

    it("returns 400 when text is empty", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "edit-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/edit-test/todo/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 0, text: "  " }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when itemIndex is not a number", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "edit-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/edit-test/todo/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: "zero", text: "New text" }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/deck/tentacles/:id/todo ─────────────────────────────────────

  describe("POST /api/deck/tentacles/:id/todo", () => {
    it("adds a todo item and returns 201 with updated list", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "add-test");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/add-test/todo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Brand new task" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { items: { text: string; done: boolean }[] };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.text).toBe("Brand new task");
      expect(body.items[0]?.done).toBe(false);
    });

    it("returns 400 when text is empty", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "add-test");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/add-test/todo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for a non-existent tentacle", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles/ghost/todo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "task" }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/deck/tentacles/:id/todo/delete ──────────────────────────────

  describe("POST /api/deck/tentacles/:id/todo/delete", () => {
    const todoContent = "# Todo\n- [ ] First\n- [ ] Second\n";

    it("deletes a todo item by index", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "delete-todo-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/delete-todo-test/todo/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 0 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { text: string }[]; total: number };
      expect(body.total).toBe(1);
      expect(body.items[0]?.text).toBe("Second");
    });

    it("returns 400 when itemIndex is not a number", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "delete-todo-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/delete-todo-test/todo/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: "first" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for an out-of-range index", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "delete-todo-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/delete-todo-test/todo/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 99 }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/deck/tentacles/:id/todo/solve ───────────────────────────────

  describe("POST /api/deck/tentacles/:id/todo/solve", () => {
    const todoContent = "# Todo\n- [ ] Implement feature X\n- [x] Already done\n";

    it("spawns a solve agent and returns 201 with terminalId", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "solve-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/solve-test/todo/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 0 }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        terminalId: string;
        tentacleId: string;
        itemIndex: number;
      };
      expect(body.terminalId).toBe("solve-test-todo-0");
      expect(body.tentacleId).toBe("solve-test");
      expect(body.itemIndex).toBe(0);
    });

    it("returns 400 when attempting to solve an already-done item", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "solve-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/solve-test/todo/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 1 }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "Todo item is already complete." });
    });

    it("returns 404 when tentacle or todo.md does not exist", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles/ghost/todo/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 0 }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when itemIndex is out of range", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "solve-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/solve-test/todo/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 99 }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when itemIndex is missing", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "solve-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/solve-test/todo/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 409 when a solve agent already exists for that item", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "solve-test", todoContent);
      const { baseUrl } = await startServer(dir);

      // First solve — creates the terminal
      await fetch(`${baseUrl}/api/deck/tentacles/solve-test/todo/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 0 }),
      });

      // Second solve for same item — should conflict
      const res = await fetch(`${baseUrl}/api/deck/tentacles/solve-test/todo/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex: 0 }),
      });
      expect(res.status).toBe(409);
    });
  });

  // ── POST /api/deck/tentacles/:id/swarm ────────────────────────────────────

  describe("POST /api/deck/tentacles/:id/swarm", () => {
    const todoContent = "# Todo\n- [ ] Task one\n- [ ] Task two\n- [x] Done task\n";

    it("spawns a swarm for all incomplete items and returns 201", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "swarm-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/swarm-test/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { tentacleId: string; workers: unknown[] };
      expect(body.tentacleId).toBe("swarm-test");
      expect(body.workers).toHaveLength(2); // only incomplete items
    });

    it("filters swarm to specific todoItemIndices when provided", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "swarm-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/swarm-test/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoItemIndices: [0] }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { workers: unknown[] };
      expect(body.workers).toHaveLength(1);
    });

    it("returns 400 when no incomplete items exist", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "swarm-test", "# Todo\n- [x] All done\n");
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/swarm-test/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "No incomplete todo items found." });
    });

    it("returns 400 when requested indices are all already done", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "swarm-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/swarm-test/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoItemIndices: [2] }), // index 2 is done
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 when tentacle or todo.md does not exist", async () => {
      const { baseUrl } = await startServer();
      const res = await fetch(`${baseUrl}/api/deck/tentacles/ghost/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it("returns 409 when a swarm is already active for the tentacle", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "swarm-test", todoContent);
      const { baseUrl } = await startServer(dir);

      // First swarm
      await fetch(`${baseUrl}/api/deck/tentacles/swarm-test/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoItemIndices: [0] }),
      });

      // Second swarm — should conflict
      const res = await fetch(`${baseUrl}/api/deck/tentacles/swarm-test/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoItemIndices: [1] }),
      });
      expect(res.status).toBe(409);
    });

    it("returns 405 for GET", async () => {
      const dir = mkdtempSync(join(tmpdir(), "octogent-deck-test-"));
      temporaryDirectories.push(dir);
      makeTentacle(dir, "swarm-test", todoContent);
      const { baseUrl } = await startServer(dir);

      const res = await fetch(`${baseUrl}/api/deck/tentacles/swarm-test/swarm`);
      expect(res.status).toBe(405);
    });
  });

  describe("live deck updates", () => {
    it("tells connected operators to refresh after a tentacle is created", async () => {
      const { baseUrl } = await startServer();
      const socket = new WebSocket(`${baseUrl.replace("http://", "ws://")}/api/terminal-events/ws`);
      const events: string[] = [];
      socket.on("message", (raw) => {
        const parsed = JSON.parse(raw.toString()) as { type?: string };
        if (parsed.type) events.push(parsed.type);
      });
      await new Promise((resolve) => socket.on("open", resolve));

      // A tentacle created from the CLI has no browser round trip behind it, so
      // an open page only learns about it from this event.
      const res = await fetch(`${baseUrl}/api/deck/tentacles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "live-refresh" }),
      });
      expect(res.status).toBe(201);

      for (let attempt = 0; attempt < 100 && !events.includes("deck-changed"); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      socket.close();

      expect(events).toContain("deck-changed");
    });
  });
});
