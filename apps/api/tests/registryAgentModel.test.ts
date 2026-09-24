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

describe("terminal registry attention fields", () => {
  it.each([
    {
      attentionKind: "permission",
      attentionSince: "2026-09-21T12:03:04.000Z",
      attentionToolName: "Read",
    },
    { attentionKind: "user", attentionSince: "2026-09-21T12:03:04.000Z" },
    { attentionKind: "invalid", attentionSince: "bad" },
    {},
  ])("loads valid optional attention metadata: %j", (attention) => {
    const dir = mkdtempSync(join(tmpdir(), "octogent-registry-attention-"));
    tempDirs.push(dir);
    const path = join(dir, "tentacles.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: TERMINAL_REGISTRY_VERSION,
        terminals: [
          {
            terminalId: "t",
            tentacleId: "t",
            tentacleName: "t",
            createdAt: "2026-09-21T12:00:00.000Z",
            workspaceMode: "shared",
            ...attention,
          },
        ],
      }),
    );
    const terminal = loadTerminalRegistry(path).terminals.get("t");
    if (attention.attentionKind === "permission" || attention.attentionKind === "user") {
      expect(terminal).toMatchObject(attention);
    } else {
      expect(terminal?.attentionSince).toBeUndefined();
      expect(terminal?.attentionKind).toBeUndefined();
    }
  });
});

describe("terminal registry provider error", () => {
  it.each([
    [
      {
        kind: "usage-limit",
        message: "You've hit your usage limit.",
        at: "2026-09-21T12:03:04.000Z",
      },
      true,
    ],
    [{ kind: "quota", message: "x", at: "2026-09-21T12:03:04.000Z" }, false],
    [{ kind: "auth", message: 42, at: "2026-09-21T12:03:04.000Z" }, false],
    [{ kind: "auth", message: "Please run /login", at: "bad" }, false],
    ["api-error", false],
  ])("loads %j only when well-formed", (providerError, kept) => {
    const dir = mkdtempSync(join(tmpdir(), "octogent-registry-provider-error-"));
    tempDirs.push(dir);
    const path = join(dir, "tentacles.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: TERMINAL_REGISTRY_VERSION,
        terminals: [
          {
            terminalId: "t",
            tentacleId: "t",
            tentacleName: "t",
            createdAt: "2026-09-21T12:00:00.000Z",
            workspaceMode: "shared",
            providerError,
          },
        ],
      }),
    );
    const terminal = loadTerminalRegistry(path).terminals.get("t");
    expect(terminal?.providerError).toEqual(kept ? providerError : undefined);
  });
});
