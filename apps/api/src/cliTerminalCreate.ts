import { type Locale, TERMINAL_AGENT_PROVIDERS, isTerminalAgentProvider, t } from "@octogent/core";

import type { EffortTier } from "./terminalRuntime/modelSelection";
import { isEffortTier, isValidModelToken } from "./terminalRuntime/modelSelection";
import { MAX_INHERITED_ENV_NAMES, isInheritableEnvName } from "./terminalRuntime/projectEnv";

// modelSelection keeps its tier list private; this mirror only feeds the error
// message, and the EffortTier annotation keeps it from drifting to bad values.
const EFFORT_TIERS: readonly EffortTier[] = ["light", "standard", "heavy", "max"];

export type TerminalCreateParseResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; errorKey: string; params: Record<string, string> };

const parseFlag = (args: string[], ...flags: string[]): string | undefined => {
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index !== -1 && index + 1 < args.length) {
      return args[index + 1];
    }
  }
  return undefined;
};

const parseJsonFlag = (
  args: string[],
  flag: string,
): { value?: Record<string, string> } | { error: TerminalCreateParseResult & { ok: false } } => {
  const raw = parseFlag(args, flag);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: { ok: false, errorKey: "cli.error.jsonFlag", params: { flag } } };
    }

    const entries = Object.entries(parsed).filter(([, value]) => typeof value === "string");
    return { value: Object.fromEntries(entries) as Record<string, string> };
  } catch {
    return { error: { ok: false, errorKey: "cli.error.validJsonFlag", params: { flag } } };
  }
};

type InheritEnvResult =
  | { names: string[]; env: Record<string, string> }
  | { error: TerminalCreateParseResult & { ok: false } };

// Workers no longer see the environment of the shell that started the server;
// this is how a caller hands its own variables (a venv's PATH, a token) to one
// worker. Only the named variables ever leave this process.
const parseInheritEnvFlag = (
  args: string[],
  callerEnv: NodeJS.ProcessEnv,
): InheritEnvResult | undefined => {
  const raw = parseFlag(args, "--inherit-env");
  if (raw === undefined) {
    return undefined;
  }

  const names = [
    ...new Set(
      raw
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ),
  ];
  if (names.length === 0 || !names.every(isInheritableEnvName)) {
    return {
      error: { ok: false, errorKey: "cli.error.invalidInheritEnv", params: { value: raw } },
    };
  }
  if (names.length > MAX_INHERITED_ENV_NAMES) {
    return {
      error: {
        ok: false,
        errorKey: "cli.error.tooManyInheritEnv",
        params: { max: String(MAX_INHERITED_ENV_NAMES) },
      },
    };
  }

  const env: Record<string, string> = {};
  for (const name of names) {
    const value = callerEnv[name];
    if (value === undefined) {
      return { error: { ok: false, errorKey: "cli.error.inheritEnvUnset", params: { name } } };
    }
    env[name] = value;
  }
  return { names, env };
};

export const parseTerminalCreateArgs = (
  args: string[],
  callerEnv: NodeJS.ProcessEnv = process.env,
): TerminalCreateParseResult => {
  const name = parseFlag(args, "--name", "-n");
  const initialPrompt = parseFlag(args, "--initial-prompt", "-p");
  const workspaceMode = parseFlag(args, "--workspace-mode", "-w") ?? "shared";
  const terminalId = parseFlag(args, "--terminal-id");
  const tentacleId = parseFlag(args, "--tentacle-id");
  const worktreeId = parseFlag(args, "--worktree-id");
  const parentTerminalId = parseFlag(args, "--parent-terminal-id");
  const nameOrigin = parseFlag(args, "--name-origin");
  const autoRenamePromptContext = parseFlag(args, "--auto-rename-prompt-context");
  const promptTemplate = parseFlag(args, "--prompt-template");
  const agentProvider = parseFlag(args, "--agent-provider");
  const agentModel = parseFlag(args, "--model");
  const agentEffort = parseFlag(args, "--effort");

  // Reject unknown providers locally so a typo fails fast instead of round-tripping a 400.
  if (agentProvider !== undefined && !isTerminalAgentProvider(agentProvider)) {
    return {
      ok: false,
      errorKey: "cli.error.invalidAgentProvider",
      params: { value: agentProvider, allowed: TERMINAL_AGENT_PROVIDERS.join(", ") },
    };
  }

  if (agentModel !== undefined && !isValidModelToken(agentModel)) {
    return {
      ok: false,
      errorKey: "cli.error.invalidAgentModel",
      params: { value: agentModel },
    };
  }

  if (agentEffort !== undefined && !isEffortTier(agentEffort)) {
    return {
      ok: false,
      errorKey: "cli.error.invalidAgentEffort",
      params: { value: agentEffort, allowed: EFFORT_TIERS.join(", ") },
    };
  }

  const promptVariablesResult = parseJsonFlag(args, "--prompt-variables");
  if ("error" in promptVariablesResult) {
    return promptVariablesResult.error;
  }
  const promptVariables = promptVariablesResult.value;

  const inheritEnvResult = parseInheritEnvFlag(args, callerEnv);
  if (inheritEnvResult && "error" in inheritEnvResult) {
    return inheritEnvResult.error;
  }

  const body: Record<string, unknown> = {};
  if (name) body.name = name;
  if (initialPrompt) body.initialPrompt = initialPrompt;
  if (workspaceMode) body.workspaceMode = workspaceMode;
  if (terminalId) body.terminalId = terminalId;
  if (tentacleId) body.tentacleId = tentacleId;
  if (worktreeId) body.worktreeId = worktreeId;
  if (parentTerminalId) body.parentTerminalId = parentTerminalId;
  if (nameOrigin) body.nameOrigin = nameOrigin;
  if (autoRenamePromptContext) body.autoRenamePromptContext = autoRenamePromptContext;
  if (promptTemplate) body.promptTemplate = promptTemplate;
  if (promptVariables) body.promptVariables = promptVariables;
  if (agentProvider) body.agentProvider = agentProvider;
  if (agentModel) body.agentModel = agentModel;
  if (agentEffort) body.agentEffort = agentEffort;
  if (inheritEnvResult) {
    body.inheritEnv = inheritEnvResult.names;
    body.env = inheritEnvResult.env;
  }

  return { ok: true, body };
};

/**
 * The create response's quota warning as one line, or null without one. The
 * server only sets it from usage it had already fetched, so its absence means
 * "not known to be exhausted", not "fine".
 */
export const formatUsageWarning = (
  response: Record<string, unknown>,
  locale: Locale,
): string | null => {
  const warning = response.usageWarning as Record<string, unknown> | undefined;
  if (
    !warning ||
    typeof warning !== "object" ||
    typeof warning.provider !== "string" ||
    typeof warning.bucket !== "string"
  ) {
    return null;
  }
  const reset =
    typeof warning.resetAt === "string"
      ? t(locale, "cli.created.usageExhaustedReset", { time: warning.resetAt })
      : "";
  return t(locale, "cli.created.usageExhausted", {
    provider: warning.provider,
    bucket: warning.bucket,
    reset,
  });
};
