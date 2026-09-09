import { useEffect, useMemo, useRef, useState } from "react";

import { GITHUB_SPARKLINE_HEIGHT, GITHUB_SPARKLINE_WIDTH } from "../app/constants";
import type { UsageChartData } from "../app/hooks/useUsageHeatmapPolling";
import { useT } from "../app/providers/LocaleProvider";
import type { ClaudeUsageSnapshot } from "../app/types";
import { OctopusGlyph } from "./EmptyOctopus";

type RuntimeStatusStripProps = {
  sparklinePoints: string;
  usageData: UsageChartData | null;
  claudeUsage: ClaudeUsageSnapshot | null;
  isRefreshingClaudeUsage?: boolean;
  onRefreshClaudeUsage?: () => void;
};

const MINI_USAGE_WIDTH = 160;
const MINI_USAGE_HEIGHT = 28;
const MINI_BAR_GAP = 1;

type MiniBar = { x: number; y: number; width: number; height: number };

const buildUsageBars = (data: UsageChartData): MiniBar[] => {
  const days = Array.isArray(data.days) ? data.days.slice(-30) : [];
  if (days.length === 0) return [];

  const totals = days.map((day) => (typeof day.totalTokens === "number" ? day.totalTokens : 0));
  const max = Math.max(...totals, 1);
  const barSlot = MINI_USAGE_WIDTH / days.length;
  const barWidth = Math.max(1, barSlot - MINI_BAR_GAP);

  return days.map((day, index) => {
    const totalTokens = typeof day.totalTokens === "number" ? day.totalTokens : 0;
    const h = Math.max(0.5, (totalTokens / max) * (MINI_USAGE_HEIGHT - 2));
    return {
      x: index * barSlot,
      y: MINI_USAGE_HEIGHT - h,
      width: barWidth,
      height: h,
    };
  });
};

const pct = (
  value: number | null | undefined,
  loading?: boolean,
  t?: (key: string, params?: Record<string, string | number>) => string,
): string => {
  if (loading) return "···";
  return value == null ? (t ? t("web.status.na") : "NA") : `${Math.round(value)}%`;
};

const usageState = (
  claudeUsage: ClaudeUsageSnapshot | null,
  t: (key: string, params?: Record<string, string | number>) => string,
): {
  label: string;
  loading: boolean;
  sessionPercent: number | null | undefined;
  weekPercent: number | null | undefined;
  scopedPercent?: number | null;
  scopedLabel?: string | null;
  message?: string;
} => {
  if (claudeUsage === null) {
    return {
      label: t("web.status.session"),
      loading: true,
      sessionPercent: 0,
      weekPercent: 0,
    };
  }

  const label =
    claudeUsage.source === "oauth-api" ? t("web.status.fiveHours") : t("web.status.session");
  if (claudeUsage.status === "ok") {
    return {
      label,
      loading: false,
      sessionPercent: claudeUsage.primaryUsedPercent,
      weekPercent: claudeUsage.secondaryUsedPercent,
      scopedPercent: claudeUsage.scopedUsedPercent ?? null,
      scopedLabel: claudeUsage.scopedLabel ?? null,
    };
  }

  return {
    label,
    loading: false,
    sessionPercent: null,
    weekPercent: null,
    message: claudeUsage.message ?? t("web.status.usageUnavailable"),
  };
};

const UsageRail = ({
  label,
  percent,
  loading,
  title,
  t: tFn,
}: {
  label: string;
  percent: number | null | undefined;
  loading?: boolean;
  title?: string;
  t?: (key: string, params?: Record<string, string | number>) => string;
}) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  const showTooltip = (clientX: number, clientY: number) => {
    if (!title) return;
    setTooltip({ x: clientX, y: clientY });
  };

  return (
    <div
      className="console-status-usage-row"
      data-has-tooltip={title ? "true" : undefined}
      tabIndex={title ? 0 : -1}
      onMouseEnter={(event) => showTooltip(event.clientX, event.clientY)}
      onMouseMove={(event) => showTooltip(event.clientX, event.clientY)}
      onMouseLeave={() => setTooltip(null)}
      onBlur={() => setTooltip(null)}
      onFocus={(event) => {
        if (!title) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setTooltip({ x: rect.left + 24, y: rect.bottom + 8 });
      }}
    >
      <span className="console-status-usage-row-meta">
        <span className="console-status-usage-row-label">{label}</span>
        <span className="console-status-usage-row-value">{pct(percent, loading, tFn)}</span>
      </span>
      <span className="console-status-usage-rail">
        <span
          className="console-status-usage-rail-fill"
          style={{ width: `${Math.min(100, percent ?? 0)}%` }}
        />
      </span>
      {title && tooltip ? (
        <span
          className="console-status-usage-tooltip"
          style={{
            left: `${Math.max(8, tooltip.x - 260)}px`,
            top: `${Math.min(window.innerHeight - 80, tooltip.y + 14)}px`,
          }}
        >
          {title}
        </span>
      ) : null}
    </div>
  );
};

export const RuntimeStatusStrip = ({
  sparklinePoints,
  usageData,
  claudeUsage,
  isRefreshingClaudeUsage = false,
  onRefreshClaudeUsage,
}: RuntimeStatusStripProps) => {
  const t = useT();
  const usageBars = useMemo(() => (usageData ? buildUsageBars(usageData) : []), [usageData]);
  const claudeUsageState = usageState(claudeUsage, t);
  const [showRefreshSpin, setShowRefreshSpin] = useState(false);
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (refreshHideTimerRef.current !== null) {
        window.clearTimeout(refreshHideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isRefreshingClaudeUsage) {
      if (refreshHideTimerRef.current !== null) {
        window.clearTimeout(refreshHideTimerRef.current);
        refreshHideTimerRef.current = null;
      }
      refreshStartedAtRef.current = Date.now();
      setShowRefreshSpin(true);
      return;
    }

    if (refreshStartedAtRef.current === null) {
      setShowRefreshSpin(false);
      return;
    }

    const elapsedMs = Date.now() - refreshStartedAtRef.current;
    const remainingMs = Math.max(0, 450 - elapsedMs);
    refreshHideTimerRef.current = window.setTimeout(() => {
      setShowRefreshSpin(false);
      refreshStartedAtRef.current = null;
      refreshHideTimerRef.current = null;
    }, remainingMs);
  }, [isRefreshingClaudeUsage]);

  return (
    <section className="console-status-strip" aria-label={t("web.a11y.runtimeStatusStrip")}>
      <div className="console-status-main">
        <OctopusGlyph
          className="console-status-octopus-icon"
          animation="sway"
          expression="normal"
          scale={2}
        />
        <span className="console-status-brand">{t("web.status.brand")}</span>
      </div>
      <div className="console-status-charts">
        <div className="console-status-sparkline" aria-label={t("web.a11y.commitsPerDay30d")}>
          <div className="console-status-sparkline-chart">
            <svg
              viewBox={`0 0 ${GITHUB_SPARKLINE_WIDTH} ${GITHUB_SPARKLINE_HEIGHT}`}
              role="presentation"
            >
              <polyline points={sparklinePoints} />
            </svg>
          </div>
          <span className="console-status-sparkline-label">{t("web.status.commitsPerDay")}</span>
        </div>
        <div className="console-status-usage-mini" aria-label={t("web.a11y.claudeTokenUsage30d")}>
          {usageBars.length > 0 ? (
            <>
              <div className="console-status-usage-mini-chart">
                <svg viewBox={`0 0 ${MINI_USAGE_WIDTH} ${MINI_USAGE_HEIGHT}`} role="presentation">
                  {usageBars.map((bar, index) => (
                    <rect
                      key={`${index}-${bar.x}-${bar.height}`}
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                      rx={0.5}
                    />
                  ))}
                </svg>
              </div>
              <span className="console-status-sparkline-label">{t("web.status.tokensPerDay")}</span>
            </>
          ) : (
            <span className="console-status-sparkline-label">
              {t("web.status.claudeUsageDash")}
            </span>
          )}
        </div>
      </div>
      <div className="console-status-claude-usage" aria-label={t("web.a11y.claudeUsageLimits")}>
        {onRefreshClaudeUsage && (
          <button
            type="button"
            className="console-status-claude-usage-refresh"
            onClick={onRefreshClaudeUsage}
            aria-label={t("web.status.refreshUsage")}
            title={t("web.status.refreshUsage")}
            data-refreshing={showRefreshSpin ? "true" : "false"}
          >
            ↻
          </button>
        )}
        <span className="console-status-claude-usage-title">
          CLAUDE
          <br />
          USAGE
        </span>
        <div className="console-status-claude-usage-bars">
          <UsageRail
            label={claudeUsageState.label}
            percent={claudeUsageState.sessionPercent}
            loading={claudeUsageState.loading}
            t={t}
            {...(claudeUsageState.message ? { title: claudeUsageState.message } : {})}
          />
          <UsageRail
            label={t("web.status.weekAll")}
            percent={claudeUsageState.weekPercent}
            loading={claudeUsageState.loading}
            t={t}
            {...(claudeUsageState.message ? { title: claudeUsageState.message } : {})}
          />
          {claudeUsageState.scopedPercent != null ? (
            <UsageRail
              label={t("web.status.weekScoped", {
                model: claudeUsageState.scopedLabel ?? "—",
              })}
              percent={claudeUsageState.scopedPercent}
              loading={claudeUsageState.loading}
              t={t}
              {...(claudeUsageState.message ? { title: claudeUsageState.message } : {})}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
};
