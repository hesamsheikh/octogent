import { useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { Locale } from "@octogent/core";
import {
  GITHUB_OVERVIEW_GRAPH_HEIGHT,
  GITHUB_OVERVIEW_GRAPH_WIDTH,
  GITHUB_SPARKLINE_HEIGHT,
  GITHUB_SPARKLINE_WIDTH,
} from "../constants";
import {
  buildGitHubCommitCount,
  buildGitHubCommitSeries,
  buildGitHubCommitSparkPoints,
  buildGitHubSparkPolylinePoints,
  buildGitHubStatusPill,
  formatGitHubCommitHoverLabel,
} from "../githubMetrics";
import type {
  GitHubCommitSparkPoint,
  GitHubRecentCommit,
  GitHubRepoSummarySnapshot,
} from "../types";

type UseGitHubPrimaryViewModelOptions = {
  githubRepoSummary: GitHubRepoSummarySnapshot | null;
  hoveredGitHubOverviewPointIndex: number | null;
  setHoveredGitHubOverviewPointIndex: Dispatch<SetStateAction<number | null>>;
  locale?: Locale;
};

type GitHubPrimaryViewModel = {
  githubCommitCount30d: number;
  sparklinePoints: string;
  githubOverviewGraphSeries: GitHubCommitSparkPoint[];
  githubOverviewGraphPolylinePoints: string;
  githubOverviewHoverLabel: string;
  githubStatusPill: string;
  githubRepoLabel: string;
  githubStarCountLabel: string;
  githubOpenIssuesLabel: string;
  githubOpenPrsLabel: string;
  githubRecentCommits: GitHubRecentCommit[];
};

export const useGitHubPrimaryViewModel = ({
  githubRepoSummary,
  hoveredGitHubOverviewPointIndex,
  setHoveredGitHubOverviewPointIndex,
  locale = "en",
}: UseGitHubPrimaryViewModelOptions): GitHubPrimaryViewModel => {
  const githubCommitSeries = useMemo(
    () => buildGitHubCommitSeries(githubRepoSummary),
    [githubRepoSummary],
  );
  const githubCommitCount30d = useMemo(
    () => buildGitHubCommitCount(githubCommitSeries),
    [githubCommitSeries],
  );
  const sparklineSeries = useMemo<GitHubCommitSparkPoint[]>(
    () =>
      buildGitHubCommitSparkPoints(
        githubCommitSeries,
        GITHUB_SPARKLINE_WIDTH,
        GITHUB_SPARKLINE_HEIGHT,
      ),
    [githubCommitSeries],
  );
  const sparklinePoints = useMemo(
    () => buildGitHubSparkPolylinePoints(sparklineSeries),
    [sparklineSeries],
  );
  const githubOverviewGraphSeries = useMemo<GitHubCommitSparkPoint[]>(
    () =>
      buildGitHubCommitSparkPoints(
        githubCommitSeries,
        GITHUB_OVERVIEW_GRAPH_WIDTH,
        GITHUB_OVERVIEW_GRAPH_HEIGHT,
      ),
    [githubCommitSeries],
  );
  const githubOverviewGraphPolylinePoints = useMemo(
    () => buildGitHubSparkPolylinePoints(githubOverviewGraphSeries),
    [githubOverviewGraphSeries],
  );
  const hoveredGitHubOverviewPoint = useMemo(() => {
    if (hoveredGitHubOverviewPointIndex === null) {
      return null;
    }
    return githubOverviewGraphSeries[hoveredGitHubOverviewPointIndex] ?? null;
  }, [githubOverviewGraphSeries, hoveredGitHubOverviewPointIndex]);
  const githubOverviewHoverLabel = useMemo(() => {
    if (hoveredGitHubOverviewPoint) {
      return formatGitHubCommitHoverLabel(hoveredGitHubOverviewPoint, locale);
    }

    return "Hover points for date and commit count";
  }, [hoveredGitHubOverviewPoint, locale]);
  const githubStatusPill = useMemo(
    () => buildGitHubStatusPill(githubRepoSummary, locale),
    [githubRepoSummary, locale],
  );

  useEffect(() => {
    if (hoveredGitHubOverviewPointIndex === null) {
      return;
    }
    if (hoveredGitHubOverviewPointIndex >= githubOverviewGraphSeries.length) {
      setHoveredGitHubOverviewPointIndex(null);
    }
  }, [
    githubOverviewGraphSeries.length,
    hoveredGitHubOverviewPointIndex,
    setHoveredGitHubOverviewPointIndex,
  ]);

  const githubRepoLabel = githubRepoSummary?.repo ?? "GitHub repository";
  const githubStarCountLabel =
    githubRepoSummary?.stargazerCount !== null && githubRepoSummary?.stargazerCount !== undefined
      ? Math.round(githubRepoSummary.stargazerCount).toLocaleString("en-US")
      : "--";
  const githubOpenIssuesLabel =
    githubRepoSummary?.openIssueCount !== null && githubRepoSummary?.openIssueCount !== undefined
      ? Math.round(githubRepoSummary.openIssueCount).toString()
      : "--";
  const githubOpenPrsLabel =
    githubRepoSummary?.openPullRequestCount !== null &&
    githubRepoSummary?.openPullRequestCount !== undefined
      ? Math.round(githubRepoSummary.openPullRequestCount).toString()
      : "--";
  const githubRecentCommits = (githubRepoSummary?.recentCommits ?? []).slice(0, 50);

  return {
    githubCommitCount30d,
    sparklinePoints,
    githubOverviewGraphSeries,
    githubOverviewGraphPolylinePoints,
    githubOverviewHoverLabel,
    githubStatusPill,
    githubRepoLabel,
    githubStarCountLabel,
    githubOpenIssuesLabel,
    githubOpenPrsLabel,
    githubRecentCommits,
  };
};
