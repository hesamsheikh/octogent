import type { IncomingMessage, ServerResponse } from "node:http";

import type { UsageChartResponse } from "../claudeSessionScanner";
import type { ClaudeUsageSnapshot } from "../claudeUsage";
import type { CodeIntelStore } from "../codeIntelStore";
import type { CodexUsageSnapshot } from "../codexUsage";
import type { GitHubRepoSummarySnapshot } from "../githubRepoSummary";
import type { HealthSnapshot } from "../healthSnapshot";
import type { MonitorService } from "../monitor";
import { type RuntimeInputError, SessionLimitError } from "../terminalRuntime/types";
import type { CachedUsageSnapshots } from "../usageExhaustion";
import { RequestBodyTooLargeError, readJsonBody } from "./requestParsers";
import { withCors } from "./security";

export type TerminalRuntime = ReturnType<typeof import("../terminalRuntime").createTerminalRuntime>;

export type RouteHandlerDependencies = {
  runtime: TerminalRuntime;
  workspaceCwd: string;
  projectStateDir: string;
  promptsDir: string;
  userPromptsDir: string;
  getApiBaseUrl: () => string;
  getApiPort: () => string;
  readClaudeUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readClaudeOauthUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readClaudeCliUsageSnapshot: () => Promise<ClaudeUsageSnapshot>;
  readCodexUsageSnapshot: () => Promise<CodexUsageSnapshot>;
  /** Last good usage readings, for checks that must not fetch. */
  readCachedUsage: () => CachedUsageSnapshots;
  readGithubRepoSummary: () => Promise<GitHubRepoSummarySnapshot>;
  scanUsageHeatmap: (scope: "all" | "project") => Promise<UsageChartResponse>;
  monitorService: MonitorService;
  invalidateClaudeUsageCache: () => void;
  codeIntelStore: CodeIntelStore;
  readHealthSnapshot: () => HealthSnapshot;
};

export type RouteHandlerContext = {
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  corsOrigin: string | null;
};

type JsonBodyReadResult = { ok: true; payload: unknown } | { ok: false };
export type ApiRouteHandler = (
  context: RouteHandlerContext,
  dependencies: RouteHandlerDependencies,
) => Promise<boolean>;

export const writeJson = (
  response: ServerResponse,
  status: number,
  payload: unknown,
  corsOrigin: string | null,
) => {
  response.writeHead(status, withCors({ "Content-Type": "application/json" }, corsOrigin));
  response.end(JSON.stringify(payload));
};

export const writeText = (
  response: ServerResponse,
  status: number,
  payload: string,
  contentType: string,
  corsOrigin: string | null,
) => {
  response.writeHead(status, withCors({ "Content-Type": contentType }, corsOrigin));
  response.end(payload);
};

export const writeNoContent = (
  response: ServerResponse,
  status: number,
  corsOrigin: string | null,
) => {
  response.writeHead(status, withCors({}, corsOrigin));
  response.end();
};

/** Status for a runtime refusal on create: a shared session cap is "try later", the rest is bad input. */
export const runtimeInputErrorStatus = (error: RuntimeInputError): 400 | 429 =>
  error instanceof SessionLimitError ? 429 : 400;

export const writeMethodNotAllowed = (response: ServerResponse, corsOrigin: string | null) => {
  writeJson(response, 405, { error: "Method not allowed" }, corsOrigin);
};

export const readJsonBodyOrWriteError = async (
  request: IncomingMessage,
  response: ServerResponse,
  corsOrigin: string | null,
  maxBytes?: number,
): Promise<JsonBodyReadResult> => {
  try {
    const payload = await readJsonBody(request, maxBytes);
    return { ok: true, payload };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      writeJson(response, 413, { error: "Request body too large." }, corsOrigin);
      return { ok: false };
    }

    writeJson(response, 400, { error: "Invalid JSON body." }, corsOrigin);
    return { ok: false };
  }
};
