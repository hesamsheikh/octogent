import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_RETENTION_HOURS,
  resolveTerminalRetentionHours,
  shouldAutoArchive,
} from "../src/terminalRuntime/archivePolicy";

const NOW_MS = Date.parse("2026-08-31T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW_MS - hours * 60 * 60 * 1000).toISOString();

describe("resolveTerminalRetentionHours", () => {
  it("defaults to 72 hours when the variable is unset or blank", () => {
    expect(resolveTerminalRetentionHours(undefined)).toBe(DEFAULT_TERMINAL_RETENTION_HOURS);
    expect(resolveTerminalRetentionHours("")).toBe(DEFAULT_TERMINAL_RETENTION_HOURS);
    expect(resolveTerminalRetentionHours("   ")).toBe(DEFAULT_TERMINAL_RETENTION_HOURS);
  });

  it("falls back to the default for invalid values", () => {
    expect(resolveTerminalRetentionHours("abc")).toBe(DEFAULT_TERMINAL_RETENTION_HOURS);
    expect(resolveTerminalRetentionHours("-1")).toBe(DEFAULT_TERMINAL_RETENTION_HOURS);
    expect(resolveTerminalRetentionHours("0")).toBe(DEFAULT_TERMINAL_RETENTION_HOURS);
    expect(resolveTerminalRetentionHours("Infinity")).toBe(DEFAULT_TERMINAL_RETENTION_HOURS);
  });

  it("accepts positive numeric values", () => {
    expect(resolveTerminalRetentionHours("24")).toBe(24);
    expect(resolveTerminalRetentionHours(" 48 ")).toBe(48);
    expect(resolveTerminalRetentionHours("0.5")).toBe(0.5);
  });
});

describe("shouldAutoArchive", () => {
  const retentionHours = 72;

  it("archives completed, stopped, and exited records past retention", () => {
    for (const lifecycleState of ["completed", "stopped", "exited"] as const) {
      expect(
        shouldAutoArchive(
          { lifecycleState, lifecycleUpdatedAt: hoursAgo(73) },
          NOW_MS,
          retentionHours,
        ),
      ).toBe(true);
    }
  });

  it("keeps records that are still inside the retention window", () => {
    expect(
      shouldAutoArchive(
        { lifecycleState: "completed", lifecycleUpdatedAt: hoursAgo(71) },
        NOW_MS,
        retentionHours,
      ),
    ).toBe(false);
  });

  it("archives exactly at the retention boundary", () => {
    expect(
      shouldAutoArchive(
        { lifecycleState: "stopped", lifecycleUpdatedAt: hoursAgo(72) },
        NOW_MS,
        retentionHours,
      ),
    ).toBe(true);
  });

  it("never archives awaiting-review records, no matter how old", () => {
    expect(
      shouldAutoArchive(
        { lifecycleState: "awaiting-review", lifecycleUpdatedAt: hoursAgo(10_000) },
        NOW_MS,
        retentionHours,
      ),
    ).toBe(false);
  });

  it("ignores lifecycle states that are not terminal outcomes", () => {
    for (const lifecycleState of ["registered", "running", "stale", "stalled"] as const) {
      expect(
        shouldAutoArchive(
          { lifecycleState, lifecycleUpdatedAt: hoursAgo(10_000) },
          NOW_MS,
          retentionHours,
        ),
      ).toBe(false);
    }
    expect(
      shouldAutoArchive({ lifecycleUpdatedAt: hoursAgo(10_000) }, NOW_MS, retentionHours),
    ).toBe(false);
  });

  it("skips records that are already archived", () => {
    expect(
      shouldAutoArchive(
        {
          lifecycleState: "completed",
          lifecycleUpdatedAt: hoursAgo(100),
          archivedAt: hoursAgo(1),
        },
        NOW_MS,
        retentionHours,
      ),
    ).toBe(false);
  });

  it("skips records with a missing or unparsable timestamp", () => {
    expect(shouldAutoArchive({ lifecycleState: "completed" }, NOW_MS, retentionHours)).toBe(false);
    expect(
      shouldAutoArchive(
        { lifecycleState: "completed", lifecycleUpdatedAt: "not-a-date" },
        NOW_MS,
        retentionHours,
      ),
    ).toBe(false);
  });
});
