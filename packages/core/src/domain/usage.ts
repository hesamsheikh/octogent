export type ClaudeUsageSnapshot = {
  status: "ok" | "unavailable" | "error";
  fetchedAt: string;
  source: "cli-pty" | "oauth-api" | "none";
  message?: string | null;
  planType?: string | null;
  primaryUsedPercent?: number | null;
  primaryResetAt?: string | null;
  secondaryUsedPercent?: number | null;
  secondaryResetAt?: string | null;
  sonnetUsedPercent?: number | null;
  sonnetResetAt?: string | null;
  scopedUsedPercent?: number | null;
  scopedResetAt?: string | null;
  scopedLabel?: string | null;
  extraUsageCostUsed?: number | null;
  extraUsageCostLimit?: number | null;
};

export type CodexUsageSnapshot = {
  status: "ok" | "unavailable" | "error";
  fetchedAt: string;
  source: "oauth-api" | "none";
  message?: string | null;
  planType?: string | null;
  primaryUsedPercent?: number | null;
  primaryResetAt?: string | null;
  secondaryUsedPercent?: number | null;
  secondaryResetAt?: string | null;
  creditsBalance?: number | null;
  creditsUnlimited?: boolean | null;
};

export type GitHubCommitPoint = {
  date: string;
  count: number;
};

export type GitHubRecentCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  body: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type GitHubRepoSummarySnapshot = {
  status: "ok" | "unavailable" | "error";
  fetchedAt: string;
  source: "gh-cli" | "none";
  message?: string | null;
  repo?: string | null;
  stargazerCount?: number | null;
  openIssueCount?: number | null;
  openPullRequestCount?: number | null;
  commitsPerDay?: GitHubCommitPoint[];
  recentCommits?: GitHubRecentCommit[];
};
