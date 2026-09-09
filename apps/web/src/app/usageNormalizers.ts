import { asNumber, asRecord, asString } from "@octogent/core";

import type { ClaudeUsageSnapshot, CodexUsageSnapshot } from "./types";

export const normalizeCodexUsageSnapshot = (value: unknown): CodexUsageSnapshot | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const status = record.status;
  if (status !== "ok" && status !== "unavailable" && status !== "error") {
    return null;
  }

  const source = record.source === "oauth-api" ? "oauth-api" : "none";
  return {
    status,
    source,
    fetchedAt: asString(record.fetchedAt) ?? new Date().toISOString(),
    message: asString(record.message),
    planType: asString(record.planType),
    primaryUsedPercent: asNumber(record.primaryUsedPercent),
    secondaryUsedPercent: asNumber(record.secondaryUsedPercent),
    creditsBalance: asNumber(record.creditsBalance),
    creditsUnlimited: typeof record.creditsUnlimited === "boolean" ? record.creditsUnlimited : null,
  };
};

export const normalizeClaudeUsageSnapshot = (value: unknown): ClaudeUsageSnapshot | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const status = record.status;
  if (status !== "ok" && status !== "unavailable" && status !== "error") {
    return null;
  }

  const source =
    record.source === "cli-pty" ? "cli-pty" : record.source === "oauth-api" ? "oauth-api" : "none";
  return {
    status,
    source,
    fetchedAt: asString(record.fetchedAt) ?? new Date().toISOString(),
    message: asString(record.message),
    planType: asString(record.planType),
    primaryUsedPercent: asNumber(record.primaryUsedPercent),
    primaryResetAt: asString(record.primaryResetAt),
    secondaryUsedPercent: asNumber(record.secondaryUsedPercent),
    secondaryResetAt: asString(record.secondaryResetAt),
    sonnetUsedPercent: asNumber(record.sonnetUsedPercent),
    sonnetResetAt: asString(record.sonnetResetAt),
    scopedUsedPercent: asNumber(record.scopedUsedPercent),
    scopedResetAt: asString(record.scopedResetAt),
    scopedLabel: asString(record.scopedLabel),
    extraUsageCostUsed: asNumber(record.extraUsageCostUsed),
    extraUsageCostLimit: asNumber(record.extraUsageCostLimit),
  };
};
