import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";

import type { UsageChartResponse } from "../claudeSessionScanner";
import type { ClaudeUsageSnapshot } from "../claudeUsage";
import type { CodeIntelStore } from "../codeIntelStore";
import type { CodexUsageSnapshot } from "../codexUsage";
import type { GitHubRepoSummarySnapshot } from "../githubRepoSummary";
import type { HealthSnapshot } from "../healthSnapshot";
import { logVerbose } from "../logging";
import type { MonitorService } from "../monitor";
import { handleCodeIntelEventsRoute } from "./codeIntelRoutes";
import {
  handleConversationExportRoute,
  handleConversationItemRoute,
  handleConversationSearchRoute,
  handleConversationsCollectionRoute,
} from "./conversationRoutes";
import {
  handleDeckSkillsRoute,
  handleDeckTentacleItemRoute,
  handleDeckTentacleSkillsRoute,
  handleDeckTentacleSwarmRoute,
  handleDeckTentaclesRoute,
  handleDeckTodoAddRoute,
  handleDeckTodoDeleteRoute,
  handleDeckTodoEditRoute,
  handleDeckTodoSolveRoute,
  handleDeckTodoToggleRoute,
  handleDeckVaultFileRoute,
} from "./deckRoutes";
import { handleTentacleGitPullRequestRoute, handleTentacleGitRoute } from "./gitRoutes";
import { handleHealthRoute } from "./healthRoutes";
import {
  handleChannelMessagesRoute,
  handleHookRoute,
  handlePromptItemRoute,
  handlePromptsCollectionRoute,
  handleUiStateRoute,
  handleWorkspaceSetupRoute,
} from "./miscRoutes";
import {
  handleMonitorConfigRoute,
  handleMonitorFeedRoute,
  handleMonitorRefreshRoute,
} from "./monitorRoutes";
import { evaluateRemoteAuth } from "./remoteAuth";
import type {
  ApiRouteHandler,
  RouteHandlerContext,
  RouteHandlerDependencies,
  TerminalRuntime,
} from "./routeHelpers";
import { writeJson, writeNoContent } from "./routeHelpers";
import {
  getRequestCorsOrigin,
  isAllowedHostHeader,
  isAllowedOriginHeader,
  readHeaderValue,
} from "./security";
import {
  handleTerminalActionRoute,
  handleTerminalArchiveCompletedRoute,
  handleTerminalDeletePreviewRoute,
  handleTerminalItemRoute,
  handleTerminalPruneRoute,
  handleTerminalSnapshotsRoute,
  handleTerminalsCollectionRoute,
  handleWorktreeGcRoute,
} from "./terminalRoutes";
import {
  handleClaudeUsageRoute,
  handleCodexUsageRoute,
  handleGithubSummaryRoute,
  handleUsageHeatmapRoute,
} from "./usageRoutes";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

type CreateApiRequestHandlerOptions = {
  runtime: TerminalRuntime;
  workspaceCwd: string;
  projectStateDir: string;
  promptsDir: string;
  userPromptsDir: string;
  webDistDir?: string | undefined;
  getApiBaseUrl: () => string;
  getApiPort: () => string;
  readClaudeUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readClaudeOauthUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readClaudeCliUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readCodexUsageSnapshot: () => Promise<CodexUsageSnapshot>;
  readGithubRepoSummary: () => Promise<GitHubRepoSummarySnapshot>;
  scanUsageHeatmap: (scope: "all" | "project") => Promise<UsageChartResponse>;
  monitorService: MonitorService;
  invalidateClaudeUsageCache: () => void;
  codeIntelStore: CodeIntelStore;
  readHealthSnapshot: () => HealthSnapshot;
  isRemoteBinding: () => boolean;
  accessToken: string | null;
};

const API_ROUTE_MAP: ReadonlyMap<string, readonly ApiRouteHandler[]> = new Map([
  ["channels", [handleChannelMessagesRoute]],
  ["hooks", [handleHookRoute]],
  ["prompts", [handlePromptsCollectionRoute, handlePromptItemRoute]],
  [
    "deck",
    [
      handleDeckSkillsRoute,
      handleDeckTentaclesRoute,
      handleDeckTentacleItemRoute,
      handleDeckTentacleSkillsRoute,
      handleDeckTodoSolveRoute,
      handleDeckTentacleSwarmRoute,
      handleDeckTodoToggleRoute,
      handleDeckTodoEditRoute,
      handleDeckTodoAddRoute,
      handleDeckTodoDeleteRoute,
      handleDeckVaultFileRoute,
    ],
  ],
  ["terminal-snapshots", [handleTerminalSnapshotsRoute]],
  ["health", [handleHealthRoute]],
  ["codex", [handleCodexUsageRoute]],
  ["claude", [handleClaudeUsageRoute]],
  ["analytics", [handleUsageHeatmapRoute]],
  ["github", [handleGithubSummaryRoute]],
  ["setup", [handleWorkspaceSetupRoute]],
  ["ui-state", [handleUiStateRoute]],
  ["monitor", [handleMonitorConfigRoute, handleMonitorFeedRoute, handleMonitorRefreshRoute]],
  [
    "conversations",
    [
      handleConversationsCollectionRoute,
      handleConversationSearchRoute,
      handleConversationExportRoute,
      handleConversationItemRoute,
    ],
  ],
  [
    "terminals",
    [
      handleTerminalsCollectionRoute,
      handleTerminalPruneRoute,
      handleTerminalArchiveCompletedRoute,
      handleTerminalDeletePreviewRoute,
      handleTerminalActionRoute,
      handleTerminalItemRoute,
    ],
  ],
  ["worktrees", [handleWorktreeGcRoute]],
  ["tentacles", [handleTentacleGitRoute, handleTentacleGitPullRequestRoute]],
  ["code-intel", [handleCodeIntelEventsRoute]],
]);

const extractRoutePrefix = (pathname: string): string | null => {
  const segments = pathname.split("/");
  if (segments.length < 3 || segments[1] !== "api") {
    return null;
  }
  return segments[2] ?? null;
};

const logRequest = (method: string, path: string, status: number, startTime: number) => {
  logVerbose(`[API] ${method} ${path} ${status} ${Date.now() - startTime}ms`);
};

const serveStaticFile = async (
  response: ServerResponse,
  webDistDir: string,
  pathname: string,
): Promise<boolean> => {
  // Prevent path traversal.
  const safePath = pathname.replace(/\.\./g, "").replace(/\/+/g, "/");
  const filePath = join(webDistDir, safePath === "/" ? "index.html" : safePath);

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") {
      console.error(
        `[API] Static file error: ${filePath}`,
        error instanceof Error ? error.message : error,
      );
    }
    return false;
  }
};

export const createApiRequestHandler = ({
  runtime,
  workspaceCwd,
  projectStateDir,
  promptsDir,
  userPromptsDir,
  webDistDir,
  getApiBaseUrl,
  getApiPort,
  readClaudeUsageSnapshot,
  readClaudeOauthUsageSnapshot,
  readClaudeCliUsageSnapshot,
  readCodexUsageSnapshot,
  readGithubRepoSummary,
  scanUsageHeatmap,
  monitorService,
  invalidateClaudeUsageCache,
  codeIntelStore,
  readHealthSnapshot,
  isRemoteBinding,
  accessToken,
}: CreateApiRequestHandlerOptions) => {
  const resolvedWebDistDir = webDistDir && existsSync(webDistDir) ? webDistDir : null;

  const routeDependencies: RouteHandlerDependencies = {
    runtime,
    workspaceCwd,
    projectStateDir,
    promptsDir,
    userPromptsDir,
    getApiBaseUrl,
    getApiPort,
    readClaudeUsageSnapshot,
    readClaudeOauthUsageSnapshot,
    readClaudeCliUsageSnapshot,
    readCodexUsageSnapshot,
    readGithubRepoSummary,
    scanUsageHeatmap,
    monitorService,
    invalidateClaudeUsageCache,
    codeIntelStore,
    readHealthSnapshot,
  };

  return async (request: IncomingMessage, response: ServerResponse) => {
    const startTime = Date.now();
    let statusCode = 0;
    const originalWriteHead = response.writeHead.bind(response);
    response.writeHead = ((...args: Parameters<typeof response.writeHead>) => {
      statusCode = typeof args[0] === "number" ? args[0] : 0;
      return originalWriteHead(...args);
    }) as typeof response.writeHead;

    const originHeader = readHeaderValue(request.headers.origin);
    const hostHeader = readHeaderValue(request.headers.host);
    const remoteBinding = isRemoteBinding();
    const corsOrigin = getRequestCorsOrigin(originHeader, hostHeader, remoteBinding);

    if (!isAllowedHostHeader(hostHeader, remoteBinding)) {
      writeJson(response, 403, { error: "Host not allowed." }, null);
      logRequest(request.method ?? "?", request.url ?? "/", 403, startTime);
      return;
    }

    if (!isAllowedOriginHeader(originHeader, hostHeader, remoteBinding)) {
      writeJson(response, 403, { error: "Origin not allowed." }, null);
      logRequest(request.method ?? "?", request.url ?? "/", 403, startTime);
      return;
    }

    const authDecision = evaluateRemoteAuth({
      remoteAddress: request.socket.remoteAddress,
      url: request.url ?? "/",
      headers: {
        "x-octogent-token": request.headers["x-octogent-token"],
        cookie: request.headers.cookie,
      },
      accessToken,
    });
    if (authDecision.kind === "deny") {
      writeJson(response, 401, { error: "Access token required." }, corsOrigin);
      logRequest(request.method ?? "?", request.url ?? "/", 401, startTime);
      return;
    }
    if (authDecision.kind === "allow-set-cookie") {
      response.setHeader("Set-Cookie", authDecision.cookie);
    }

    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "OPTIONS") {
        writeNoContent(response, 204, corsOrigin);
        logRequest(request.method ?? "OPTIONS", requestUrl.pathname, statusCode, startTime);
        return;
      }

      const routeContext: RouteHandlerContext = {
        request,
        response,
        requestUrl,
        corsOrigin,
      };

      const prefix = extractRoutePrefix(requestUrl.pathname);
      const handlers = prefix !== null ? API_ROUTE_MAP.get(prefix) : undefined;
      if (handlers) {
        for (const handleRoute of handlers) {
          if (await handleRoute(routeContext, routeDependencies)) {
            logRequest(request.method ?? "?", requestUrl.pathname, statusCode, startTime);
            return;
          }
        }
      }

      // Serve static web frontend if available.
      if (resolvedWebDistDir && request.method === "GET") {
        const served =
          (await serveStaticFile(response, resolvedWebDistDir, requestUrl.pathname)) ||
          (await serveStaticFile(response, resolvedWebDistDir, "/"));
        if (served) {
          logRequest(request.method, requestUrl.pathname, 200, startTime);
          return;
        }
      }

      writeJson(response, 404, { error: "Not found" }, corsOrigin);
      logRequest(request.method ?? "?", requestUrl.pathname, statusCode, startTime);
    } catch (error) {
      console.error(
        `[API] Unhandled error: ${request.method ?? "?"} ${request.url ?? "/"}`,
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      writeJson(
        response,
        500,
        {
          error: "Internal server error",
        },
        corsOrigin,
      );
      logRequest(request.method ?? "?", request.url ?? "/", statusCode, startTime);
    }
  };
};
