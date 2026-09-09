import { describe, expect, it } from "vitest";

import { parseTerminalCreateArgs } from "../src/cliTerminalCreate";

const createArgs = (...rest: string[]) => ["terminal", "create", ...rest];

describe("parseTerminalCreateArgs", () => {
  it("builds a minimal body with the shared workspace default", () => {
    const result = parseTerminalCreateArgs(createArgs());
    expect(result).toEqual({ ok: true, body: { workspaceMode: "shared" } });
  });

  it("passes provided flags through to the request body", () => {
    const result = parseTerminalCreateArgs(
      createArgs(
        "--name",
        "docs",
        "--initial-prompt",
        "write docs",
        "--workspace-mode",
        "worktree",
        "--tentacle-id",
        "tentacle-1",
      ),
    );
    expect(result).toEqual({
      ok: true,
      body: {
        name: "docs",
        initialPrompt: "write docs",
        workspaceMode: "worktree",
        tentacleId: "tentacle-1",
      },
    });
  });

  it("passes a valid --agent-provider through to the request body", () => {
    for (const provider of ["claude-code", "codex"]) {
      const result = parseTerminalCreateArgs(createArgs("--agent-provider", provider));
      expect(result).toEqual({
        ok: true,
        body: { workspaceMode: "shared", agentProvider: provider },
      });
    }
  });

  it("omits agentProvider from the body when the flag is not given", () => {
    const result = parseTerminalCreateArgs(createArgs("--name", "docs"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).not.toHaveProperty("agentProvider");
    }
  });

  it("rejects an unknown --agent-provider instead of sending it to the API", () => {
    const result = parseTerminalCreateArgs(createArgs("--agent-provider", "gpt-5"));
    expect(result).toEqual({
      ok: false,
      errorKey: "cli.error.invalidAgentProvider",
      params: { value: "gpt-5", allowed: "codex, claude-code" },
    });
  });

  it("passes a valid --model through as agentModel", () => {
    const result = parseTerminalCreateArgs(createArgs("--model", "gpt-5.6-luna"));
    expect(result).toEqual({
      ok: true,
      body: { workspaceMode: "shared", agentModel: "gpt-5.6-luna" },
    });
  });

  it("passes a valid --effort through as agentEffort", () => {
    for (const effort of ["light", "standard", "heavy", "max"]) {
      const result = parseTerminalCreateArgs(createArgs("--effort", effort));
      expect(result).toEqual({
        ok: true,
        body: { workspaceMode: "shared", agentEffort: effort },
      });
    }
  });

  it("omits agentModel and agentEffort when the flags are not given", () => {
    const result = parseTerminalCreateArgs(createArgs("--name", "docs"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).not.toHaveProperty("agentModel");
      expect(result.body).not.toHaveProperty("agentEffort");
    }
  });

  it("rejects a --model with invalid characters instead of sending it to the API", () => {
    const result = parseTerminalCreateArgs(createArgs("--model", "sonnet; rm -rf /"));
    expect(result).toEqual({
      ok: false,
      errorKey: "cli.error.invalidAgentModel",
      params: { value: "sonnet; rm -rf /" },
    });
  });

  it("rejects an unknown --effort tier instead of sending it to the API", () => {
    const result = parseTerminalCreateArgs(createArgs("--effort", "extreme"));
    expect(result).toEqual({
      ok: false,
      errorKey: "cli.error.invalidAgentEffort",
      params: { value: "extreme", allowed: "light, standard, heavy, max" },
    });
  });

  it("parses --prompt-variables as a JSON object of strings", () => {
    const result = parseTerminalCreateArgs(
      createArgs("--prompt-variables", '{"ticket":"OCT-12","extra":1}'),
    );
    expect(result).toEqual({
      ok: true,
      body: { workspaceMode: "shared", promptVariables: { ticket: "OCT-12" } },
    });
  });

  it("rejects --prompt-variables that is not a JSON object", () => {
    const result = parseTerminalCreateArgs(createArgs("--prompt-variables", "[1,2]"));
    expect(result).toEqual({
      ok: false,
      errorKey: "cli.error.jsonFlag",
      params: { flag: "--prompt-variables" },
    });
  });

  it("rejects --prompt-variables that is not valid JSON", () => {
    const result = parseTerminalCreateArgs(createArgs("--prompt-variables", "{oops"));
    expect(result).toEqual({
      ok: false,
      errorKey: "cli.error.validJsonFlag",
      params: { flag: "--prompt-variables" },
    });
  });
});
