import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Routes rely on the global project registry, and without this every run
// registered its throwaway fixtures into the operator's real ~/.octogent.
// Runs before the modules under test are imported, so the state root const
// they capture at load time already points here.
const globalStateRoot = mkdtempSync(join(tmpdir(), "octogent-test-home-"));
process.env.OCTOGENT_HOME = globalStateRoot;
// Worktree terminals seed Claude Code's trust list; without this a test run
// appends a permanent entry per worktree to the operator's real ~/.claude.json.
process.env.OCTOGENT_CLAUDE_CONFIG = join(globalStateRoot, "claude.json");
// Same hazard for Codex: without this, seeding worktree trust from a test run
// appends permanent entries to the operator's real ~/.codex/config.toml.
process.env.OCTOGENT_CODEX_CONFIG = join(globalStateRoot, "codex-config.toml");

afterAll(() => {
  rmSync(globalStateRoot, { force: true, recursive: true });
});
