import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TERMINAL_REGISTRY_VERSION } from "../src/terminalRuntime/constants";
import { loadTerminalRegistry } from "../src/terminalRuntime/registry";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("terminal registry model fields", () => {
  it("keeps the requested and observed model across a restart", () => {
    // These were written but never read back, so every restart forgot which
    // model a terminal ran with.
    const dir = mkdtempSync(join(tmpdir(), "octogent-registry-model-"));
    tempDirs.push(dir);
    const registryPath = join(dir, "state", "tentacles.json");
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: TERMINAL_REGISTRY_VERSION,
        terminals: [
          {
            terminalId: "terminal-1",
            tentacleId: "api",
            tentacleName: "api",
            createdAt: "2026-09-05T10:00:00.000Z",
            workspaceMode: "shared",
            agentProvider: "claude-code",
            agentModel: "opus",
            agentEffortTier: "heavy",
            agentModelObserved: "claude-opus-5",
          },
        ],
      }),
      "utf8",
    );

    const { terminals } = loadTerminalRegistry(registryPath);
    expect(terminals.get("terminal-1")).toMatchObject({
      agentProvider: "claude-code",
      agentModel: "opus",
      agentEffortTier: "heavy",
      agentModelObserved: "claude-opus-5",
    });
  });
});
