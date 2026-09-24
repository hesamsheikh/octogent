import { cpSync, existsSync as fsExistsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { scanClaudeUsageChart } from "./claudeSessionScanner";
import {
  type ClaudeUsageSnapshot,
  invalidateUsageCache as invalidateUsageCacheDefault,
  readClaudeCliUsageSnapshot as readClaudeCliUsageSnapshotDefault,
  readClaudeOauthUsageSnapshot as readClaudeOauthUsageSnapshotDefault,
  readClaudeUsageSnapshot as readClaudeUsageSnapshotDefault,
} from "./claudeUsage";
import { createCodeIntelStore } from "./codeIntelStore";
import { readCodexUsageSnapshot as readCodexUsageSnapshotDefault } from "./codexUsage";
import {
  type ApiRouteDispatcher,
  createApiRouteDispatcher,
} from "./createApiServer/requestHandler";
import type { CreateApiServerOptions } from "./createApiServer/types";
import {
  type UpgradeDispatcher,
  createRuntimeUpgradeDispatcher,
} from "./createApiServer/upgradeHandler";
import { readGithubRepoSummary as readGithubRepoSummaryDefault } from "./githubRepoSummary";
import { createHealthSnapshotSource } from "./healthSnapshot";
import { runWithLogPrefix } from "./logging";
import { createMonitorService } from "./monitor";
import { deriveProjectIdFromWorkspace, loadProjectConfig } from "./projectPersistence";
import { createTerminalRuntime } from "./terminalRuntime";
import { type CachedUsageSnapshots, rememberUsageSnapshot } from "./usageExhaustion";

export type CreateProjectContextOptions = Omit<
  CreateApiServerOptions,
  "apiBaseUrl" | "accessToken"
> & {
  /**
   * Where this project's agents reach the API — the base its hooks, PTY env,
   * and prompts are built from. A getter because a server only learns its
   * port once it listens.
   */
  apiBaseUrl: string | (() => string);
  /** Feeds CORS decisions; the Host/Origin/token checks run before dispatch. */
  isRemoteBinding: () => boolean;
  /**
   * Registry id. When given it is also exported to sessions as
   * OCTOGENT_PROJECT_ID; a single-project server leaves it out so its PTY
   * environment stays as it always was.
   */
  projectId?: string | undefined;
  projectName?: string | undefined;
  /** Per-project PTY session limit; unset defers to OCTOGENT_MAX_TERMINAL_SESSIONS. */
  maxConcurrentSessions?: number | undefined;
  /** A cap shared beyond this project (the hub's), checked before each new session. */
  checkSessionAdmission?: (() => string | null) | undefined;
  /** Tags every log line the project emits, so one shared hub log stays attributable. */
  logPrefix?: string | undefined;
};

export type ProjectContextSummary = {
  id: string;
  name: string;
  path: string;
  ptySessions: number;
  runningTerminals: number;
  awaitingReviewTerminals: number;
  lastActivityAt: string | null;
};

/**
 * Everything one workspace needs to be served: its terminal runtime, monitor,
 * code-intel store, prompts, usage cache, health source, and route dispatch.
 * A single-project server mounts one of these at the root; the hub keeps one
 * per loaded project under `/api/p/<key>`.
 */
export const createProjectContext = (options: CreateProjectContextOptions) =>
  options.logPrefix
    ? runWithLogPrefix(options.logPrefix, () => buildProjectContext(options))
    : buildProjectContext(options);

const buildProjectContext = ({
  workspaceCwd,
  projectStateDir,
  promptsDir,
  webDistDir,
  apiBaseUrl,
  isRemoteBinding,
  projectId,
  projectName,
  maxConcurrentSessions,
  checkSessionAdmission,
  logPrefix,
  gitClient,
  readClaudeUsageSnapshot,
  readClaudeOauthUsageSnapshot,
  readClaudeCliUsageSnapshot,
  readCodexUsageSnapshot = readCodexUsageSnapshotDefault,
  readGithubRepoSummary,
  scanUsageHeatmap,
  monitorService,
  invalidateClaudeUsageCache = invalidateUsageCacheDefault,
}: CreateProjectContextOptions) => {
  const resolvedWorkspaceCwd = workspaceCwd ?? process.cwd();
  // State lives in ~/.octogent/projects/<name>/ when provided, else falls back to <project>/.octogent/
  const resolvedStateDir = projectStateDir ?? join(resolvedWorkspaceCwd, ".octogent");
  const getApiBaseUrl = typeof apiBaseUrl === "function" ? apiBaseUrl : () => apiBaseUrl;
  const getApiPort = () => {
    try {
      return String(new URL(getApiBaseUrl()).port || 80);
    } catch {
      return "8787";
    }
  };
  const projectConfig = projectId && projectName ? null : loadProjectConfig(resolvedWorkspaceCwd);
  const resolvedProjectId =
    projectId ?? projectConfig?.projectId ?? deriveProjectIdFromWorkspace(resolvedWorkspaceCwd);
  const resolvedProjectName =
    projectName ?? projectConfig?.displayName ?? (basename(resolvedWorkspaceCwd) || "project");
  const resolvedUserPromptsDir = join(resolvedStateDir, "prompts");
  const resolvedCorePromptsDir = join(resolvedStateDir, "prompts", "core");

  // Sync builtin prompts into the project state dir on every start so prompt
  // changes in the repo take effect without requiring manual cache cleanup.
  const sourceDir = promptsDir ?? join(resolvedWorkspaceCwd, "prompts");
  if (fsExistsSync(sourceDir)) {
    mkdirSync(resolvedCorePromptsDir, { recursive: true });
    for (const file of readdirSync(sourceDir)) {
      if (file.endsWith(".md")) {
        cpSync(join(sourceDir, file), join(resolvedCorePromptsDir, file));
      }
    }
  }

  // Read builtin prompts from the live source directory when available so new
  // prompt files and prompt edits take effect without restarting the API.
  // Keep the mirrored state copy as a fallback for packaged/runtime setups
  // where the source prompts directory is unavailable.
  const resolvedPromptsDir = fsExistsSync(sourceDir) ? sourceDir : resolvedCorePromptsDir;
  const readClaudeUsageSnapshotWithDefault =
    readClaudeUsageSnapshot ??
    (() =>
      readClaudeUsageSnapshotDefault({
        projectStateDir: resolvedStateDir,
        backgroundRefreshOnly: true,
      }));
  const readClaudeOauthUsageSnapshotWithDefault =
    readClaudeOauthUsageSnapshot ??
    (() =>
      readClaudeOauthUsageSnapshotDefault({
        projectStateDir: resolvedStateDir,
      }));
  const readClaudeCliUsageSnapshotWithDefault =
    readClaudeCliUsageSnapshot ??
    (() =>
      readClaudeCliUsageSnapshotDefault({
        projectStateDir: resolvedStateDir,
      }));
  const readGithubRepoSummaryWithDefault =
    readGithubRepoSummary ??
    (() =>
      readGithubRepoSummaryDefault({
        cwd: resolvedWorkspaceCwd,
      }));

  const runtimeOptions: Parameters<typeof createTerminalRuntime>[0] = {
    workspaceCwd: resolvedWorkspaceCwd,
    projectStateDir: resolvedStateDir,
    getApiBaseUrl,
    projectId,
    maxConcurrentSessions,
    checkSessionAdmission,
  };
  if (gitClient) {
    runtimeOptions.gitClient = gitClient;
  }

  const runtime = createTerminalRuntime(runtimeOptions);
  const monitorServiceWithDefault =
    monitorService ??
    createMonitorService({
      projectStateDir: resolvedStateDir,
    });
  const scanUsageHeatmapWithDefault =
    scanUsageHeatmap ??
    ((scope: "all" | "project") => scanClaudeUsageChart(scope, resolvedWorkspaceCwd));

  // Whatever the usage routes last fetched successfully; terminal create
  // checks it for an exhausted quota without fetching anything itself.
  const cachedUsage: CachedUsageSnapshots = { codex: null, claude: null };
  const rememberClaudeUsage = (read: () => Promise<ClaudeUsageSnapshot>) =>
    rememberUsageSnapshot(read, (snapshot) => {
      cachedUsage.claude = snapshot;
    });

  const codeIntelStore = createCodeIntelStore(resolvedStateDir);
  const healthSnapshotSource = createHealthSnapshotSource();

  const dispatchRequest = createApiRouteDispatcher({
    runtime,
    workspaceCwd: resolvedWorkspaceCwd,
    projectStateDir: resolvedStateDir,
    promptsDir: resolvedPromptsDir,
    userPromptsDir: resolvedUserPromptsDir,
    webDistDir,
    getApiBaseUrl,
    getApiPort,
    readClaudeUsageSnapshot: rememberClaudeUsage(readClaudeUsageSnapshotWithDefault),
    readClaudeOauthUsageSnapshot: rememberClaudeUsage(readClaudeOauthUsageSnapshotWithDefault),
    readClaudeCliUsageSnapshot: rememberClaudeUsage(readClaudeCliUsageSnapshotWithDefault),
    readCodexUsageSnapshot: rememberUsageSnapshot(readCodexUsageSnapshot, (snapshot) => {
      cachedUsage.codex = snapshot;
    }),
    readCachedUsage: () => cachedUsage,
    readGithubRepoSummary: readGithubRepoSummaryWithDefault,
    scanUsageHeatmap: scanUsageHeatmapWithDefault,
    monitorService: monitorServiceWithDefault,
    invalidateClaudeUsageCache,
    codeIntelStore,
    readHealthSnapshot: () => healthSnapshotSource.readHealthSnapshot(runtime.readHealthCounts()),
    isRemoteBinding,
  });
  const dispatchUpgrade = createRuntimeUpgradeDispatcher(runtime);

  const handleRequest: ApiRouteDispatcher = logPrefix
    ? (request, response) => runWithLogPrefix(logPrefix, () => dispatchRequest(request, response))
    : dispatchRequest;
  const handleUpgrade: UpgradeDispatcher = logPrefix
    ? (request, socket, head) =>
        runWithLogPrefix(logPrefix, () => dispatchUpgrade(request, socket, head))
    : dispatchUpgrade;

  return {
    projectId: resolvedProjectId,
    workspaceCwd: resolvedWorkspaceCwd,
    projectStateDir: resolvedStateDir,
    runtime,
    /** Routes one project's API; callers run the Host/Origin/token guard first. */
    handleRequest,
    handleUpgrade,
    describe(): ProjectContextSummary {
      const counts = runtime.readHealthCounts();
      return {
        id: resolvedProjectId,
        name: resolvedProjectName,
        path: resolvedWorkspaceCwd,
        ptySessions: counts.ptySessions,
        runningTerminals: counts.terminals.running,
        awaitingReviewTerminals: counts.terminals["awaiting-review"],
        lastActivityAt: runtime.readLastActivityAt(),
      };
    },
    async stop() {
      healthSnapshotSource.close();
      await runtime.close();
    },
  };
};

export type ProjectContext = ReturnType<typeof createProjectContext>;
