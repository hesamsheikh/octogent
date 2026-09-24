import { describe, expect, it, vi } from "vitest";

import {
  createAgentProviderAdapters,
  resolveAgentProviderAdapter,
} from "../src/terminalRuntime/agentProviders";

const installedCodexHandlers = [{ eventName: "Stop", command: "octogent-command" }];

const buildDeps = () => ({
  installClaudeHooks: vi.fn(),
  ensureClaudeTrusted: vi.fn(),
  installCodexHooks: vi.fn(() => installedCodexHandlers),
  ensureCodexTrusted: vi.fn(),
});

describe("agent provider adapters", () => {
  it("prepares a Claude workspace with Claude hooks and trust", () => {
    const deps = buildDeps();
    const adapters = createAgentProviderAdapters(deps);

    adapters["claude-code"].prepareWorkspace("/tmp/ws");

    expect(deps.installClaudeHooks).toHaveBeenCalledWith("/tmp/ws");
    expect(deps.ensureClaudeTrusted).toHaveBeenCalledWith("/tmp/ws");
    expect(deps.installCodexHooks).not.toHaveBeenCalled();
  });

  it("prepares a Codex workspace with Codex hooks and trust", () => {
    const deps = buildDeps();
    const adapters = createAgentProviderAdapters(deps);

    adapters.codex.prepareWorkspace("/tmp/ws");

    expect(deps.installCodexHooks).toHaveBeenCalledWith("/tmp/ws");
    expect(deps.ensureCodexTrusted).toHaveBeenCalledWith("/tmp/ws", installedCodexHandlers);
    expect(deps.installClaudeHooks).not.toHaveBeenCalled();
  });

  it("resolves each provider to its adapter", () => {
    const adapters = createAgentProviderAdapters(buildDeps());

    expect(resolveAgentProviderAdapter(adapters, "codex").id).toBe("codex");
    expect(resolveAgentProviderAdapter(adapters, "claude-code").id).toBe("claude-code");
  });

  it("falls back to the default provider for unknown or missing values", () => {
    const adapters = createAgentProviderAdapters(buildDeps());

    expect(resolveAgentProviderAdapter(adapters, "who-knows").id).toBe("claude-code");
    expect(resolveAgentProviderAdapter(adapters, undefined).id).toBe("claude-code");
  });

  it("resolves the provider-specific bootstrap command", () => {
    const adapters = createAgentProviderAdapters(buildDeps());

    expect(adapters["claude-code"].resolveBootstrapCommand({})).toContain("claude");
    expect(adapters.codex.resolveBootstrapCommand({})).toContain("codex --sandbox");
  });
});
