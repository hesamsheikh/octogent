import { join } from "node:path";

import {
  addTodoItem,
  createDeckTentacle,
  deleteDeckTentacle,
  deleteTodoItem,
  editTodoItem,
  listDeckAvailableSkills,
  parseTodoProgress,
  readDeckTentacles,
  readDeckVaultFile,
  toggleTodoItem,
  updateDeckTentacleSuggestedSkills,
} from "../deck/readDeckTentacles";
import { resolvePrompt } from "../prompts";
import { MAX_CHILDREN_PER_PARENT, RuntimeInputError } from "../terminalRuntime";
import type { ApiRouteHandler } from "./routeHelpers";
import {
  readJsonBodyOrWriteError,
  writeJson,
  writeMethodNotAllowed,
  writeNoContent,
  writeText,
} from "./routeHelpers";
import { parseTerminalAgentProvider, parseTerminalWorkspaceMode } from "./terminalParsers";

const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const buildSingleTodoWorkerPrompt = async ({
  promptsDir,
  workspaceCwd,
  tentacleId,
  tentacleName,
  todoItemText,
  terminalId,
  apiPort,
}: {
  promptsDir: string;
  workspaceCwd: string;
  tentacleId: string;
  tentacleName: string;
  todoItemText: string;
  terminalId: string;
  apiPort: string;
}) => {
  const tentacleContextPath = join(workspaceCwd, ".octogent/tentacles", tentacleId);

  return await resolvePrompt(promptsDir, "swarm-worker", {
    tentacleName,
    tentacleId,
    tentacleContextPath,
    todoItemText,
    terminalId,
    apiPort,
    workspaceContextIntro:
      "You are working in the shared main workspace on the main branch, not in an isolated worktree.",
    workspaceGuidelines: [
      "- You must work in the main project directory. Do NOT create or use git worktrees for this task.",
      "- You are working in the shared main workspace. Keep edits narrow and focused on this one todo item.",
      "- Do NOT create commits. Leave your completed changes uncommitted in the main workspace.",
      "- Do NOT mark todo items done or rewrite tentacle context files unless this specific todo item explicitly requires it.",
    ].join("\n"),
    commitGuidance:
      "- Do NOT commit. Leave your completed changes uncommitted in the shared workspace and report what changed.",
    definitionOfDoneCommitStep:
      "Changes are left uncommitted in the shared main workspace, ready for operator review.",
    workspaceReminder: "Do not commit. Do not use worktrees.",
    parentTerminalId: "",
    parentSection: "",
  });
};

export const handleDeckTentaclesRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd, projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/deck/tentacles") return false;

  if (request.method === "GET") {
    const tentacles = readDeckTentacles(workspaceCwd, projectStateDir);
    writeJson(response, 200, tentacles, corsOrigin);
    return true;
  }

  if (request.method === "POST") {
    const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!bodyReadResult.ok) return true;

    const body = bodyReadResult.payload as Record<string, unknown> | null;
    const name = body && typeof body.name === "string" ? body.name : "";
    const description = body && typeof body.description === "string" ? body.description : "";
    const color = body && typeof body.color === "string" ? body.color : "#d4a017";
    const suggestedSkills =
      body && Array.isArray(body.suggestedSkills)
        ? body.suggestedSkills.filter((skill): skill is string => typeof skill === "string")
        : [];

    const rawOctopus =
      body && typeof body.octopus === "object" && body.octopus !== null
        ? (body.octopus as Record<string, unknown>)
        : {};
    const octopus = {
      animation: typeof rawOctopus.animation === "string" ? rawOctopus.animation : null,
      expression: typeof rawOctopus.expression === "string" ? rawOctopus.expression : null,
      accessory: typeof rawOctopus.accessory === "string" ? rawOctopus.accessory : null,
      hairColor: typeof rawOctopus.hairColor === "string" ? rawOctopus.hairColor : null,
    };

    const result = createDeckTentacle(
      workspaceCwd,
      { name, description, color, octopus, suggestedSkills },
      projectStateDir,
    );
    if (!result.ok) {
      writeJson(response, 400, { error: result.error }, corsOrigin);
      return true;
    }

    runtime.broadcastDeckChanged();
    writeJson(response, 201, result.tentacle, corsOrigin);
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

export const handleDeckSkillsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  if (requestUrl.pathname !== "/api/deck/skills") return false;

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  writeJson(response, 200, listDeckAvailableSkills(workspaceCwd), corsOrigin);
  return true;
};

const DECK_TENTACLE_ITEM_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)$/;

export const handleDeckTentacleItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd, projectStateDir },
) => {
  const match = requestUrl.pathname.match(DECK_TENTACLE_ITEM_PATTERN);
  if (!match) return false;

  if (request.method !== "DELETE") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = deleteDeckTentacle(workspaceCwd, tentacleId, projectStateDir);
  if (!result.ok) {
    writeJson(response, 404, { error: result.error }, corsOrigin);
    return true;
  }

  runtime.broadcastDeckChanged();
  writeNoContent(response, 204, corsOrigin);
  return true;
};

const DECK_VAULT_FILE_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/files\/([^/]+)$/;

export const handleDeckVaultFileRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_VAULT_FILE_PATTERN);
  if (!match) return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const fileName = decodeURIComponent(match[2] as string);

  const content = readDeckVaultFile(workspaceCwd, tentacleId, fileName);
  if (content === null) {
    writeJson(response, 404, { error: "Vault file not found" }, corsOrigin);
    return true;
  }

  writeText(response, 200, content, "text/markdown; charset=utf-8", corsOrigin);
  return true;
};

const DECK_TENTACLE_SKILLS_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/skills$/;

export const handleDeckTentacleSkillsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd, projectStateDir },
) => {
  const match = requestUrl.pathname.match(DECK_TENTACLE_SKILLS_PATTERN);
  if (!match) return false;
  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const payload = body.payload as Record<string, unknown> | null;
  const suggestedSkills = Array.isArray(payload?.suggestedSkills)
    ? payload.suggestedSkills.filter((skill): skill is string => typeof skill === "string")
    : null;

  if (suggestedSkills === null) {
    writeJson(response, 400, { error: "suggestedSkills (string[]) is required" }, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const updated = updateDeckTentacleSuggestedSkills(
    workspaceCwd,
    tentacleId,
    suggestedSkills,
    projectStateDir,
  );
  if (!updated) {
    writeJson(response, 404, { error: "Tentacle not found" }, corsOrigin);
    return true;
  }

  runtime.broadcastDeckChanged();
  writeJson(response, 200, updated, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Todo toggle
// ---------------------------------------------------------------------------

const DECK_TODO_TOGGLE_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo\/toggle$/;

export const handleDeckTodoToggleRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_TOGGLE_PATTERN);
  if (!match) return false;
  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const { itemIndex, done } = body.payload as { itemIndex: unknown; done: unknown };
  if (typeof itemIndex !== "number" || typeof done !== "boolean") {
    writeJson(
      response,
      400,
      { error: "itemIndex (number) and done (boolean) are required" },
      corsOrigin,
    );
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = toggleTodoItem(workspaceCwd, tentacleId, itemIndex, done);
  if (!result) {
    writeJson(response, 404, { error: "Todo item not found" }, corsOrigin);
    return true;
  }

  writeJson(response, 200, result, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Todo edit (rename item text)
// ---------------------------------------------------------------------------

const DECK_TODO_EDIT_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo\/edit$/;

export const handleDeckTodoEditRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_EDIT_PATTERN);
  if (!match) return false;
  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const { itemIndex, text } = body.payload as { itemIndex: unknown; text: unknown };
  if (typeof itemIndex !== "number" || typeof text !== "string" || text.trim().length === 0) {
    writeJson(
      response,
      400,
      { error: "itemIndex (number) and text (non-empty string) are required" },
      corsOrigin,
    );
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = editTodoItem(workspaceCwd, tentacleId, itemIndex, text.trim());
  if (!result) {
    writeJson(response, 404, { error: "Todo item not found" }, corsOrigin);
    return true;
  }

  writeJson(response, 200, result, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Todo add
// ---------------------------------------------------------------------------

const DECK_TODO_ADD_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo$/;

export const handleDeckTodoAddRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_ADD_PATTERN);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const { text } = body.payload as { text: unknown };
  if (typeof text !== "string" || text.trim().length === 0) {
    writeJson(response, 400, { error: "text (non-empty string) is required" }, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = addTodoItem(workspaceCwd, tentacleId, text.trim());
  if (!result) {
    writeJson(response, 404, { error: "Tentacle todo.md not found" }, corsOrigin);
    return true;
  }

  writeJson(response, 201, result, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Todo delete
// ---------------------------------------------------------------------------

const DECK_TODO_DELETE_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo\/delete$/;

export const handleDeckTodoDeleteRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { workspaceCwd },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_DELETE_PATTERN);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;

  const { itemIndex } = body.payload as { itemIndex: unknown };
  if (typeof itemIndex !== "number") {
    writeJson(response, 400, { error: "itemIndex (number) is required" }, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const result = deleteTodoItem(workspaceCwd, tentacleId, itemIndex);
  if (!result) {
    writeJson(response, 404, { error: "Todo item not found" }, corsOrigin);
    return true;
  }

  writeJson(response, 200, result, corsOrigin);
  return true;
};

// ---------------------------------------------------------------------------
// Deck — Solve a single todo item
// ---------------------------------------------------------------------------

const DECK_TODO_SOLVE_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/todo\/solve$/;

export const handleDeckTodoSolveRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd, projectStateDir, promptsDir, getApiPort },
) => {
  const match = requestUrl.pathname.match(DECK_TODO_SOLVE_PATTERN);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) return true;

  const body = (bodyReadResult.payload ?? {}) as Record<string, unknown>;
  const itemIndex = body.itemIndex;
  if (typeof itemIndex !== "number") {
    writeJson(response, 400, { error: "itemIndex (number) is required" }, corsOrigin);
    return true;
  }

  const agentProviderResult = parseTerminalAgentProvider(body);
  if (agentProviderResult.error) {
    writeJson(response, 400, { error: agentProviderResult.error }, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);
  const todoContent = readDeckVaultFile(workspaceCwd, tentacleId, "todo.md");
  if (todoContent === null) {
    writeJson(response, 404, { error: "Tentacle or todo.md not found." }, corsOrigin);
    return true;
  }

  const todoResult = parseTodoProgress(todoContent);
  const todoItem = todoResult.items[itemIndex] ?? null;
  if (!todoItem) {
    writeJson(response, 404, { error: "Todo item not found." }, corsOrigin);
    return true;
  }
  if (todoItem.done) {
    writeJson(response, 400, { error: "Todo item is already complete." }, corsOrigin);
    return true;
  }

  const terminalId = `${tentacleId}-todo-${itemIndex}`;
  const existingTerminal = runtime
    .listTerminalSnapshots()
    .find((terminal) => terminal.terminalId === terminalId);
  if (existingTerminal) {
    writeJson(
      response,
      409,
      { error: "A solve agent is already active for this todo item.", terminalId },
      corsOrigin,
    );
    return true;
  }

  const deckTentacles = readDeckTentacles(workspaceCwd, projectStateDir);
  const deckEntry = deckTentacles.find((tentacle) => tentacle.tentacleId === tentacleId);
  const tentacleName = deckEntry?.displayName ?? tentacleId;

  try {
    const workerPrompt = await buildSingleTodoWorkerPrompt({
      promptsDir,
      workspaceCwd,
      tentacleId,
      tentacleName,
      todoItemText: todoItem.text,
      terminalId,
      apiPort: getApiPort(),
    });

    const snapshot = runtime.createTerminal({
      terminalId,
      tentacleId,
      tentacleName,
      nameOrigin: "generated",
      autoRenamePromptContext: todoItem.text,
      workspaceMode: "shared",
      ...(agentProviderResult.agentProvider
        ? { agentProvider: agentProviderResult.agentProvider }
        : {}),
      ...(workerPrompt ? { initialPrompt: workerPrompt } : {}),
    });

    writeJson(
      response,
      201,
      {
        terminalId: snapshot.terminalId,
        tentacleId,
        itemIndex,
        workspaceMode: "shared",
      },
      corsOrigin,
    );
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 400, { error: error.message }, corsOrigin);
      return true;
    }

    throw error;
  }
};

// ---------------------------------------------------------------------------
// Deck — Swarm
// ---------------------------------------------------------------------------

const DECK_TENTACLE_SWARM_PATTERN = /^\/api\/deck\/tentacles\/([^/]+)\/swarm$/;

export const handleDeckTentacleSwarmRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, workspaceCwd, projectStateDir, promptsDir, getApiPort },
) => {
  const match = requestUrl.pathname.match(DECK_TENTACLE_SWARM_PATTERN);
  if (!match) return false;

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const tentacleId = decodeURIComponent(match[1] as string);

  // Read and parse the tentacle's todo.md.
  const todoContent = readDeckVaultFile(workspaceCwd, tentacleId, "todo.md");
  if (todoContent === null) {
    writeJson(response, 404, { error: "Tentacle or todo.md not found." }, corsOrigin);
    return true;
  }

  const todoResult = parseTodoProgress(todoContent);
  const incompleteItems = todoResult.items
    .map((item, index) => ({ ...item, index }))
    .filter((item) => !item.done);

  if (incompleteItems.length === 0) {
    writeJson(response, 400, { error: "No incomplete todo items found." }, corsOrigin);
    return true;
  }

  // Parse optional request body for item filtering and agent provider.
  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) return true;
  const body = (bodyReadResult.payload ?? {}) as Record<string, unknown>;

  const agentProviderResult = parseTerminalAgentProvider(body);
  if (agentProviderResult.error) {
    writeJson(response, 400, { error: agentProviderResult.error }, corsOrigin);
    return true;
  }

  const workspaceModeResult = parseTerminalWorkspaceMode(body);
  if (workspaceModeResult.error) {
    writeJson(response, 400, { error: workspaceModeResult.error }, corsOrigin);
    return true;
  }
  const workerWorkspaceMode =
    body.workspaceMode === undefined ? "worktree" : workspaceModeResult.workspaceMode;

  // Filter to specific item indices if requested.
  let targetItems = incompleteItems;
  if (Array.isArray(body.todoItemIndices)) {
    const requestedIndices = new Set(
      (body.todoItemIndices as unknown[]).filter((v): v is number => typeof v === "number"),
    );
    targetItems = incompleteItems.filter((item) => requestedIndices.has(item.index));
    if (targetItems.length === 0) {
      writeJson(
        response,
        400,
        { error: "None of the requested todo item indices are incomplete." },
        corsOrigin,
      );
      return true;
    }
  }

  if (targetItems.length > MAX_CHILDREN_PER_PARENT) {
    // Todo order is priority order, so overflow items are deferred automatically.
    targetItems = targetItems.slice(0, MAX_CHILDREN_PER_PARENT);
  }

  // Check for existing swarm terminals to prevent duplicates.
  const existingTerminals = runtime.listTerminalSnapshots();
  const existingSwarmIds = existingTerminals
    .filter((t) => t.terminalId.startsWith(`${tentacleId}-swarm-`))
    .map((t) => t.terminalId);
  if (existingSwarmIds.length > 0) {
    writeJson(
      response,
      409,
      { error: "A swarm is already active for this tentacle.", existingSwarmIds },
      corsOrigin,
    );
    return true;
  }

  // Determine base ref: use tentacle's worktree branch if it exists, otherwise HEAD.
  const tentacleTerminal = existingTerminals.find(
    (t) => t.tentacleId === tentacleId && t.workspaceMode === "worktree",
  );
  const baseRef = tentacleTerminal ? `octogent/${tentacleId}` : "HEAD";

  // Resolve the tentacle display name for prompts.
  const deckTentacles = readDeckTentacles(workspaceCwd, projectStateDir);
  const deckEntry = deckTentacles.find((t) => t.tentacleId === tentacleId);
  const tentacleName = deckEntry?.displayName ?? tentacleId;

  const apiPort = getApiPort();
  const needsParent = targetItems.length > 1;
  const parentTerminalId = needsParent ? `${tentacleId}-swarm-parent` : null;
  const tentacleContextPath = join(workspaceCwd, ".octogent/tentacles", tentacleId);
  const workers = targetItems.map((item) => ({
    terminalId: `${tentacleId}-swarm-${item.index}`,
    todoIndex: item.index,
    todoText: item.text,
  }));

  const buildWorkerContextIntro = (): string =>
    workerWorkspaceMode === "worktree"
      ? "You are working on an isolated worktree branch, not the main branch."
      : "You are working in the shared main workspace on the main branch, not in an isolated worktree.";

  const buildWorkerGuidelines = (terminalId: string): string =>
    workerWorkspaceMode === "worktree"
      ? `- You are working in an isolated git worktree on branch \`octogent/${terminalId}\`. Make changes freely without worrying about conflicts with other agents.`
      : [
          "- You are working in the shared main workspace. Other workers may touch the same files, so keep your edits narrow, avoid broad refactors, and coordinate via your parent if you hit overlap.",
          "- Do NOT create commits in shared mode. Leave your changes uncommitted for the coordinator to review and commit later.",
          "- Do NOT mark todo items done or rewrite tentacle context files unless your assigned todo item explicitly requires it. The coordinator handles the final tentacle-level sync.",
        ].join("\n");

  const buildWorkerCommitGuidance = (): string =>
    workerWorkspaceMode === "worktree"
      ? "- Commit your changes with a clear commit message describing what you did."
      : "- Do NOT commit in shared mode. Leave your completed changes uncommitted and report DONE with a short summary of what changed.";

  const buildWorkerDefinitionOfDoneCommitStep = (): string =>
    workerWorkspaceMode === "worktree"
      ? "Changes are committed with a descriptive message."
      : "Changes are left uncommitted in the shared workspace, ready for coordinator review.";

  const buildWorkerReminder = (): string =>
    workerWorkspaceMode === "worktree" ? "Commit." : "Do not commit in shared mode.";

  const buildWorkerWorkspaceSection = (): string =>
    workerWorkspaceMode === "worktree"
      ? [
          "Each worker commits to its own isolated branch:",
          "",
          ...workers.map(
            (w) => `- \`octogent/${w.terminalId}\` — item #${w.todoIndex}: ${w.todoText}`,
          ),
        ].join("\n")
      : [
          "Workers are running in the shared main workspace, not in separate worktrees.",
          "",
          "There are no per-worker branches for this swarm. Supervise them carefully to avoid overlapping edits in the same files.",
        ].join("\n");

  const buildCompletionStrategySection = (baseBranch: string): string =>
    workerWorkspaceMode === "worktree"
      ? [
          `Only begin merging after ALL ${workers.length} workers have reported DONE.`,
          "",
          "### Step-by-step merge process",
          "",
          `1. **Create an integration branch** from \`${baseBranch}\`. First check if a stale integration branch exists from a previous swarm attempt — if so, delete it before proceeding:`,
          "   ```bash",
          `   git branch -D octogent_integration_${tentacleId} 2>/dev/null || true`,
          `   git checkout ${baseBranch}`,
          `   git checkout -b octogent_integration_${tentacleId}`,
          "   ```",
          "",
          "2. **Merge each worker branch** into the integration branch one at a time. Start with the branch most likely to merge cleanly (fewest changes):",
          "   ```bash",
          "   git merge <worker-branch-name> --no-edit",
          "   ```",
          "   If there are conflicts, resolve them carefully. Read the conflicting files and understand both sides before choosing.",
          "",
          "3. **Run tests** on the integration branch after all merges. Do not skip this step.",
          "",
          "4. **If tests pass**, merge the integration branch into the base branch:",
          "   ```bash",
          `   git checkout ${baseBranch}`,
          `   git merge octogent_integration_${tentacleId} --no-edit`,
          "   ```",
          "",
          "5. **If tests fail**, investigate and fix before merging. Do not merge broken code.",
          "",
          `6. **Update tentacle state/docs** before finalizing. Mark completed items as done in \`.octogent/tentacles/${tentacleId}/todo.md\`, and update \`.octogent/tentacles/${tentacleId}/CONTEXT.md\` or other tentacle markdown files if the merged work changed the reality they describe.`,
          "",
          "7. **Clean up** the integration branch:",
          "   ```bash",
          `   git branch -d octogent_integration_${tentacleId}`,
          "   ```",
          "",
          "### Merge failure recovery",
          "",
          "If a worker's branch has conflicts that are too complex to resolve, send a message to that worker asking them to rebase their work. Merge the other workers' branches first.",
        ].join("\n")
      : [
          `Only begin final verification after ALL ${workers.length} workers have reported DONE.`,
          "",
          "Workers are sharing the main workspace, so there are no per-worker branches to merge.",
          "",
          "### Step-by-step completion process",
          "",
          `1. **Verify the workspace is on \`${baseBranch}\`** and review the overall diff carefully. Do not assume the combined result is safe just because workers reported DONE.`,
          "",
          "2. **Review the changed files** to ensure workers did not overwrite each other or leave partial edits.",
          "",
          "3. **Run tests** on the shared workspace after all workers report DONE. Do not skip this step.",
          "",
          "4. **If tests fail**, investigate and coordinate fixes. Do not declare the swarm complete while the workspace is broken.",
          "",
          `5. **Update tentacle state/docs** before asking for approval. Mark completed items as done in \`.octogent/tentacles/${tentacleId}/todo.md\`, and update \`.octogent/tentacles/${tentacleId}/CONTEXT.md\` or other tentacle markdown files if the completed work changed the reality they describe. If no tentacle docs need updates, say that explicitly.`,
          "",
          "6. **Wait for explicit user approval** before creating any commit on the shared main branch. Present a concise summary of the reviewed diff, test results, and tentacle-doc updates first.",
          "",
          "7. **Only after approval, create one final commit** on the shared branch that captures the swarm's completed work.",
          "",
          "8. **Report completion** only after the shared workspace is reviewed, tests pass, tentacle docs are synced, approval is granted, and the final commit is created.",
          "",
          "### Shared-workspace failure recovery",
          "",
          "If two workers collide in the same files, stop them from making broad new edits, inspect the current diff, and coordinate targeted follow-up changes instead of pretending there is a clean merge boundary.",
        ].join("\n");

  try {
    if (!needsParent) {
      const [item] = targetItems;
      const [worker] = workers;
      if (!item || !worker) {
        writeJson(response, 400, { error: "No incomplete todo items found." }, corsOrigin);
        return true;
      }

      const workerPrompt = await resolvePrompt(promptsDir, "swarm-worker", {
        tentacleName,
        tentacleId,
        tentacleContextPath,
        todoItemText: item.text,
        terminalId: worker.terminalId,
        apiPort,
        workspaceContextIntro: buildWorkerContextIntro(),
        workspaceGuidelines: buildWorkerGuidelines(worker.terminalId),
        commitGuidance: buildWorkerCommitGuidance(),
        definitionOfDoneCommitStep: buildWorkerDefinitionOfDoneCommitStep(),
        workspaceReminder: buildWorkerReminder(),
        parentTerminalId: "",
        parentSection: "",
      });

      runtime.createTerminal({
        terminalId: worker.terminalId,
        tentacleId,
        ...(workerWorkspaceMode === "worktree" ? { worktreeId: worker.terminalId } : {}),
        tentacleName,
        nameOrigin: "generated",
        autoRenamePromptContext: item.text,
        workspaceMode: workerWorkspaceMode,
        ...(agentProviderResult.agentProvider
          ? { agentProvider: agentProviderResult.agentProvider }
          : {}),
        ...(workerPrompt ? { initialPrompt: workerPrompt } : {}),
        ...(workerWorkspaceMode === "worktree" ? { baseRef } : {}),
      });
    }

    if (needsParent && parentTerminalId) {
      const workerListing = workers
        .map((w) => `- \`${w.terminalId}\` — item #${w.todoIndex}: ${w.todoText}`)
        .join("\n");

      const workerSpawnCommands = targetItems
        .map((item) => {
          const workerTerminalId = `${tentacleId}-swarm-${item.index}`;
          const parentSection = [
            "## Communication",
            "",
            `Your parent coordinator is at terminal \`${parentTerminalId}\`.`,
            "When you complete your task, report back:",
            "```bash",
            `node bin/octogent channel send ${parentTerminalId} "DONE: ${item.text}" --from ${workerTerminalId}`,
            "```",
            "If you are blocked, ask for help:",
            "```bash",
            `node bin/octogent channel send ${parentTerminalId} "BLOCKED: <describe what you need>" --from ${workerTerminalId}`,
            "```",
          ].join("\n");

          const promptVariables = JSON.stringify({
            tentacleName,
            tentacleId,
            tentacleContextPath,
            todoItemText: item.text,
            terminalId: workerTerminalId,
            apiPort,
            workspaceContextIntro: buildWorkerContextIntro(),
            workspaceGuidelines: buildWorkerGuidelines(workerTerminalId),
            commitGuidance: buildWorkerCommitGuidance(),
            definitionOfDoneCommitStep: buildWorkerDefinitionOfDoneCommitStep(),
            workspaceReminder: buildWorkerReminder(),
            parentTerminalId,
            parentSection,
          });

          const commandParts = [
            "node bin/octogent terminal create",
            `--terminal-id ${shellSingleQuote(workerTerminalId)}`,
            `--tentacle-id ${shellSingleQuote(tentacleId)}`,
            `--parent-terminal-id ${shellSingleQuote(parentTerminalId)}`,
            `--workspace-mode ${workerWorkspaceMode}`,
            `--name ${shellSingleQuote(tentacleName)}`,
            "--name-origin generated",
            `--auto-rename-prompt-context ${shellSingleQuote(item.text)}`,
            "--prompt-template swarm-worker",
            `--prompt-variables ${shellSingleQuote(promptVariables)}`,
          ];
          if (workerWorkspaceMode === "worktree") {
            commandParts.splice(3, 0, `--worktree-id ${shellSingleQuote(workerTerminalId)}`);
          }
          const command = commandParts.join(" ");

          return `- \`${workerTerminalId}\`:\n  \`\`\`bash\n  ${command}\n  \`\`\``;
        })
        .join("\n");

      const parentBaseBranch =
        workerWorkspaceMode === "worktree" ? (baseRef === "HEAD" ? "main" : baseRef) : "main";

      const parentPrompt = await resolvePrompt(promptsDir, "swarm-parent", {
        tentacleName,
        tentacleId,
        workerCount: String(workers.length),
        maxChildrenPerParent: String(MAX_CHILDREN_PER_PARENT),
        workerListing,
        workerWorkspaceSection: buildWorkerWorkspaceSection(),
        workerSpawnCommands,
        completionStrategySection: buildCompletionStrategySection(parentBaseBranch),
        baseBranch: parentBaseBranch,
        terminalId: parentTerminalId,
        apiPort,
      });

      runtime.createTerminal({
        terminalId: parentTerminalId,
        tentacleId,
        tentacleName: `${tentacleName} (coordinator)`,
        workspaceMode: "shared",
        ...(agentProviderResult.agentProvider
          ? { agentProvider: agentProviderResult.agentProvider }
          : {}),
        ...(parentPrompt ? { initialPrompt: parentPrompt } : {}),
      });
    }
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 400, { error: error.message }, corsOrigin);
      return true;
    }
    throw error;
  }

  writeJson(response, 201, { tentacleId, parentTerminalId, workers }, corsOrigin);
  return true;
};
