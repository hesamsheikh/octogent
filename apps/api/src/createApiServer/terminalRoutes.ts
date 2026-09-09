import { join } from "node:path";
import { readDeckTentacles } from "../deck/readDeckTentacles";
import { resolvePrompt } from "../prompts";
import {
  RuntimeInputError,
  type TentacleWorkspaceMode,
  type TerminalAgentProvider,
  type TerminalNameOrigin,
} from "../terminalRuntime";
import type { EffortTier } from "../terminalRuntime/modelSelection";
import type { ApiRouteHandler } from "./routeHelpers";
import {
  readJsonBodyOrWriteError,
  writeJson,
  writeMethodNotAllowed,
  writeNoContent,
} from "./routeHelpers";
import {
  parseTerminalAgentProvider,
  parseTerminalModelSelection,
  parseTerminalName,
  parseTerminalNameOrigin,
  parseTerminalWorkspaceMode,
} from "./terminalParsers";

const buildTentacleInitialPrompt = (
  promptsDir: string,
  workspaceCwd: string,
  projectStateDir: string,
  tentacleId: string,
): Promise<string | undefined> => {
  const tentacle = readDeckTentacles(workspaceCwd, projectStateDir).find(
    (entry) => entry.tentacleId === tentacleId,
  );
  if (!tentacle) {
    return Promise.resolve(undefined);
  }

  const tentacleFolderPath = join(".octogent", "tentacles", tentacleId);
  return resolvePrompt(promptsDir, "tentacle-context-init", {
    tentacleName: tentacle.displayName,
    tentacleId,
    tentacleContextPath: tentacleFolderPath,
  });
};

export const handleTerminalSnapshotsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/terminal-snapshots") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const includeArchived = requestUrl.searchParams.get("includeArchived") === "1";
  const payload = runtime.listTerminalSnapshots({ includeArchived });
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

export const handleTerminalsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd, projectStateDir, promptsDir, userPromptsDir, getApiPort },
) => {
  if (requestUrl.pathname !== "/api/terminals") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const nameResult = parseTerminalName(bodyReadResult.payload);
  if (nameResult.error) {
    writeJson(response, 400, { error: nameResult.error }, corsOrigin);
    return true;
  }

  const workspaceModeResult = parseTerminalWorkspaceMode(bodyReadResult.payload);
  if (workspaceModeResult.error) {
    writeJson(response, 400, { error: workspaceModeResult.error }, corsOrigin);
    return true;
  }

  const agentProviderResult = parseTerminalAgentProvider(bodyReadResult.payload);
  if (agentProviderResult.error) {
    writeJson(response, 400, { error: agentProviderResult.error }, corsOrigin);
    return true;
  }

  const nameOriginResult = parseTerminalNameOrigin(bodyReadResult.payload);
  if (nameOriginResult.error) {
    writeJson(response, 400, { error: nameOriginResult.error }, corsOrigin);
    return true;
  }

  const modelSelectionResult = parseTerminalModelSelection(bodyReadResult.payload);
  if (modelSelectionResult.error) {
    writeJson(response, 400, { error: modelSelectionResult.error }, corsOrigin);
    return true;
  }

  try {
    const createTerminalInput: {
      terminalId?: string;
      tentacleId?: string;
      worktreeId?: string;
      tentacleName?: string;
      workspaceMode: TentacleWorkspaceMode;
      agentProvider?: TerminalAgentProvider;
      agentModel?: string;
      agentEffort?: EffortTier;
      nameOrigin?: TerminalNameOrigin;
      initialPrompt?: string;
      initialInputDraft?: string;
      autoRenamePromptContext?: string;
      parentTerminalId?: string;
    } = {
      workspaceMode: workspaceModeResult.workspaceMode,
    };
    if (nameResult.name !== undefined) {
      createTerminalInput.tentacleName = nameResult.name;
    }
    if (agentProviderResult.agentProvider !== undefined) {
      createTerminalInput.agentProvider = agentProviderResult.agentProvider;
    }
    if (modelSelectionResult.agentModel !== undefined) {
      createTerminalInput.agentModel = modelSelectionResult.agentModel;
    }
    if (modelSelectionResult.agentEffort !== undefined) {
      createTerminalInput.agentEffort = modelSelectionResult.agentEffort;
    }
    if (nameOriginResult.nameOrigin !== undefined) {
      createTerminalInput.nameOrigin = nameOriginResult.nameOrigin;
    }
    const bodyPayload = bodyReadResult.payload as Record<string, unknown> | null;
    if (
      bodyPayload &&
      typeof bodyPayload.terminalId === "string" &&
      bodyPayload.terminalId.trim().length > 0
    ) {
      createTerminalInput.terminalId = bodyPayload.terminalId.trim();
    }
    if (
      bodyPayload &&
      typeof bodyPayload.tentacleId === "string" &&
      bodyPayload.tentacleId.trim().length > 0
    ) {
      createTerminalInput.tentacleId = bodyPayload.tentacleId.trim();
    }
    if (
      bodyPayload &&
      typeof bodyPayload.parentTerminalId === "string" &&
      bodyPayload.parentTerminalId.trim().length > 0
    ) {
      createTerminalInput.parentTerminalId = bodyPayload.parentTerminalId.trim();
    }
    if (
      bodyPayload &&
      typeof bodyPayload.autoRenamePromptContext === "string" &&
      bodyPayload.autoRenamePromptContext.trim().length > 0
    ) {
      createTerminalInput.autoRenamePromptContext = bodyPayload.autoRenamePromptContext.trim();
    }
    if (
      bodyPayload &&
      typeof bodyPayload.worktreeId === "string" &&
      bodyPayload.worktreeId.trim().length > 0
    ) {
      createTerminalInput.worktreeId = bodyPayload.worktreeId.trim();
    }

    // Support prompt resolution via template name + variables, or a raw string.
    if (
      bodyPayload &&
      typeof bodyPayload.promptTemplate === "string" &&
      bodyPayload.promptTemplate.trim().length > 0
    ) {
      const templateName = bodyPayload.promptTemplate.trim();
      const templateVars: Record<string, string> =
        bodyPayload.promptVariables != null &&
        typeof bodyPayload.promptVariables === "object" &&
        !Array.isArray(bodyPayload.promptVariables)
          ? Object.fromEntries(
              Object.entries(bodyPayload.promptVariables as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, v as string]),
            )
          : {};

      // Auto-inject terminalId variable so callers don't have to guess it.
      // The runtime hasn't allocated the ID yet, so we use the tentacle name
      // when provided (sandbox always passes its name).
      if (!templateVars.terminalId && createTerminalInput.tentacleName) {
        templateVars.terminalId = createTerminalInput.tentacleName;
      }

      // Auto-inject apiPort so prompt templates can reference the local API.
      if (!templateVars.apiPort) {
        templateVars.apiPort = getApiPort();
      }

      // Auto-inject userPromptsDir so prompt templates know where to save user prompts.
      if (!templateVars.userPromptsDir) {
        templateVars.userPromptsDir = userPromptsDir;
      }

      // Auto-inject existingTerminals summary so planner-style prompts have context.
      if (!templateVars.existingTerminals) {
        const deckTentacles = readDeckTentacles(workspaceCwd, projectStateDir);
        if (deckTentacles.length > 0) {
          const listing = deckTentacles
            .map(
              (t) =>
                `- **${t.displayName}** (\`${t.tentacleId}\`): ${t.description || "(no description)"}`,
            )
            .join("\n");
          templateVars.existingTerminals = `## Existing Terminals\n\nThe following departments already exist:\n\n${listing}\n\nConsider these when proposing new departments — avoid duplicates and note any gaps.`;
        } else {
          templateVars.existingTerminals =
            "## Existing Terminals\n\nNo department terminals exist yet. You are starting from scratch.";
        }
      }

      const resolved = await resolvePrompt(promptsDir, templateName, templateVars);
      if (resolved !== undefined) {
        createTerminalInput.initialPrompt = resolved;
      }
    } else if (
      bodyPayload &&
      typeof bodyPayload.initialPrompt === "string" &&
      bodyPayload.initialPrompt.trim().length > 0
    ) {
      createTerminalInput.initialPrompt = bodyPayload.initialPrompt.trim();
    }

    if (!createTerminalInput.initialPrompt && createTerminalInput.tentacleId) {
      const defaultTentaclePrompt = await buildTentacleInitialPrompt(
        promptsDir,
        workspaceCwd,
        projectStateDir,
        createTerminalInput.tentacleId,
      );
      if (defaultTentaclePrompt) {
        createTerminalInput.initialInputDraft = defaultTentaclePrompt;
      }
    }

    const snapshot = runtime.createTerminal(createTerminalInput);
    const payload: Record<string, unknown> = { ...snapshot };
    if (createTerminalInput.initialPrompt) {
      payload.initialPrompt = createTerminalInput.initialPrompt;
    }
    writeJson(response, 201, payload, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 400, { error: error.message }, corsOrigin);
      return true;
    }

    throw error;
  }
};

const TERMINAL_ITEM_PATH_PATTERN = /^\/api\/terminals\/([^/]+)$/;
const TERMINAL_ACTION_PATH_PATTERN = /^\/api\/terminals\/([^/]+)\/(stop|kill|archive)$/;

export const handleTerminalItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const renameMatch = requestUrl.pathname.match(TERMINAL_ITEM_PATH_PATTERN);
  if (!renameMatch) {
    return false;
  }

  if (request.method !== "PATCH" && request.method !== "DELETE") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const terminalId = decodeURIComponent(renameMatch[1] ?? "");
  if (request.method === "DELETE") {
    try {
      // The worktree directory survives a plain delete (record only); pass
      // ?removeWorktree=true to reclaim it, which the caller does only after
      // confirming any unmerged work is expendable.
      const removeWorktree = requestUrl.searchParams.get("removeWorktree") === "true";
      runtime.deleteTerminal(terminalId, { removeWorktree });
      writeNoContent(response, 204, corsOrigin);
      return true;
    } catch (error) {
      if (error instanceof RuntimeInputError) {
        writeJson(response, 409, { error: error.message }, corsOrigin);
        return true;
      }
      throw error;
    }
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const nameResult = parseTerminalName(bodyReadResult.payload);
  if (nameResult.error) {
    writeJson(response, 400, { error: nameResult.error }, corsOrigin);
    return true;
  }

  if (!nameResult.provided || !nameResult.name) {
    writeJson(response, 400, { error: "Terminal name is required." }, corsOrigin);
    return true;
  }

  const payload = runtime.renameTerminal(terminalId, nameResult.name);
  if (!payload) {
    writeJson(response, 404, { error: "Terminal not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, payload, corsOrigin);
  return true;
};

const TERMINAL_DELETE_PREVIEW_PATTERN = /^\/api\/terminals\/([^/]+)\/delete-preview$/;

export const handleTerminalDeletePreviewRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(TERMINAL_DELETE_PREVIEW_PATTERN);
  if (!match) {
    return false;
  }
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const terminalId = decodeURIComponent(match[1] ?? "");
  const preview = runtime.previewTerminalDeletion(terminalId);
  if (!preview.exists) {
    writeJson(response, 404, { error: "Terminal not found." }, corsOrigin);
    return true;
  }
  writeJson(response, 200, preview, corsOrigin);
  return true;
};

export const handleTerminalActionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const actionMatch = requestUrl.pathname.match(TERMINAL_ACTION_PATH_PATTERN);
  if (!actionMatch) {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const terminalId = decodeURIComponent(actionMatch[1] ?? "");
  const action = actionMatch[2];
  try {
    const snapshot =
      action === "archive"
        ? runtime.archiveTerminal(terminalId)
        : action === "kill"
          ? runtime.killTerminal(terminalId)
          : runtime.stopTerminal(terminalId);
    if (!snapshot) {
      writeJson(response, 404, { error: "Terminal not found." }, corsOrigin);
      return true;
    }

    writeJson(response, 200, snapshot, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 409, { error: error.message }, corsOrigin);
      return true;
    }
    throw error;
  }
};

export const handleTerminalPruneRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/terminals/prune") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  writeJson(response, 200, { prunedTerminalIds: runtime.pruneTerminals() }, corsOrigin);
  return true;
};

export const handleWorktreeGcRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/worktrees/gc") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const dryRun = requestUrl.searchParams.get("dryRun") === "1";
  writeJson(response, 200, runtime.gcWorktrees({ dryRun }), corsOrigin);
  return true;
};

export const handleTerminalArchiveCompletedRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/terminals/archive-completed") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  writeJson(
    response,
    200,
    { archivedTerminalIds: runtime.archiveCompletedTerminals() },
    corsOrigin,
  );
  return true;
};
