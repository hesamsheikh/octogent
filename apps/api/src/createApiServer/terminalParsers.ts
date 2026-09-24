import {
  type TentacleWorkspaceMode,
  type TerminalAgentProvider,
  type TerminalNameOrigin,
  isTerminalAgentProvider,
} from "../terminalRuntime";
import {
  type EffortTier,
  isEffortTier,
  isValidModelToken,
} from "../terminalRuntime/modelSelection";
import {
  MAX_INHERITED_ENV_NAMES,
  isInheritableEnvName,
  isValidEnvValue,
} from "../terminalRuntime/projectEnv";

const isTerminalNameOrigin = (value: unknown): value is TerminalNameOrigin =>
  value === "generated" || value === "user" || value === "prompt";

export const parseTerminalName = (payload: unknown) => {
  if (payload === null || payload === undefined) {
    return {
      provided: false,
      name: undefined as string | undefined,
      error: null as string | null,
    };
  }

  if (typeof payload !== "object") {
    return {
      provided: true,
      name: undefined as string | undefined,
      error: "Expected a JSON object body.",
    };
  }

  const rawName = (payload as Record<string, unknown>).name;
  if (rawName === undefined) {
    return {
      provided: false,
      name: undefined as string | undefined,
      error: null as string | null,
    };
  }

  if (typeof rawName !== "string") {
    return {
      provided: true,
      name: undefined as string | undefined,
      error: "Terminal name must be a string.",
    };
  }

  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return {
      provided: true,
      name: undefined as string | undefined,
      error: "Terminal name cannot be empty.",
    };
  }

  return {
    provided: true,
    name: trimmed,
    error: null as string | null,
  };
};

export const parseTerminalWorkspaceMode = (payload: unknown) => {
  if (payload === null || payload === undefined) {
    return {
      workspaceMode: "shared" as TentacleWorkspaceMode,
      error: null as string | null,
    };
  }

  if (typeof payload !== "object") {
    return {
      workspaceMode: "shared" as TentacleWorkspaceMode,
      error: "Expected a JSON object body.",
    };
  }

  const rawWorkspaceMode = (payload as Record<string, unknown>).workspaceMode;
  if (rawWorkspaceMode === undefined) {
    return {
      workspaceMode: "shared" as TentacleWorkspaceMode,
      error: null as string | null,
    };
  }

  if (rawWorkspaceMode !== "shared" && rawWorkspaceMode !== "worktree") {
    return {
      workspaceMode: "shared" as TentacleWorkspaceMode,
      error: "Terminal workspace mode must be either 'shared' or 'worktree'.",
    };
  }

  return {
    workspaceMode: rawWorkspaceMode as TentacleWorkspaceMode,
    error: null as string | null,
  };
};

export const parseTerminalAgentProvider = (payload: unknown) => {
  if (payload === null || payload === undefined) {
    return {
      agentProvider: undefined as TerminalAgentProvider | undefined,
      error: null as string | null,
    };
  }

  if (typeof payload !== "object") {
    return {
      agentProvider: undefined as TerminalAgentProvider | undefined,
      error: "Expected a JSON object body.",
    };
  }

  const rawAgentProvider = (payload as Record<string, unknown>).agentProvider;
  if (rawAgentProvider === undefined) {
    return {
      agentProvider: undefined as TerminalAgentProvider | undefined,
      error: null as string | null,
    };
  }

  if (!isTerminalAgentProvider(rawAgentProvider)) {
    return {
      agentProvider: undefined as TerminalAgentProvider | undefined,
      error: "Terminal agent provider must be either 'codex' or 'claude-code'.",
    };
  }

  return {
    agentProvider: rawAgentProvider,
    error: null as string | null,
  };
};

export const parseTerminalModelSelection = (payload: unknown) => {
  const empty = {
    agentModel: undefined as string | undefined,
    agentEffort: undefined as EffortTier | undefined,
    error: null as string | null,
  };
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return empty;
  }
  const record = payload as Record<string, unknown>;

  let agentModel: string | undefined;
  if (record.agentModel !== undefined) {
    if (!isValidModelToken(record.agentModel)) {
      return {
        ...empty,
        error: "agentModel must be a plain model identifier (letters, digits, . _ -).",
      };
    }
    agentModel = record.agentModel;
  }

  let agentEffort: EffortTier | undefined;
  if (record.agentEffort !== undefined) {
    if (!isEffortTier(record.agentEffort)) {
      return {
        ...empty,
        error: "agentEffort must be one of: light, standard, heavy, max.",
      };
    }
    agentEffort = record.agentEffort;
  }

  return { agentModel, agentEffort, error: null as string | null };
};

export const parseTerminalNameOrigin = (payload: unknown) => {
  if (payload === null || payload === undefined) {
    return {
      nameOrigin: undefined as TerminalNameOrigin | undefined,
      error: null as string | null,
    };
  }

  if (typeof payload !== "object") {
    return {
      nameOrigin: undefined as TerminalNameOrigin | undefined,
      error: "Expected a JSON object body.",
    };
  }

  const rawNameOrigin = (payload as Record<string, unknown>).nameOrigin;
  if (rawNameOrigin === undefined) {
    return {
      nameOrigin: undefined as TerminalNameOrigin | undefined,
      error: null as string | null,
    };
  }

  if (!isTerminalNameOrigin(rawNameOrigin)) {
    return {
      nameOrigin: undefined as TerminalNameOrigin | undefined,
      error: "Terminal name origin must be 'generated', 'user', or 'prompt'.",
    };
  }

  return {
    nameOrigin: rawNameOrigin,
    error: null as string | null,
  };
};

/**
 * `inheritEnv` names the variables a caller passes along from its own shell and
 * `env` carries exactly their values — the CLI reads nothing else. Both sides
 * must match so a request can never slip in variables it did not name.
 */
export const parseTerminalInheritedEnv = (payload: unknown) => {
  const none = {
    inheritedEnv: undefined as Record<string, string> | undefined,
    error: null as string | null,
  };
  const fail = (error: string) => ({ ...none, error });
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return none;
  }
  const { inheritEnv, env } = payload as Record<string, unknown>;

  if (inheritEnv === undefined) {
    return env === undefined ? none : fail("env is only accepted together with inheritEnv.");
  }
  if (!Array.isArray(inheritEnv)) {
    return fail("inheritEnv must be an array of variable names.");
  }
  if (inheritEnv.length > MAX_INHERITED_ENV_NAMES) {
    return fail(`inheritEnv accepts at most ${MAX_INHERITED_ENV_NAMES} names.`);
  }
  const invalidName = inheritEnv.find((name) => !isInheritableEnvName(name));
  if (invalidName !== undefined) {
    return fail(
      `inheritEnv name ${JSON.stringify(invalidName)} is invalid; use upper-case letters, digits, and _.`,
    );
  }
  const names = [...new Set(inheritEnv as string[])];

  if (env === undefined && names.length === 0) {
    return none;
  }
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    return fail("env must be an object with a value for each inheritEnv name.");
  }
  const values = env as Record<string, unknown>;
  const unlisted = Object.keys(values).find((key) => !names.includes(key));
  if (unlisted !== undefined) {
    return fail(`env.${unlisted} is not listed in inheritEnv.`);
  }

  const inheritedEnv: Record<string, string> = {};
  for (const name of names) {
    const value = values[name];
    if (typeof value !== "string") {
      return fail(`env.${name} must be a string: the value to pass on for inheritEnv ${name}.`);
    }
    if (!isValidEnvValue(value)) {
      return fail(`env.${name} must not contain NUL or newline characters.`);
    }
    inheritedEnv[name] = value;
  }
  return names.length === 0 ? none : { inheritedEnv, error: null as string | null };
};
