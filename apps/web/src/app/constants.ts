export const CODEX_USAGE_SCAN_INTERVAL_MS = 600_000;
export const GITHUB_SUMMARY_SCAN_INTERVAL_MS = 60_000;
export const MONITOR_SCAN_INTERVAL_MS = 60_000;
export const BACKEND_LIVENESS_SCAN_INTERVAL_MS = 120_000;
export const UI_STATE_SAVE_DEBOUNCE_MS = 250;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;

export const PRIMARY_NAV_ITEMS = [
  { index: 1, labelKey: "web.nav.flow" as const },
  { index: 2, labelKey: "web.nav.agents" as const },
  { index: 3, labelKey: "web.nav.deck" as const },
  { index: 4, labelKey: "web.nav.activity" as const },
  { index: 5, labelKey: "web.nav.codeIntel" as const },
  { index: 6, labelKey: "web.nav.monitor" as const },
  { index: 7, labelKey: "web.nav.conversations" as const },
  { index: 8, labelKey: "web.nav.prompts" as const },
  { index: 9, labelKey: "web.nav.settings" as const },
] as const;

// Named lookups so views never hardcode a slot; reordering happens here once.
export const NAV_INDEX = {
  flow: 1,
  agents: 2,
  deck: 3,
  activity: 4,
  codeIntel: 5,
  monitor: 6,
  conversations: 7,
  prompts: 8,
  settings: 9,
} as const satisfies Record<string, PrimaryNavIndexLiteral>;

type PrimaryNavIndexLiteral = (typeof PRIMARY_NAV_ITEMS)[number]["index"];

export const GITHUB_COMMIT_SERIES_LENGTH = 30;
export const GITHUB_SPARKLINE_WIDTH = 148;
export const GITHUB_SPARKLINE_HEIGHT = 36;
export const GITHUB_OVERVIEW_GRAPH_WIDTH = 640;
export const GITHUB_OVERVIEW_GRAPH_HEIGHT = 180;

export const PRIMARY_NAV_MAX = PRIMARY_NAV_ITEMS.length;

export type PrimaryNavIndex = (typeof PRIMARY_NAV_ITEMS)[number]["index"];
