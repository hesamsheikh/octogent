import { SUPPORTED_LOCALES } from "@octogent/core";
import { type PersistedUiState, isTerminalCompletionSoundId } from "../terminalRuntime";

export const parseUiStatePatch = (
  payload: unknown,
): { patch: PersistedUiState | null; error: string | null } => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return {
      patch: null,
      error: "Expected a JSON object body.",
    };
  }

  const record = payload as Record<string, unknown>;
  const patch: PersistedUiState = {};

  if (record.activePrimaryNav !== undefined) {
    if (
      typeof record.activePrimaryNav !== "number" ||
      !Number.isInteger(record.activePrimaryNav) ||
      record.activePrimaryNav < 1
    ) {
      return {
        patch: null,
        error: "activePrimaryNav must be a positive integer.",
      };
    }
    patch.activePrimaryNav = record.activePrimaryNav;
  }

  // Dropping this field replays the nav-index migration on every load, which
  // shifts the restored page by one per refresh.
  if (record.navSchemaVersion !== undefined) {
    if (
      typeof record.navSchemaVersion !== "number" ||
      !Number.isInteger(record.navSchemaVersion) ||
      record.navSchemaVersion < 1
    ) {
      return {
        patch: null,
        error: "navSchemaVersion must be a positive integer.",
      };
    }
    patch.navSchemaVersion = record.navSchemaVersion;
  }

  if (record.isAgentsSidebarVisible !== undefined) {
    if (typeof record.isAgentsSidebarVisible !== "boolean") {
      return {
        patch: null,
        error: "isAgentsSidebarVisible must be a boolean.",
      };
    }
    patch.isAgentsSidebarVisible = record.isAgentsSidebarVisible;
  }

  if (record.sidebarWidth !== undefined) {
    if (typeof record.sidebarWidth !== "number" || !Number.isFinite(record.sidebarWidth)) {
      return {
        patch: null,
        error: "sidebarWidth must be a finite number.",
      };
    }
    patch.sidebarWidth = record.sidebarWidth;
  }

  if (record.isActiveAgentsSectionExpanded !== undefined) {
    if (typeof record.isActiveAgentsSectionExpanded !== "boolean") {
      return {
        patch: null,
        error: "isActiveAgentsSectionExpanded must be a boolean.",
      };
    }
    patch.isActiveAgentsSectionExpanded = record.isActiveAgentsSectionExpanded;
  }

  if (record.isRuntimeStatusStripVisible !== undefined) {
    if (typeof record.isRuntimeStatusStripVisible !== "boolean") {
      return {
        patch: null,
        error: "isRuntimeStatusStripVisible must be a boolean.",
      };
    }
    patch.isRuntimeStatusStripVisible = record.isRuntimeStatusStripVisible;
  }

  if (record.isMonitorVisible !== undefined) {
    if (typeof record.isMonitorVisible !== "boolean") {
      return {
        patch: null,
        error: "isMonitorVisible must be a boolean.",
      };
    }
    patch.isMonitorVisible = record.isMonitorVisible;
  }

  if (record.isBottomTelemetryVisible !== undefined) {
    if (typeof record.isBottomTelemetryVisible !== "boolean") {
      return {
        patch: null,
        error: "isBottomTelemetryVisible must be a boolean.",
      };
    }
    patch.isBottomTelemetryVisible = record.isBottomTelemetryVisible;
  }

  if (record.isCodexUsageVisible !== undefined) {
    if (typeof record.isCodexUsageVisible !== "boolean") {
      return {
        patch: null,
        error: "isCodexUsageVisible must be a boolean.",
      };
    }
    patch.isCodexUsageVisible = record.isCodexUsageVisible;
  }

  if (record.isClaudeUsageVisible !== undefined) {
    if (typeof record.isClaudeUsageVisible !== "boolean") {
      return {
        patch: null,
        error: "isClaudeUsageVisible must be a boolean.",
      };
    }
    patch.isClaudeUsageVisible = record.isClaudeUsageVisible;
  }

  if (record.isClaudeUsageSectionExpanded !== undefined) {
    if (typeof record.isClaudeUsageSectionExpanded !== "boolean") {
      return {
        patch: null,
        error: "isClaudeUsageSectionExpanded must be a boolean.",
      };
    }
    patch.isClaudeUsageSectionExpanded = record.isClaudeUsageSectionExpanded;
  }

  if (record.isCodexUsageSectionExpanded !== undefined) {
    if (typeof record.isCodexUsageSectionExpanded !== "boolean") {
      return {
        patch: null,
        error: "isCodexUsageSectionExpanded must be a boolean.",
      };
    }
    patch.isCodexUsageSectionExpanded = record.isCodexUsageSectionExpanded;
  }

  const completionSoundKey = record.terminalCompletionSound;
  if (completionSoundKey !== undefined) {
    if (!isTerminalCompletionSoundId(completionSoundKey)) {
      return {
        patch: null,
        error: "terminalCompletionSound must be one of the supported sound identifiers.",
      };
    }
    patch.terminalCompletionSound = completionSoundKey;
  }

  const minimizedKey = record.minimizedTerminalIds;
  if (minimizedKey !== undefined) {
    if (!Array.isArray(minimizedKey)) {
      return {
        patch: null,
        error: "minimizedTerminalIds must be an array of strings.",
      };
    }

    const minimizedTerminalIds = minimizedKey.filter((id): id is string => typeof id === "string");
    if (minimizedTerminalIds.length !== minimizedKey.length) {
      return {
        patch: null,
        error: "minimizedTerminalIds must be an array of strings.",
      };
    }
    patch.minimizedTerminalIds = [...new Set(minimizedTerminalIds)];
  }

  const widthsKey = record.terminalWidths;
  if (widthsKey !== undefined) {
    if (widthsKey === null || typeof widthsKey !== "object" || Array.isArray(widthsKey)) {
      return {
        patch: null,
        error: "terminalWidths must be an object map of numbers.",
      };
    }

    const terminalWidths = Object.entries(widthsKey).reduce<Record<string, number>>(
      (acc, [id, width]) => {
        if (typeof width === "number" && Number.isFinite(width)) {
          acc[id] = width;
        }
        return acc;
      },
      {},
    );
    if (Object.keys(terminalWidths).length !== Object.keys(widthsKey).length) {
      return {
        patch: null,
        error: "terminalWidths must be an object map of numbers.",
      };
    }
    patch.terminalWidths = terminalWidths;
  }

  if (record.canvasOpenTerminalIds !== undefined) {
    if (!Array.isArray(record.canvasOpenTerminalIds)) {
      return {
        patch: null,
        error: "canvasOpenTerminalIds must be an array of strings.",
      };
    }

    const canvasOpenTerminalIds = record.canvasOpenTerminalIds.filter(
      (id): id is string => typeof id === "string",
    );
    if (canvasOpenTerminalIds.length !== record.canvasOpenTerminalIds.length) {
      return {
        patch: null,
        error: "canvasOpenTerminalIds must be an array of strings.",
      };
    }
    patch.canvasOpenTerminalIds = canvasOpenTerminalIds;
  }

  if (record.canvasOpenTentacleIds !== undefined) {
    if (!Array.isArray(record.canvasOpenTentacleIds)) {
      return {
        patch: null,
        error: "canvasOpenTentacleIds must be an array of strings.",
      };
    }

    const canvasOpenTentacleIds = record.canvasOpenTentacleIds.filter(
      (id): id is string => typeof id === "string",
    );
    if (canvasOpenTentacleIds.length !== record.canvasOpenTentacleIds.length) {
      return {
        patch: null,
        error: "canvasOpenTentacleIds must be an array of strings.",
      };
    }
    patch.canvasOpenTentacleIds = canvasOpenTentacleIds;
  }

  if (record.canvasTerminalsPanelWidth !== undefined) {
    if (
      typeof record.canvasTerminalsPanelWidth !== "number" ||
      !Number.isFinite(record.canvasTerminalsPanelWidth)
    ) {
      return {
        patch: null,
        error: "canvasTerminalsPanelWidth must be a finite number.",
      };
    }
    patch.canvasTerminalsPanelWidth = record.canvasTerminalsPanelWidth;
  }

  if (record.terminalInactivityThresholdMs !== undefined) {
    if (
      typeof record.terminalInactivityThresholdMs !== "number" ||
      !Number.isFinite(record.terminalInactivityThresholdMs) ||
      record.terminalInactivityThresholdMs <= 0
    ) {
      return {
        patch: null,
        error: "terminalInactivityThresholdMs must be a positive number.",
      };
    }
    patch.terminalInactivityThresholdMs = record.terminalInactivityThresholdMs;
  }

  if (record.locale !== undefined) {
    if (
      typeof record.locale !== "string" ||
      !SUPPORTED_LOCALES.includes(record.locale as (typeof SUPPORTED_LOCALES)[number])
    ) {
      return {
        patch: null,
        error: "locale must be one of: en, zh-CN.",
      };
    }
    patch.locale = record.locale;
  }

  return { patch, error: null };
};
