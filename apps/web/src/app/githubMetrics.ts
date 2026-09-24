import { t } from "@octogent/core";
import type { Locale } from "@octogent/core";
import { GITHUB_COMMIT_SERIES_LENGTH } from "./constants";
import type { GitHubCommitPoint, GitHubCommitSparkPoint, GitHubRepoSummarySnapshot } from "./types";

export const formatGitHubCommitHoverLabel = (point: GitHubCommitPoint, locale: Locale = "en") => {
  if (point.date.startsWith("n/a-")) {
    if (point.count === 1) {
      return t(locale, "web.github.commitDateCount", { date: "No date", count: point.count });
    }
    return t(locale, "web.github.commitDateCountPlural", { date: "No date", count: point.count });
  }

  if (point.count === 1) {
    return t(locale, "web.github.commitDateCount", { date: point.date, count: point.count });
  }
  return t(locale, "web.github.commitDateCountPlural", { date: point.date, count: point.count });
};

export const buildGitHubStatusPill = (
  summary: GitHubRepoSummarySnapshot | null,
  locale: Locale = "en",
) => {
  if (!summary) {
    return t(locale, "web.github.statusPill.loading");
  }

  if (summary.status === "ok") {
    return t(locale, "web.github.statusPill.live");
  }

  if (summary.status === "unavailable") {
    return t(locale, "web.github.statusPill.unavailable");
  }

  return t(locale, "web.github.statusPill.error");
};

export const buildGitHubCommitSeries = (summary: GitHubRepoSummarySnapshot | null) => {
  const fallbackSeries = Array.from({ length: GITHUB_COMMIT_SERIES_LENGTH }, (_, index) => ({
    date: `n/a-${index}`,
    count: 0,
  }));

  if (!summary?.commitsPerDay || summary.commitsPerDay.length === 0) {
    return fallbackSeries;
  }

  const sorted = [...summary.commitsPerDay]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-GITHUB_COMMIT_SERIES_LENGTH);

  const firstCommitIndex = sorted.findIndex((point) => point.count > 0);
  if (firstCommitIndex > 0) {
    return sorted.slice(firstCommitIndex);
  }

  return sorted;
};

export const buildGitHubCommitSparkPoints = (
  series: GitHubCommitPoint[],
  width: number,
  height: number,
): GitHubCommitSparkPoint[] => {
  const values = series.map((point) => point.count);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = Math.max(1, maxValue - minValue);

  return series.map((point, index) => {
    const x = (index / Math.max(1, series.length - 1)) * width;
    const y = height - ((point.count - minValue) / valueRange) * height;
    return {
      date: point.date,
      count: point.count,
      x,
      y,
    };
  });
};

export const buildGitHubSparkPolylinePoints = (series: GitHubCommitSparkPoint[]) =>
  series.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

export const buildGitHubCommitCount = (series: GitHubCommitPoint[]) =>
  series.reduce((total, point) => total + point.count, 0);
