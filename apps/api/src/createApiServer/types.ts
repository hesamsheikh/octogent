import type { UsageChartResponse } from "../claudeSessionScanner";
import type { ClaudeUsageSnapshot } from "../claudeUsage";
import type { CodexUsageSnapshot } from "../codexUsage";
import type { GitHubRepoSummarySnapshot } from "../githubRepoSummary";
import type { MonitorService } from "../monitor";
import type { GitClient } from "../terminalRuntime";

export type CreateApiServerOptions = {
  workspaceCwd?: string | undefined;
  projectStateDir?: string | undefined;
  promptsDir?: string | undefined;
  webDistDir?: string | undefined;
  apiBaseUrl?: string | undefined;
  gitClient?: GitClient;
  readClaudeUsageSnapshot?: () => Promise<ClaudeUsageSnapshot>;
  readClaudeOauthUsageSnapshot?: () => Promise<ClaudeUsageSnapshot>;
  readClaudeCliUsageSnapshot?: () => Promise<ClaudeUsageSnapshot>;
  readCodexUsageSnapshot?: () => Promise<CodexUsageSnapshot>;
  readGithubRepoSummary?: () => Promise<GitHubRepoSummarySnapshot>;
  scanUsageHeatmap?: (scope: "all" | "project") => Promise<UsageChartResponse>;
  monitorService?: MonitorService;
  invalidateClaudeUsageCache?: () => void;
  accessToken?: string | null;
};
