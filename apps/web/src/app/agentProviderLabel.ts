import type { TerminalAgentProvider } from "@octogent/core";

// Product names, not translations — the same in every locale.
const AGENT_PROVIDER_LABELS: Record<TerminalAgentProvider, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

export const agentProviderLabel = (provider: TerminalAgentProvider): string =>
  AGENT_PROVIDER_LABELS[provider];

/** "Claude Code · opus" when a model is known, otherwise just the provider. */
export const agentProviderSummary = (provider: TerminalAgentProvider, model?: string): string =>
  model ? `${agentProviderLabel(provider)} · ${model}` : agentProviderLabel(provider);
