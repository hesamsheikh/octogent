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
