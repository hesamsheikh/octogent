import type { TerminalLifecycleState } from "./types";

export const DEFAULT_TERMINAL_RETENTION_HOURS = 72;

// awaiting-review is deliberately absent: unmerged work must stay visible
// until an operator acts on it, so it never expires into the archive.
export const AUTO_ARCHIVE_LIFECYCLE_STATES: ReadonlySet<TerminalLifecycleState> = new Set([
  "completed",
  "stopped",
  "exited",
]);

export const resolveTerminalRetentionHours = (rawValue: string | undefined): number => {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return DEFAULT_TERMINAL_RETENTION_HOURS;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TERMINAL_RETENTION_HOURS;
  }

  return parsed;
};

export type ArchiveScanRecord = {
  lifecycleState?: TerminalLifecycleState | undefined;
  lifecycleUpdatedAt?: string | undefined;
  archivedAt?: string | undefined;
};

export const shouldAutoArchive = (
  record: ArchiveScanRecord,
  nowMs: number,
  retentionHours: number,
): boolean => {
  if (record.archivedAt) {
    return false;
  }

  if (!record.lifecycleState || !AUTO_ARCHIVE_LIFECYCLE_STATES.has(record.lifecycleState)) {
    return false;
  }

  if (!record.lifecycleUpdatedAt) {
    return false;
  }

  const lifecycleUpdatedAtMs = new Date(record.lifecycleUpdatedAt).getTime();
  if (!Number.isFinite(lifecycleUpdatedAtMs)) {
    return false;
  }

  return nowMs - lifecycleUpdatedAtMs >= retentionHours * 60 * 60 * 1000;
};
