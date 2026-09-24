import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GITHUB_OVERVIEW_GRAPH_HEIGHT, GITHUB_OVERVIEW_GRAPH_WIDTH } from "../app/constants";
import { formatGitHubCommitHoverLabel } from "../app/githubMetrics";
import { useT } from "../app/providers/LocaleProvider";
import { useLocale } from "../app/providers/LocaleProvider";
import type { GitHubCommitSparkPoint, GitHubRecentCommit } from "../app/types";
import { ActionButton } from "./ui/ActionButton";

type GitHubPrimaryViewProps = {
  githubRepoLabel: string;
  githubStatusPill: string;
  isRefreshingGitHubSummary: boolean;
  onRefresh: () => void;
  githubStarCountLabel: string;
  githubOpenIssuesLabel: string;
  githubOpenPrsLabel: string;
  githubRecentCommits: GitHubRecentCommit[];
  githubCommitCount30d: number;
  githubOverviewHoverLabel: string;
  githubOverviewGraphPolylinePoints: string;
  githubOverviewGraphSeries: GitHubCommitSparkPoint[];
  hoveredGitHubOverviewPointIndex: number | null;
  onHoveredGitHubOverviewPointIndexChange: (index: number | null) => void;
};

const GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET = 8;
const GITHUB_RECENT_COMMITS_LIMIT = 50;

const formatSparkDate = (date: string, locale = "en-US"): string => {
  if (date.startsWith("n/a")) return "";
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
};

const buildCommitYTicks = (series: GitHubCommitSparkPoint[]): { count: number; y: number }[] => {
  if (series.length === 0) return [];
  const counts = series.map((p) => p.count);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const range = Math.max(1, maxCount - minCount);
  const H = GITHUB_OVERVIEW_GRAPH_HEIGHT;
  const tickCount = 4;
  const ticks: { count: number; y: number }[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const count = Math.round(minCount + range * (i / tickCount));
    const y = H - ((count - minCount) / range) * H;
    ticks.push({ count, y });
  }
  return ticks;
};

const buildAreaPolygonPoints = (series: GitHubCommitSparkPoint[]): string => {
  if (series.length === 0) return "";
  const H = GITHUB_OVERVIEW_GRAPH_HEIGHT;
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return "";
  const linePoints = series.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return `${first.x.toFixed(1)},${H} ${linePoints} ${last.x.toFixed(1)},${H}`;
};

const formatRecentCommitTimestamp = (value: string, locale = "en-US") => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const GitHubPrimaryView = ({
  githubRepoLabel,
  githubStatusPill,
  isRefreshingGitHubSummary,
  onRefresh,
  githubStarCountLabel,
  githubOpenIssuesLabel,
  githubOpenPrsLabel,
  githubRecentCommits,
  githubCommitCount30d,
  githubOverviewHoverLabel,
  githubOverviewGraphPolylinePoints,
  githubOverviewGraphSeries,
  hoveredGitHubOverviewPointIndex,
  onHoveredGitHubOverviewPointIndexChange,
}: GitHubPrimaryViewProps) => {
  const t = useT();
  const locale = useLocale();
  const [hoverCursorPosition, setHoverCursorPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [pinnedCommitHash, setPinnedCommitHash] = useState<string | null>(null);
  const [hoveredCommitHash, setHoveredCommitHash] = useState<string | null>(null);
  const [commitTooltipY, setCommitTooltipY] = useState<number | null>(null);
  const recentSectionRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeCommitHash = pinnedCommitHash ?? hoveredCommitHash;
  const activeCommit = activeCommitHash
    ? (githubRecentCommits.find((c) => c.hash === activeCommitHash) ?? null)
    : null;

  const dismissCommitTooltip = useCallback(() => {
    setPinnedCommitHash(null);
    setCommitTooltipY(null);
  }, []);

  useEffect(() => {
    if (pinnedCommitHash === null) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (recentSectionRef.current?.contains(target) || tooltipRef.current?.contains(target)) {
        return;
      }
      dismissCommitTooltip();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pinnedCommitHash, dismissCommitTooltip]);
  const yTicks = useMemo(
    () => buildCommitYTicks(githubOverviewGraphSeries),
    [githubOverviewGraphSeries],
  );
  const areaPolygonPoints = useMemo(
    () => buildAreaPolygonPoints(githubOverviewGraphSeries),
    [githubOverviewGraphSeries],
  );
  const xLabelStep = Math.max(1, Math.ceil(githubOverviewGraphSeries.length / 6));

  const hoveredGitHubOverviewPoint =
    hoveredGitHubOverviewPointIndex !== null
      ? (githubOverviewGraphSeries[hoveredGitHubOverviewPointIndex] ?? null)
      : null;
  const tooltipLabel = hoveredGitHubOverviewPoint
    ? formatGitHubCommitHoverLabel(hoveredGitHubOverviewPoint, locale)
    : null;

  return (
    <section className="github-view" aria-label={t("web.a11y.githubView")}>
      <section className="github-overview" aria-label={t("web.a11y.githubOverview")}>
        <header className="github-overview-header">
          <h2>{githubRepoLabel}</h2>
          <div className="github-overview-header-actions">
            <span className="console-status-pill">{githubStatusPill}</span>
            <ActionButton
              aria-label={t("web.a11y.refreshGithubOverview")}
              className="github-overview-refresh"
              disabled={isRefreshingGitHubSummary}
              onClick={onRefresh}
              size="dense"
              variant="accent"
            >
              {isRefreshingGitHubSummary ? t("web.github.refreshing") : t("web.github.refresh")}
            </ActionButton>
          </div>
        </header>
        <div className="github-overview-content">
          <section className="github-overview-main">
            <section
              className="github-overview-graph"
              aria-label={t("web.a11y.githubCommitsGraph")}
            >
              <div className="github-overview-graph-meta">
                <strong>{t("web.github.commitsPerDay")}</strong>
                <span>{githubOverviewHoverLabel}</span>
              </div>
              <div className="github-overview-graph-surface">
                <svg
                  onMouseLeave={() => {
                    onHoveredGitHubOverviewPointIndexChange(null);
                    setHoverCursorPosition(null);
                  }}
                  onMouseMove={(event) => {
                    if (githubOverviewGraphSeries.length === 0) {
                      return;
                    }

                    const rect = event.currentTarget.getBoundingClientRect();
                    if (rect.width <= 0) {
                      return;
                    }

                    const clampedRatio = Math.min(
                      1,
                      Math.max(0, (event.clientX - rect.left) / rect.width),
                    );
                    const viewBox = event.currentTarget.viewBox.baseVal;
                    const pointerX = viewBox.x + viewBox.width * clampedRatio;
                    const pointerY = Math.max(0, event.clientY - rect.top);

                    let nearestPointIndex = 0;
                    let nearestDistance = Number.POSITIVE_INFINITY;
                    githubOverviewGraphSeries.forEach((point, index) => {
                      const distance = Math.abs(point.x - pointerX);
                      if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestPointIndex = index;
                      }
                    });

                    if (nearestPointIndex !== hoveredGitHubOverviewPointIndex) {
                      onHoveredGitHubOverviewPointIndexChange(nearestPointIndex);
                    }

                    setHoverCursorPosition({
                      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
                      y: Math.max(0, Math.min(rect.height, pointerY)),
                    });
                  }}
                  viewBox={`${-GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET} ${-GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET} ${
                    GITHUB_OVERVIEW_GRAPH_WIDTH + GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET * 2
                  } ${GITHUB_OVERVIEW_GRAPH_HEIGHT + GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET * 2}`}
                  preserveAspectRatio="none"
                  role="presentation"
                >
                  <defs>
                    <linearGradient id="commitAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.16" />
                      <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0.01" />
                    </linearGradient>
                    <linearGradient id="commitLineGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fce8a8" />
                      <stop offset="60%" stopColor="#e8820a" />
                      <stop offset="100%" stopColor="#ff6a00" />
                    </linearGradient>
                  </defs>

                  {yTicks.map((tick, index) => (
                    <g key={`${tick.count}-${index}`}>
                      <line
                        x1={0}
                        y1={tick.y}
                        x2={GITHUB_OVERVIEW_GRAPH_WIDTH}
                        y2={tick.y}
                        className="github-overview-graph-grid"
                      />
                      <text x={4} y={tick.y - 4} className="github-overview-graph-y-label">
                        {tick.count}
                      </text>
                    </g>
                  ))}

                  {areaPolygonPoints && (
                    <polygon points={areaPolygonPoints} fill="url(#commitAreaGrad)" />
                  )}

                  <polyline
                    points={githubOverviewGraphPolylinePoints}
                    stroke="url(#commitLineGrad)"
                  />

                  {githubOverviewGraphSeries
                    .filter((_, i) => i % xLabelStep === 0)
                    .map((point) => {
                      const label = formatSparkDate(point.date, locale);
                      if (!label) return null;
                      return (
                        <text
                          key={`xl-${point.date}`}
                          x={point.x}
                          y={GITHUB_OVERVIEW_GRAPH_HEIGHT + GITHUB_OVERVIEW_GRAPH_VIEWBOX_INSET}
                          className="github-overview-graph-x-label"
                        >
                          {label}
                        </text>
                      );
                    })}

                  {githubOverviewGraphSeries.map((point, index) => (
                    <circle
                      aria-label={formatGitHubCommitHoverLabel(point, locale)}
                      className={`github-overview-graph-point${
                        hoveredGitHubOverviewPointIndex === index ? " is-active" : ""
                      }`}
                      cx={point.x}
                      cy={point.y}
                      key={`${point.date}-${index}`}
                      onFocus={() => {
                        onHoveredGitHubOverviewPointIndexChange(index);
                      }}
                      onMouseEnter={() => {
                        onHoveredGitHubOverviewPointIndexChange(index);
                      }}
                      r={6}
                      tabIndex={0}
                    >
                      <title>{formatGitHubCommitHoverLabel(point, locale)}</title>
                    </circle>
                  ))}
                </svg>
                {hoverCursorPosition && tooltipLabel && (
                  <div
                    className="github-overview-graph-tooltip"
                    style={{
                      left: `${hoverCursorPosition.x}px`,
                      top: `${Math.max(8, hoverCursorPosition.y - 14)}px`,
                    }}
                  >
                    {tooltipLabel}
                  </div>
                )}
              </div>
            </section>
          </section>

          <aside className="github-overview-side" aria-label={t("web.a11y.githubRecentActivity")}>
            <dl className="github-overview-stats" aria-label={t("web.a11y.repositoryStats")}>
              <div
                aria-label={`${t("web.github.stars")} ${githubStarCountLabel}`}
                className="github-overview-stat"
                data-metric="st"
                data-label={t("web.github.stars")}
                title={t("web.github.stars")}
              >
                <dt>
                  <span aria-hidden="true" className="github-overview-stat-icon">
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                      <path d="M8 1.5 9.9 5.5 14.3 6 11 9.1 11.9 13.5 8 11.3 4.1 13.5 5 9.1 1.7 6 6.1 5.5z" />
                    </svg>
                  </span>
                </dt>
                <dd>{githubStarCountLabel}</dd>
              </div>
              <div
                aria-label={`${t("web.github.openIssues")} ${githubOpenIssuesLabel}`}
                className="github-overview-stat"
                data-metric="is"
                data-label={t("web.github.openIssues")}
                title={t("web.github.openIssues")}
              >
                <dt>
                  <span aria-hidden="true" className="github-overview-stat-icon">
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                      <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2z" />
                      <path d="M8 5.1v3.6m0 2.2h.01" />
                    </svg>
                  </span>
                </dt>
                <dd>{githubOpenIssuesLabel}</dd>
              </div>
              <div
                aria-label={`${t("web.github.openPrs")} ${githubOpenPrsLabel}`}
                className="github-overview-stat"
                data-metric="pr"
                data-label={t("web.github.openPrs")}
                title={t("web.github.openPrs")}
              >
                <dt>
                  <span aria-hidden="true" className="github-overview-stat-icon">
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                      <path d="M5 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM11 9.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 6.5v7m0-3.5h4.2" />
                    </svg>
                  </span>
                </dt>
                <dd>{githubOpenPrsLabel}</dd>
              </div>
              <div
                aria-label={`${t("web.github.commits30d")} ${githubCommitCount30d}`}
                className="github-overview-stat"
                data-metric="30d"
                data-label={t("web.github.commits30d")}
                title={t("web.github.commits30d")}
              >
                <dt>
                  <span aria-hidden="true" className="github-overview-stat-icon">
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                      <path d="M2 11.8h12M4 9.7l2.2-2.2 2 1.7L12 5.6" />
                    </svg>
                  </span>
                </dt>
                <dd>{githubCommitCount30d}</dd>
              </div>
            </dl>
            <section
              className="github-overview-recent"
              aria-label={t("web.a11y.recentCommits")}
              ref={recentSectionRef}
            >
              <header className="github-overview-recent-header">
                <h3>{t("web.github.recentCommits")}</h3>
                <span>{t("web.github.showingLast", { count: GITHUB_RECENT_COMMITS_LIMIT })}</span>
              </header>
              {githubRecentCommits.length > 0 ? (
                <ol className="github-overview-recent-list">
                  {githubRecentCommits.map((commit) => (
                    <li key={commit.hash}>
                      <button
                        type="button"
                        className={`github-overview-recent-item${pinnedCommitHash === commit.hash ? " is-selected" : ""}`}
                        onMouseEnter={(event) => {
                          if (pinnedCommitHash) {
                            return;
                          }
                          setHoveredCommitHash(commit.hash);
                          const sectionRect = recentSectionRef.current?.getBoundingClientRect();
                          if (sectionRect) {
                            const itemRect = event.currentTarget.getBoundingClientRect();
                            setCommitTooltipY(itemRect.top - sectionRect.top + itemRect.height / 2);
                          }
                        }}
                        onMouseLeave={() => {
                          if (pinnedCommitHash) {
                            return;
                          }
                          setHoveredCommitHash(null);
                          setCommitTooltipY(null);
                        }}
                        onClick={(event) => {
                          if (pinnedCommitHash === commit.hash) {
                            dismissCommitTooltip();
                            return;
                          }
                          setPinnedCommitHash(commit.hash);
                          const sectionRect = recentSectionRef.current?.getBoundingClientRect();
                          if (sectionRect) {
                            const itemRect = event.currentTarget.getBoundingClientRect();
                            setCommitTooltipY(itemRect.top - sectionRect.top + itemRect.height / 2);
                          }
                        }}
                      >
                        <span aria-hidden="true" className="github-overview-recent-node" />
                        <span className="github-overview-recent-sha">{commit.shortHash}</span>
                        <div className="github-overview-recent-copy">
                          <p className="github-overview-recent-subject">{commit.subject}</p>
                          <p className="github-overview-recent-meta">
                            <span>{commit.authorName}</span>
                            <span>{formatRecentCommitTimestamp(commit.authoredAt, locale)}</span>
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="github-overview-recent-empty">{t("web.github.noData")}</p>
              )}
              <div
                ref={tooltipRef}
                className={`github-overview-recent-tooltip${activeCommit ? " is-visible" : ""}`}
                style={{
                  top: commitTooltipY !== null ? `${commitTooltipY}px` : undefined,
                }}
              >
                {activeCommit && (
                  <>
                    <p className="github-overview-recent-tooltip-hash">
                      <span>{activeCommit.shortHash}</span>
                      <button
                        className="github-overview-recent-tooltip-copy"
                        type="button"
                        title={t("web.github.copyHash")}
                        onClick={() => {
                          navigator.clipboard.writeText(activeCommit.hash);
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
                          <path d="M10.5 5.5V3.7a1.2 1.2 0 0 0-1.2-1.2H3.7a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2H5.5" />
                        </svg>
                      </button>
                    </p>
                    <p className="github-overview-recent-tooltip-author">
                      {activeCommit.authorName}
                      {activeCommit.authorEmail ? ` <${activeCommit.authorEmail}>` : ""}
                    </p>
                    <p className="github-overview-recent-tooltip-message">
                      {activeCommit.body
                        ? `${activeCommit.subject}\n\n${activeCommit.body}`
                        : activeCommit.subject}
                    </p>
                    {activeCommit.filesChanged > 0 && (
                      <p className="github-overview-recent-tooltip-diff">
                        <span>
                          {activeCommit.filesChanged}{" "}
                          {activeCommit.filesChanged === 1
                            ? t("web.github.file")
                            : t("web.github.files")}
                        </span>
                        <span className="github-overview-recent-tooltip-ins">
                          +{activeCommit.insertions}
                        </span>
                        <span className="github-overview-recent-tooltip-del">
                          -{activeCommit.deletions}
                        </span>
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </section>
  );
};
