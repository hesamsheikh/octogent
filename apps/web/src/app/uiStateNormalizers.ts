import { SUPPORTED_LOCALES, asRecord } from "@octogent/core";
import type { Locale } from "@octogent/core";

import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, PRIMARY_NAV_MAX } from "./constants";
import type { PrimaryNavIndex } from "./constants";
import { isTerminalCompletionSoundId } from "./notificationSounds";
import type { FrontendUiStateSnapshot } from "./types";

// Nav schema 2 puts the flow view first and shifts the original pages up by
// one. A snapshot without the version stamp predates that order, so its index
// is remapped once; the legacy preview slot 9 (where flow briefly lived) maps
// back to the new first page.
export const NAV_SCHEMA_VERSION = 2;

const migrateNavIndex = (index: PrimaryNavIndex, version: unknown): PrimaryNavIndex => {
  if (version === NAV_SCHEMA_VERSION) {
    return index;
  }
  const shifted = index >= PRIMARY_NAV_MAX ? 1 : index + 1;
  return shifted as PrimaryNavIndex;
};

export const clampSidebarWidth = (width: number) =>
  Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));

export const normalizeFrontendUiStateSnapshot = (
  value: unknown,
): FrontendUiStateSnapshot | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const nextState: FrontendUiStateSnapshot = {};
  if (
    typeof record.activePrimaryNav === "number" &&
    Number.isInteger(record.activePrimaryNav) &&
    record.activePrimaryNav >= 1 &&
    record.activePrimaryNav <= PRIMARY_NAV_MAX
  ) {
    nextState.activePrimaryNav = migrateNavIndex(
      record.activePrimaryNav as PrimaryNavIndex,
      record.navSchemaVersion,
    );
  }
  nextState.navSchemaVersion = NAV_SCHEMA_VERSION;

  // Without this the language picker never survived a reload: the persisted
  // snapshot round-trips through here, and an unhandled field is dropped.
  if (typeof record.locale === "string" && SUPPORTED_LOCALES.includes(record.locale as Locale)) {
    nextState.locale = record.locale as Locale;
  }

  if (typeof record.isAgentsSidebarVisible === "boolean") {
    nextState.isAgentsSidebarVisible = record.isAgentsSidebarVisible;
  }

  if (typeof record.sidebarWidth === "number" && Number.isFinite(record.sidebarWidth)) {
    nextState.sidebarWidth = clampSidebarWidth(record.sidebarWidth);
  }

  if (typeof record.isActiveAgentsSectionExpanded === "boolean") {
    nextState.isActiveAgentsSectionExpanded = record.isActiveAgentsSectionExpanded;
  }

  if (typeof record.isRuntimeStatusStripVisible === "boolean") {
    nextState.isRuntimeStatusStripVisible = record.isRuntimeStatusStripVisible;
  }

  if (typeof record.isMonitorVisible === "boolean") {
    nextState.isMonitorVisible = record.isMonitorVisible;
  }

  if (typeof record.isBottomTelemetryVisible === "boolean") {
    nextState.isBottomTelemetryVisible = record.isBottomTelemetryVisible;
  }

  if (typeof record.isCodexUsageVisible === "boolean") {
    nextState.isCodexUsageVisible = record.isCodexUsageVisible;
  }

  if (typeof record.isClaudeUsageVisible === "boolean") {
    nextState.isClaudeUsageVisible = record.isClaudeUsageVisible;
  }

  if (typeof record.isCodexUsageSectionExpanded === "boolean") {
    nextState.isCodexUsageSectionExpanded = record.isCodexUsageSectionExpanded;
  }

  if (typeof record.isClaudeUsageSectionExpanded === "boolean") {
    nextState.isClaudeUsageSectionExpanded = record.isClaudeUsageSectionExpanded;
  }

  const completionSoundValue = record.terminalCompletionSound;
  if (isTerminalCompletionSoundId(completionSoundValue)) {
    nextState.terminalCompletionSound = completionSoundValue;
  }

  const minimizedIdsValue = record.minimizedTerminalIds;
  if (Array.isArray(minimizedIdsValue)) {
    nextState.minimizedTerminalIds = [...new Set(minimizedIdsValue)].filter(
      (id): id is string => typeof id === "string",
    );
  }

  const rawTerminalWidths = asRecord(record.terminalWidths);
  if (rawTerminalWidths) {
    nextState.terminalWidths = Object.entries(rawTerminalWidths).reduce<Record<string, number>>(
      (acc, [terminalId, width]) => {
        if (typeof width === "number" && Number.isFinite(width)) {
          acc[terminalId] = width;
        }
        return acc;
      },
      {},
    );
  }

  if (Array.isArray(record.canvasOpenTerminalIds)) {
    nextState.canvasOpenTerminalIds = record.canvasOpenTerminalIds.filter(
      (id): id is string => typeof id === "string",
    );
  }

  if (Array.isArray(record.canvasOpenTentacleIds)) {
    nextState.canvasOpenTentacleIds = record.canvasOpenTentacleIds.filter(
      (id): id is string => typeof id === "string",
    );
  }

  if (
    typeof record.canvasTerminalsPanelWidth === "number" &&
    Number.isFinite(record.canvasTerminalsPanelWidth)
  ) {
    nextState.canvasTerminalsPanelWidth = record.canvasTerminalsPanelWidth;
  }

  return nextState;
};
