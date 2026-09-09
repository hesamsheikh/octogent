import { cpSync, existsSync as fsExistsSync, mkdirSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import { scanClaudeUsageChart } from "./claudeSessionScanner";
import {
  invalidateUsageCache as invalidateUsageCacheDefault,
  readClaudeCliUsageSnapshot as readClaudeCliUsageSnapshotDefault,
  readClaudeOauthUsageSnapshot as readClaudeOauthUsageSnapshotDefault,
  readClaudeUsageSnapshot as readClaudeUsageSnapshotDefault,
} from "./claudeUsage";
import { createCodeIntelStore } from "./codeIntelStore";
import { readCodexUsageSnapshot as readCodexUsageSnapshotDefault } from "./codexUsage";
import {
  assertSecureRemoteBinding,
  isLoopbackAddress,
  resolveAccessToken,
} from "./createApiServer/remoteAuth";
import { createApiRequestHandler } from "./createApiServer/requestHandler";
import type { CreateApiServerOptions } from "./createApiServer/types";
import { createUpgradeHandler } from "./createApiServer/upgradeHandler";
import { readGithubRepoSummary as readGithubRepoSummaryDefault } from "./githubRepoSummary";
import { createHealthSnapshotSource } from "./healthSnapshot";
import { createMonitorService } from "./monitor";
import { createTerminalRuntime } from "./terminalRuntime";

export const createApiServer = ({
  workspaceCwd,
  projectStateDir,
  promptsDir,
  webDistDir,
  apiBaseUrl,
  gitClient,
  readClaudeUsageSnapshot,
  readClaudeOauthUsageSnapshot,
  readClaudeCliUsageSnapshot,
  readCodexUsageSnapshot = readCodexUsageSnapshotDefault,
  readGithubRepoSummary,
  scanUsageHeatmap,
  monitorService,
  invalidateClaudeUsageCache = invalidateUsageCacheDefault,
  accessToken: configuredAccessToken = resolveAccessToken(process.env),
}: CreateApiServerOptions = {}) => {
  const accessToken = configuredAccessToken?.trim() || null;
  const resolvedWorkspaceCwd = workspaceCwd ?? process.cwd();
  // State lives in ~/.octogent/projects/<name>/ when provided, else falls back to <project>/.octogent/
  const resolvedStateDir = projectStateDir ?? join(resolvedWorkspaceCwd, ".octogent");
  let resolvedApiBaseUrl = apiBaseUrl ?? "http://127.0.0.1:8787";
  const getApiBaseUrl = () => resolvedApiBaseUrl;
  const getApiPort = () => {
    try {
      return String(new URL(resolvedApiBaseUrl).port || 80);
    } catch {
      return "8787";
    }
  };
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

  const codeIntelStore = createCodeIntelStore(resolvedStateDir);
  const healthSnapshotSource = createHealthSnapshotSource();
  let remoteBinding = false;

  const requestHandler = createApiRequestHandler({
    runtime,
    workspaceCwd: resolvedWorkspaceCwd,
    projectStateDir: resolvedStateDir,
    promptsDir: resolvedPromptsDir,
    userPromptsDir: resolvedUserPromptsDir,
    webDistDir,
    getApiBaseUrl,
    getApiPort,
    readClaudeUsageSnapshot: readClaudeUsageSnapshotWithDefault,
    readClaudeOauthUsageSnapshot: readClaudeOauthUsageSnapshotWithDefault,
    readClaudeCliUsageSnapshot: readClaudeCliUsageSnapshotWithDefault,
    readCodexUsageSnapshot,
    readGithubRepoSummary: readGithubRepoSummaryWithDefault,
    scanUsageHeatmap: scanUsageHeatmapWithDefault,
    monitorService: monitorServiceWithDefault,
    invalidateClaudeUsageCache,
    codeIntelStore,
    readHealthSnapshot: () => healthSnapshotSource.readHealthSnapshot(runtime.readHealthCounts()),
    isRemoteBinding: () => remoteBinding,
    accessToken,
  });

  const server = createServer(requestHandler);

  server.on(
    "upgrade",
    createUpgradeHandler({
      runtime,
      isRemoteBinding: () => remoteBinding,
      accessToken,
    }),
  );

  return {
    server,
    async start(port = 8787, host = "127.0.0.1") {
      await new Promise<void>((resolveStart, rejectStart) => {
        const onError = (error: Error) => rejectStart(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          const boundAddress = typeof address === "object" && address ? address.address : host;
          remoteBinding = !isLoopbackAddress(boundAddress);

          try {
            assertSecureRemoteBinding(boundAddress, accessToken);
            resolveStart();
          } catch (error) {
            server.close(() => rejectStart(error));
          }
        });
      });

      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      resolvedApiBaseUrl = `http://${host}:${resolvedPort}`;

      return { host, port: resolvedPort };
    },
    async stop() {
      healthSnapshotSource.close();
      await runtime.close();
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolveStop, rejectStop) => {
        server.close((error) => {
          if (error) {
            rejectStop(error);
            return;
          }
          resolveStop();
        });
        server.closeAllConnections();
      });
    },
  };
};
