import { type TerminalAgentProvider, isTerminalAgentProvider } from "@octogent/core";

import { resolveBootstrapCommand } from "./bootstrapCommand";
import type { InstalledCodexHookHandler } from "./codexHookContract";
import { DEFAULT_AGENT_PROVIDER } from "./constants";

type BootstrapEnv = {
  OCTOGENT_CLAUDE_PERMISSION_MODE?: string;
  OCTOGENT_CODEX_SANDBOX_MODE?: string;
  OCTOGENT_CODEX_APPROVAL_POLICY?: string;
};

/**
 * Everything the runtime does differently per agent provider. The rest of the
 * terminal runtime (PTY lifecycle, registry, channel messaging, completion
 * detection) stays provider-agnostic and must not grow provider branches —
 * new differences belong here.
 */
export type AgentProviderAdapter = {
  readonly id: TerminalAgentProvider;
  /** Command written into a fresh PTY to start this agent unattended. */
  readonly resolveBootstrapCommand: (env?: BootstrapEnv) => string;
  /**
   * Install runtime hooks and pre-seed trust so the agent's first boot has no
   * dialogs; a stranded trust prompt would kill an unattended session.
   */
  readonly prepareWorkspace: (targetCwd: string) => void;
};

type AgentProviderAdapterDeps = {
  installClaudeHooks: (targetCwd: string) => void;
  ensureClaudeTrusted: (targetCwd: string) => void;
  installCodexHooks: (targetCwd: string) => InstalledCodexHookHandler[];
  ensureCodexTrusted: (
    targetCwd: string,
    installedHandlers: readonly InstalledCodexHookHandler[],
  ) => void;
};

export const createAgentProviderAdapters = (
  deps: AgentProviderAdapterDeps,
): Record<TerminalAgentProvider, AgentProviderAdapter> => ({
  "claude-code": {
    id: "claude-code",
    resolveBootstrapCommand: (env) => resolveBootstrapCommand("claude-code", env ?? process.env),
    prepareWorkspace: (targetCwd) => {
      deps.installClaudeHooks(targetCwd);
      deps.ensureClaudeTrusted(targetCwd);
    },
  },
  codex: {
    id: "codex",
    resolveBootstrapCommand: (env) => resolveBootstrapCommand("codex", env ?? process.env),
    prepareWorkspace: (targetCwd) => {
      const installedHandlers = deps.installCodexHooks(targetCwd);
      deps.ensureCodexTrusted(targetCwd, installedHandlers);
    },
  },
});

export const resolveAgentProviderAdapter = (
  adapters: Record<TerminalAgentProvider, AgentProviderAdapter>,
  provider: string | undefined,
): AgentProviderAdapter =>
  provider && isTerminalAgentProvider(provider)
    ? adapters[provider]
    : adapters[DEFAULT_AGENT_PROVIDER];
