import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { DEFAULT_LOCALE, type Locale } from "@octogent/core";
import { buildUiStateUrl } from "../../runtime/runtimeEndpoints";
import type { PrimaryNavIndex } from "../constants";
import { MIN_SIDEBAR_WIDTH, PRIMARY_NAV_ITEMS, UI_STATE_SAVE_DEBOUNCE_MS } from "../constants";
import {
  DEFAULT_TERMINAL_COMPLETION_SOUND,
  type TerminalCompletionSoundId,
} from "../notificationSounds";
import { retainActiveTerminalEntries, retainActiveTerminalIds } from "../terminalState";
import type { FrontendUiStateSnapshot, TerminalView } from "../types";
import {
  NAV_SCHEMA_VERSION,
  clampSidebarWidth,
  normalizeFrontendUiStateSnapshot,
} from "../uiStateNormalizers";

type UsePersistedUiStateOptions = {
  columns: TerminalView;
};

const DEFAULT_ACTIVE_PRIMARY_NAV: PrimaryNavIndex = 1;
const DEFAULT_IS_AGENTS_SIDEBAR_VISIBLE = true;
const DEFAULT_IS_ACTIVE_AGENTS_SECTION_EXPANDED = true;
const DEFAULT_IS_RUNTIME_STATUS_STRIP_VISIBLE = true;
const DEFAULT_IS_MONITOR_VISIBLE = true;
const DEFAULT_IS_BOTTOM_TELEMETRY_VISIBLE = true;
const DEFAULT_IS_CODEX_USAGE_VISIBLE = true;
const DEFAULT_IS_CLAUDE_USAGE_VISIBLE = true;
const DEFAULT_IS_CLAUDE_USAGE_SECTION_EXPANDED = true;
const DEFAULT_IS_CODEX_USAGE_SECTION_EXPANDED = true;
const DEFAULT_MINIMIZED_TERMINAL_IDS: string[] = [];
const DEFAULT_TERMINAL_WIDTHS: Record<string, number> = {};
const DEFAULT_CANVAS_OPEN_TERMINAL_IDS: string[] = [];
const DEFAULT_CANVAS_OPEN_TENTACLE_IDS: string[] = [];

const areStringArraysEqual = (left: string[] | undefined, right: string[] | undefined) => {
  if (left === right) {
    return true;
  }

  const nextLeft = left ?? [];
  const nextRight = right ?? [];
  if (nextLeft.length !== nextRight.length) {
    return false;
  }

  return nextLeft.every((value, index) => value === nextRight[index]);
};

const areNumberRecordMapsEqual = (
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
) => {
  if (left === right) {
    return true;
  }

  const leftEntries = Object.entries(left ?? {});
  const rightEntries = right ?? {};
  if (leftEntries.length !== Object.keys(rightEntries).length) {
    return false;
  }

  return leftEntries.every(([key, value]) => rightEntries[key] === value);
};

const buildPersistedUiStateSnapshot = ({
  activePrimaryNav,
  isAgentsSidebarVisible,
  sidebarWidth,
  isActiveAgentsSectionExpanded,
  isRuntimeStatusStripVisible,
  isMonitorVisible,
  isBottomTelemetryVisible,
  isCodexUsageVisible,
  isClaudeUsageVisible,
  isClaudeUsageSectionExpanded,
  isCodexUsageSectionExpanded,
  terminalCompletionSound,
  locale,
  minimizedTerminalIds,
  terminalWidths,
  canvasOpenTerminalIds,
  canvasOpenTentacleIds,
  canvasTerminalsPanelWidth,
}: {
  activePrimaryNav: PrimaryNavIndex;
  isAgentsSidebarVisible: boolean;
  sidebarWidth: number;
  isActiveAgentsSectionExpanded: boolean;
  isRuntimeStatusStripVisible: boolean;
  isMonitorVisible: boolean;
  isBottomTelemetryVisible: boolean;
  isCodexUsageVisible: boolean;
  isClaudeUsageVisible: boolean;
  isClaudeUsageSectionExpanded: boolean;
  isCodexUsageSectionExpanded: boolean;
  terminalCompletionSound: TerminalCompletionSoundId;
  locale: Locale;
  minimizedTerminalIds: string[];
  terminalWidths: Record<string, number>;
  canvasOpenTerminalIds: string[];
  canvasOpenTentacleIds: string[];
  canvasTerminalsPanelWidth: number | null;
}): FrontendUiStateSnapshot => ({
  activePrimaryNav,
  // Persist the schema stamp, or the server-side copy looks unmigrated and the
  // nav index gets shifted again on every reload.
  navSchemaVersion: NAV_SCHEMA_VERSION,
  isAgentsSidebarVisible,
  sidebarWidth: clampSidebarWidth(sidebarWidth),
  isActiveAgentsSectionExpanded,
  isRuntimeStatusStripVisible,
  isMonitorVisible,
  isBottomTelemetryVisible,
  isCodexUsageVisible,
  isClaudeUsageVisible,
  isClaudeUsageSectionExpanded,
  isCodexUsageSectionExpanded,
  terminalCompletionSound,
  locale,
  minimizedTerminalIds,
  terminalWidths,
  canvasOpenTerminalIds,
  canvasOpenTentacleIds,
  ...(canvasTerminalsPanelWidth != null ? { canvasTerminalsPanelWidth } : {}),
});

const areUiStateSnapshotsEqual = (
  left: FrontendUiStateSnapshot | null,
  right: FrontendUiStateSnapshot,
) =>
  left !== null &&
  left.activePrimaryNav === right.activePrimaryNav &&
  left.isAgentsSidebarVisible === right.isAgentsSidebarVisible &&
  left.sidebarWidth === right.sidebarWidth &&
  left.isActiveAgentsSectionExpanded === right.isActiveAgentsSectionExpanded &&
  left.isRuntimeStatusStripVisible === right.isRuntimeStatusStripVisible &&
  left.isMonitorVisible === right.isMonitorVisible &&
  left.isBottomTelemetryVisible === right.isBottomTelemetryVisible &&
  left.isCodexUsageVisible === right.isCodexUsageVisible &&
  left.isClaudeUsageVisible === right.isClaudeUsageVisible &&
  left.isClaudeUsageSectionExpanded === right.isClaudeUsageSectionExpanded &&
  left.isCodexUsageSectionExpanded === right.isCodexUsageSectionExpanded &&
  left.terminalCompletionSound === right.terminalCompletionSound &&
  left.locale === right.locale &&
  areStringArraysEqual(left.minimizedTerminalIds, right.minimizedTerminalIds) &&
  areNumberRecordMapsEqual(left.terminalWidths, right.terminalWidths) &&
  areStringArraysEqual(left.canvasOpenTerminalIds, right.canvasOpenTerminalIds) &&
  areStringArraysEqual(left.canvasOpenTentacleIds, right.canvasOpenTentacleIds) &&
  left.canvasTerminalsPanelWidth === right.canvasTerminalsPanelWidth;

type UsePersistedUiStateResult = {
  activePrimaryNav: PrimaryNavIndex;
  setActivePrimaryNav: Dispatch<SetStateAction<PrimaryNavIndex>>;
  isUiStateHydrated: boolean;
  setIsUiStateHydrated: Dispatch<SetStateAction<boolean>>;
  hasHydratedUiStateSnapshot: boolean;
  isAgentsSidebarVisible: boolean;
  setIsAgentsSidebarVisible: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  isActiveAgentsSectionExpanded: boolean;
  setIsActiveAgentsSectionExpanded: Dispatch<SetStateAction<boolean>>;
  isRuntimeStatusStripVisible: boolean;
  setIsRuntimeStatusStripVisible: Dispatch<SetStateAction<boolean>>;
  isMonitorVisible: boolean;
  setIsMonitorVisible: Dispatch<SetStateAction<boolean>>;
  isBottomTelemetryVisible: boolean;
  setIsBottomTelemetryVisible: Dispatch<SetStateAction<boolean>>;
  isCodexUsageVisible: boolean;
  setIsCodexUsageVisible: Dispatch<SetStateAction<boolean>>;
  isClaudeUsageVisible: boolean;
  setIsClaudeUsageVisible: Dispatch<SetStateAction<boolean>>;
  isClaudeUsageSectionExpanded: boolean;
  setIsClaudeUsageSectionExpanded: Dispatch<SetStateAction<boolean>>;
  isCodexUsageSectionExpanded: boolean;
  setIsCodexUsageSectionExpanded: Dispatch<SetStateAction<boolean>>;
  terminalCompletionSound: TerminalCompletionSoundId;
  setTerminalCompletionSound: Dispatch<SetStateAction<TerminalCompletionSoundId>>;
  locale: Locale;
  setLocale: Dispatch<SetStateAction<Locale>>;
  minimizedTerminalIds: string[];
  setMinimizedTerminalIds: Dispatch<SetStateAction<string[]>>;
  terminalWidths: Record<string, number>;
  setTerminalWidths: Dispatch<SetStateAction<Record<string, number>>>;
  canvasOpenTerminalIds: string[];
  setCanvasOpenTerminalIds: Dispatch<SetStateAction<string[]>>;
  canvasOpenTentacleIds: string[];
  setCanvasOpenTentacleIds: Dispatch<SetStateAction<string[]>>;
  canvasTerminalsPanelWidth: number | null;
  setCanvasTerminalsPanelWidth: Dispatch<SetStateAction<number | null>>;
  readUiState: (signal?: AbortSignal) => Promise<FrontendUiStateSnapshot | null>;
  applyHydratedUiState: (
    snapshot: FrontendUiStateSnapshot | null,
    nextColumns: TerminalView,
  ) => void;
};

export const usePersistedUiState = ({
  columns,
}: UsePersistedUiStateOptions): UsePersistedUiStateResult => {
  const [activePrimaryNav, setActivePrimaryNav] = useState<PrimaryNavIndex>(
    DEFAULT_ACTIVE_PRIMARY_NAV,
  );
  const [isAgentsSidebarVisible, setIsAgentsSidebarVisible] = useState(
    DEFAULT_IS_AGENTS_SIDEBAR_VISIBLE,
  );
  const [sidebarWidth, setSidebarWidth] = useState(MIN_SIDEBAR_WIDTH);
  const [isActiveAgentsSectionExpanded, setIsActiveAgentsSectionExpanded] = useState(
    DEFAULT_IS_ACTIVE_AGENTS_SECTION_EXPANDED,
  );
  const [isRuntimeStatusStripVisible, setIsRuntimeStatusStripVisible] = useState(
    DEFAULT_IS_RUNTIME_STATUS_STRIP_VISIBLE,
  );
  const [isMonitorVisible, setIsMonitorVisible] = useState(DEFAULT_IS_MONITOR_VISIBLE);
  const [isBottomTelemetryVisible, setIsBottomTelemetryVisible] = useState(
    DEFAULT_IS_BOTTOM_TELEMETRY_VISIBLE,
  );
  const [isCodexUsageVisible, setIsCodexUsageVisible] = useState(DEFAULT_IS_CODEX_USAGE_VISIBLE);
  const [isClaudeUsageVisible, setIsClaudeUsageVisible] = useState(DEFAULT_IS_CLAUDE_USAGE_VISIBLE);
  const [isClaudeUsageSectionExpanded, setIsClaudeUsageSectionExpanded] = useState(
    DEFAULT_IS_CLAUDE_USAGE_SECTION_EXPANDED,
  );
  const [isCodexUsageSectionExpanded, setIsCodexUsageSectionExpanded] = useState(
    DEFAULT_IS_CODEX_USAGE_SECTION_EXPANDED,
  );
  const [terminalCompletionSound, setTerminalCompletionSound] = useState<TerminalCompletionSoundId>(
    DEFAULT_TERMINAL_COMPLETION_SOUND,
  );
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [isUiStateHydrated, setIsUiStateHydrated] = useState(false);
  const [hasHydratedUiStateSnapshot, setHasHydratedUiStateSnapshot] = useState(false);
  const [minimizedTerminalIds, setMinimizedTerminalIds] = useState<string[]>(
    DEFAULT_MINIMIZED_TERMINAL_IDS,
  );
  const [terminalWidths, setTerminalWidths] =
    useState<Record<string, number>>(DEFAULT_TERMINAL_WIDTHS);
  const [canvasOpenTerminalIds, setCanvasOpenTerminalIds] = useState<string[]>(
    DEFAULT_CANVAS_OPEN_TERMINAL_IDS,
  );
  const [canvasOpenTentacleIds, setCanvasOpenTentacleIds] = useState<string[]>(
    DEFAULT_CANVAS_OPEN_TENTACLE_IDS,
  );
  const [canvasTerminalsPanelWidth, setCanvasTerminalsPanelWidth] = useState<number | null>(null);
  const lastPersistedUiStateRef = useRef<FrontendUiStateSnapshot | null>(null);

  const readUiState = useCallback(async (signal?: AbortSignal) => {
    try {
      const requestOptions: {
        method: "GET";
        headers: { Accept: string };
        signal?: AbortSignal;
      } = {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      };
      if (signal) {
        requestOptions.signal = signal;
      }

      const response = await fetch(buildUiStateUrl(), requestOptions);
      if (!response.ok) {
        return null;
      }

      return normalizeFrontendUiStateSnapshot(await response.json());
    } catch {
      return null;
    }
  }, []);

  const applyHydratedUiState = useCallback(
    (snapshot: FrontendUiStateSnapshot | null, nextColumns: TerminalView) => {
      const activeTerminalIds = new Set(nextColumns.map((entry) => entry.terminalId));
      const activeTentacleIds = new Set(nextColumns.map((entry) => entry.tentacleId));
      const hasPersistedSnapshot = snapshot !== null && Object.keys(snapshot).length > 0;
      setHasHydratedUiStateSnapshot(hasPersistedSnapshot);

      if (!snapshot) {
        lastPersistedUiStateRef.current = buildPersistedUiStateSnapshot({
          activePrimaryNav: DEFAULT_ACTIVE_PRIMARY_NAV,
          isAgentsSidebarVisible: DEFAULT_IS_AGENTS_SIDEBAR_VISIBLE,
          sidebarWidth: MIN_SIDEBAR_WIDTH,
          isActiveAgentsSectionExpanded: DEFAULT_IS_ACTIVE_AGENTS_SECTION_EXPANDED,
          isRuntimeStatusStripVisible: DEFAULT_IS_RUNTIME_STATUS_STRIP_VISIBLE,
          isMonitorVisible: DEFAULT_IS_MONITOR_VISIBLE,
          isBottomTelemetryVisible: DEFAULT_IS_BOTTOM_TELEMETRY_VISIBLE,
          isCodexUsageVisible: DEFAULT_IS_CODEX_USAGE_VISIBLE,
          isClaudeUsageVisible: DEFAULT_IS_CLAUDE_USAGE_VISIBLE,
          isClaudeUsageSectionExpanded: DEFAULT_IS_CLAUDE_USAGE_SECTION_EXPANDED,
          isCodexUsageSectionExpanded: DEFAULT_IS_CODEX_USAGE_SECTION_EXPANDED,
          terminalCompletionSound: DEFAULT_TERMINAL_COMPLETION_SOUND,
          locale: DEFAULT_LOCALE,
          minimizedTerminalIds: DEFAULT_MINIMIZED_TERMINAL_IDS,
          terminalWidths: DEFAULT_TERMINAL_WIDTHS,
          canvasOpenTerminalIds: DEFAULT_CANVAS_OPEN_TERMINAL_IDS,
          canvasOpenTentacleIds: DEFAULT_CANVAS_OPEN_TENTACLE_IDS,
          canvasTerminalsPanelWidth: null,
        });
        return;
      }

      const nextMinimizedTerminalIds = snapshot.minimizedTerminalIds
        ? retainActiveTerminalIds(snapshot.minimizedTerminalIds, activeTerminalIds)
        : DEFAULT_MINIMIZED_TERMINAL_IDS;
      const nextTerminalWidths = snapshot.terminalWidths
        ? retainActiveTerminalEntries(snapshot.terminalWidths, activeTerminalIds)
        : DEFAULT_TERMINAL_WIDTHS;
      const nextCanvasOpenTerminalIds = snapshot.canvasOpenTerminalIds
        ? retainActiveTerminalIds(snapshot.canvasOpenTerminalIds, activeTerminalIds)
        : DEFAULT_CANVAS_OPEN_TERMINAL_IDS;
      const nextCanvasOpenTentacleIds = snapshot.canvasOpenTentacleIds
        ? retainActiveTerminalIds(snapshot.canvasOpenTentacleIds, activeTentacleIds)
        : DEFAULT_CANVAS_OPEN_TENTACLE_IDS;

      lastPersistedUiStateRef.current = buildPersistedUiStateSnapshot({
        activePrimaryNav:
          snapshot.activePrimaryNav !== undefined &&
          snapshot.activePrimaryNav >= 1 &&
          snapshot.activePrimaryNav <= PRIMARY_NAV_ITEMS.length
            ? (snapshot.activePrimaryNav as PrimaryNavIndex)
            : DEFAULT_ACTIVE_PRIMARY_NAV,
        isAgentsSidebarVisible:
          snapshot.isAgentsSidebarVisible ?? DEFAULT_IS_AGENTS_SIDEBAR_VISIBLE,
        sidebarWidth: snapshot.sidebarWidth ?? MIN_SIDEBAR_WIDTH,
        isActiveAgentsSectionExpanded:
          snapshot.isActiveAgentsSectionExpanded ?? DEFAULT_IS_ACTIVE_AGENTS_SECTION_EXPANDED,
        isRuntimeStatusStripVisible:
          snapshot.isRuntimeStatusStripVisible ?? DEFAULT_IS_RUNTIME_STATUS_STRIP_VISIBLE,
        isMonitorVisible: snapshot.isMonitorVisible ?? DEFAULT_IS_MONITOR_VISIBLE,
        isBottomTelemetryVisible:
          snapshot.isBottomTelemetryVisible ?? DEFAULT_IS_BOTTOM_TELEMETRY_VISIBLE,
        isCodexUsageVisible: snapshot.isCodexUsageVisible ?? DEFAULT_IS_CODEX_USAGE_VISIBLE,
        isClaudeUsageVisible: snapshot.isClaudeUsageVisible ?? DEFAULT_IS_CLAUDE_USAGE_VISIBLE,
        isClaudeUsageSectionExpanded:
          snapshot.isClaudeUsageSectionExpanded ?? DEFAULT_IS_CLAUDE_USAGE_SECTION_EXPANDED,
        isCodexUsageSectionExpanded:
          snapshot.isCodexUsageSectionExpanded ?? DEFAULT_IS_CODEX_USAGE_SECTION_EXPANDED,
        terminalCompletionSound:
          snapshot.terminalCompletionSound ?? DEFAULT_TERMINAL_COMPLETION_SOUND,
        locale: (snapshot.locale as Locale) ?? DEFAULT_LOCALE,
        minimizedTerminalIds: nextMinimizedTerminalIds,
        terminalWidths: nextTerminalWidths,
        canvasOpenTerminalIds: nextCanvasOpenTerminalIds,
        canvasOpenTentacleIds: nextCanvasOpenTentacleIds,
        canvasTerminalsPanelWidth: snapshot.canvasTerminalsPanelWidth ?? null,
      });

      if (
        snapshot.activePrimaryNav !== undefined &&
        snapshot.activePrimaryNav >= 1 &&
        snapshot.activePrimaryNav <= PRIMARY_NAV_ITEMS.length
      ) {
        setActivePrimaryNav(snapshot.activePrimaryNav as PrimaryNavIndex);
      }

      if (snapshot.isAgentsSidebarVisible !== undefined) {
        setIsAgentsSidebarVisible(snapshot.isAgentsSidebarVisible);
      }

      if (snapshot.sidebarWidth !== undefined) {
        setSidebarWidth(clampSidebarWidth(snapshot.sidebarWidth));
      }

      if (snapshot.isActiveAgentsSectionExpanded !== undefined) {
        setIsActiveAgentsSectionExpanded(snapshot.isActiveAgentsSectionExpanded);
      }

      if (snapshot.isRuntimeStatusStripVisible !== undefined) {
        setIsRuntimeStatusStripVisible(snapshot.isRuntimeStatusStripVisible);
      }

      if (snapshot.isMonitorVisible !== undefined) {
        setIsMonitorVisible(snapshot.isMonitorVisible);
      }

      if (snapshot.isBottomTelemetryVisible !== undefined) {
        setIsBottomTelemetryVisible(snapshot.isBottomTelemetryVisible);
      }

      if (snapshot.isCodexUsageVisible !== undefined) {
        setIsCodexUsageVisible(snapshot.isCodexUsageVisible);
      }

      if (snapshot.isClaudeUsageVisible !== undefined) {
        setIsClaudeUsageVisible(snapshot.isClaudeUsageVisible);
      }

      if (snapshot.isCodexUsageSectionExpanded !== undefined) {
        setIsCodexUsageSectionExpanded(snapshot.isCodexUsageSectionExpanded);
      }

      if (snapshot.isClaudeUsageSectionExpanded !== undefined) {
        setIsClaudeUsageSectionExpanded(snapshot.isClaudeUsageSectionExpanded);
      }

      if (snapshot.terminalCompletionSound !== undefined) {
        setTerminalCompletionSound(snapshot.terminalCompletionSound);
      }

      if (snapshot.locale) {
        setLocale(snapshot.locale as Locale);
      }

      if (snapshot.minimizedTerminalIds) {
        setMinimizedTerminalIds(nextMinimizedTerminalIds);
      }

      if (snapshot.terminalWidths) {
        setTerminalWidths(nextTerminalWidths);
      }

      if (snapshot.canvasOpenTerminalIds) {
        setCanvasOpenTerminalIds(nextCanvasOpenTerminalIds);
      }

      if (snapshot.canvasOpenTentacleIds) {
        setCanvasOpenTentacleIds(nextCanvasOpenTentacleIds);
      }

      if (snapshot.canvasTerminalsPanelWidth !== undefined) {
        setCanvasTerminalsPanelWidth(snapshot.canvasTerminalsPanelWidth);
      }
    },
    [],
  );

  useEffect(() => {
    const activeTerminalIds = new Set(columns.map((entry) => entry.terminalId));
    const activeTentacleIds = new Set(columns.map((entry) => entry.tentacleId));
    setMinimizedTerminalIds((current) => retainActiveTerminalIds(current, activeTerminalIds));
    setTerminalWidths((current) => retainActiveTerminalEntries(current, activeTerminalIds));
    setCanvasOpenTerminalIds((current) => retainActiveTerminalIds(current, activeTerminalIds));
    setCanvasOpenTentacleIds((current) => retainActiveTerminalIds(current, activeTentacleIds));
  }, [columns]);

  // Flush pending UI state synchronously on tab close so the debounce window
  // cannot cause state loss when the user navigates away mid-debounce. A
  // keepalive fetch survives the page unload like a beacon would, but keeps
  // the PATCH method the /api/ui-state endpoint expects (sendBeacon can only
  // POST, which that route rejects with 405).
  const pendingUiStateRef = useRef<FrontendUiStateSnapshot | null>(null);
  useEffect(() => {
    const handleBeforeUnload = () => {
      const pending = pendingUiStateRef.current;
      if (!pending) {
        return;
      }
      void fetch(buildUiStateUrl(), {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pending),
        keepalive: true,
      }).catch(() => {
        // The page is going away — nothing useful to do with a failure.
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (!isUiStateHydrated) {
      return;
    }

    const payload = buildPersistedUiStateSnapshot({
      activePrimaryNav,
      isAgentsSidebarVisible,
      sidebarWidth,
      isActiveAgentsSectionExpanded,
      isRuntimeStatusStripVisible,
      isMonitorVisible,
      isBottomTelemetryVisible,
      isCodexUsageVisible,
      isClaudeUsageVisible,
      isClaudeUsageSectionExpanded,
      isCodexUsageSectionExpanded,
      terminalCompletionSound,
      locale,
      minimizedTerminalIds,
      terminalWidths,
      canvasOpenTerminalIds,
      canvasOpenTentacleIds,
      canvasTerminalsPanelWidth,
    });

    if (areUiStateSnapshotsEqual(lastPersistedUiStateRef.current, payload)) {
      pendingUiStateRef.current = null;
      return;
    }

    pendingUiStateRef.current = payload;

    const timerId = window.setTimeout(() => {
      void fetch(buildUiStateUrl(), {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Unexpected status ${response.status}`);
          }
          lastPersistedUiStateRef.current = payload;
          pendingUiStateRef.current = null;
        })
        .catch((error: unknown) => {
          console.warn("[ui-state] Failed to persist UI state:", error);
        });
    }, UI_STATE_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    activePrimaryNav,
    canvasOpenTerminalIds,
    canvasOpenTentacleIds,
    canvasTerminalsPanelWidth,
    isActiveAgentsSectionExpanded,
    isAgentsSidebarVisible,
    isBottomTelemetryVisible,
    isRuntimeStatusStripVisible,
    isMonitorVisible,
    isCodexUsageVisible,
    isClaudeUsageVisible,
    isClaudeUsageSectionExpanded,
    isCodexUsageSectionExpanded,
    isUiStateHydrated,
    minimizedTerminalIds,
    sidebarWidth,
    terminalCompletionSound,
    locale,
    terminalWidths,
  ]);

  return {
    activePrimaryNav,
    setActivePrimaryNav,
    isUiStateHydrated,
    setIsUiStateHydrated,
    hasHydratedUiStateSnapshot,
    isAgentsSidebarVisible,
    setIsAgentsSidebarVisible,
    sidebarWidth,
    setSidebarWidth,
    isActiveAgentsSectionExpanded,
    setIsActiveAgentsSectionExpanded,
    isRuntimeStatusStripVisible,
    setIsRuntimeStatusStripVisible,
    isMonitorVisible,
    setIsMonitorVisible,
    isBottomTelemetryVisible,
    setIsBottomTelemetryVisible,
    isCodexUsageVisible,
    setIsCodexUsageVisible,
    isClaudeUsageVisible,
    setIsClaudeUsageVisible,
    isClaudeUsageSectionExpanded,
    setIsClaudeUsageSectionExpanded,
    isCodexUsageSectionExpanded,
    setIsCodexUsageSectionExpanded,
    terminalCompletionSound,
    setTerminalCompletionSound,
    locale,
    setLocale,
    minimizedTerminalIds,
    setMinimizedTerminalIds,
    terminalWidths,
    setTerminalWidths,
    canvasOpenTerminalIds,
    setCanvasOpenTerminalIds,
    canvasOpenTentacleIds,
    setCanvasOpenTentacleIds,
    canvasTerminalsPanelWidth,
    setCanvasTerminalsPanelWidth,
    readUiState,
    applyHydratedUiState,
  };
};
