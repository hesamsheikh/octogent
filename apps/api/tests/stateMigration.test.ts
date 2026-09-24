import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureProjectScaffold,
  migrateStateToGlobal,
  resolveEphemeralProjectStateDir,
  resolveProjectStateDir,
} from "../src/projectPersistence";

const workspaces: string[] = [];

const makeWorkspace = () => {
  const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-migration-"));
  workspaces.push(workspaceCwd);
  return workspaceCwd;
};

const writeState = (stateDir: string, file: string, contents: string) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, file), contents, "utf-8");
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { force: true, recursive: true });
  }
});

describe("migrateStateToGlobal", () => {
  it("adopts state written before the project was initialized", () => {
    const workspaceCwd = makeWorkspace();

    // A dashboard started in an uninitialized directory parks its state in the
    // path-derived ephemeral root; `octogent init` then mints a UUID project.
    const ephemeralStateDir = join(resolveEphemeralProjectStateDir(workspaceCwd), "state");
    writeState(ephemeralStateDir, "tentacles.json", '{"version":3,"terminals":["pre-init"]}');

    ensureProjectScaffold(workspaceCwd, "migration-demo");
    const projectStateDir = resolveProjectStateDir(workspaceCwd, "migration-demo");
    migrateStateToGlobal(workspaceCwd, projectStateDir);

    const migrated = join(projectStateDir, "state", "tentacles.json");
    expect(existsSync(migrated)).toBe(true);
    expect(readFileSync(migrated, "utf-8")).toContain("pre-init");
  });

  it("carries transcripts across from the ephemeral root", () => {
    const workspaceCwd = makeWorkspace();

    const ephemeralStateDir = join(resolveEphemeralProjectStateDir(workspaceCwd), "state");
    writeState(join(ephemeralStateDir, "transcripts"), "terminal-1.jsonl", '{"line":1}\n');

    ensureProjectScaffold(workspaceCwd, "migration-transcripts");
    const projectStateDir = resolveProjectStateDir(workspaceCwd, "migration-transcripts");
    migrateStateToGlobal(workspaceCwd, projectStateDir);

    expect(existsSync(join(projectStateDir, "state", "transcripts", "terminal-1.jsonl"))).toBe(
      true,
    );
  });

  it("prefers local state over the ephemeral copy", () => {
    const workspaceCwd = makeWorkspace();

    writeState(
      join(workspaceCwd, ".octogent", "state"),
      "tentacles.json",
      '{"version":3,"terminals":["local"]}',
    );
    writeState(
      join(resolveEphemeralProjectStateDir(workspaceCwd), "state"),
      "tentacles.json",
      '{"version":3,"terminals":["ephemeral"]}',
    );

    ensureProjectScaffold(workspaceCwd, "migration-precedence");
    const projectStateDir = resolveProjectStateDir(workspaceCwd, "migration-precedence");
    migrateStateToGlobal(workspaceCwd, projectStateDir);

    expect(readFileSync(join(projectStateDir, "state", "tentacles.json"), "utf-8")).toContain(
      "local",
    );
  });

  it("never copies the ephemeral root onto itself before init", () => {
    const workspaceCwd = makeWorkspace();

    const ephemeralProjectDir = resolveEphemeralProjectStateDir(workspaceCwd);
    writeState(join(ephemeralProjectDir, "state"), "tentacles.json", '{"version":3}');

    expect(() => migrateStateToGlobal(workspaceCwd, ephemeralProjectDir)).not.toThrow();
    expect(readFileSync(join(ephemeralProjectDir, "state", "tentacles.json"), "utf-8")).toBe(
      '{"version":3}',
    );
  });
});
