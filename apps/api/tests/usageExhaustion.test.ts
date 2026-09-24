import type { ClaudeUsageSnapshot, CodexUsageSnapshot } from "@octogent/core";
import { describe, expect, it, vi } from "vitest";

import {
  type CachedUsageSnapshots,
  findExhaustedUsage,
  rememberUsageSnapshot,
} from "../src/usageExhaustion";

const now = Date.parse("2026-09-21T12:00:00.000Z");
const later = "2026-09-21T15:00:00.000Z";
const earlier = "2026-09-21T11:00:00.000Z";

const codex = (overrides: Partial<CodexUsageSnapshot>): CachedUsageSnapshots => ({
  claude: null,
  codex: {
    status: "ok",
    source: "oauth-api",
    fetchedAt: "2026-09-21T11:59:00.000Z",
    primaryUsedPercent: 40,
    primaryResetAt: later,
    secondaryUsedPercent: 60,
    secondaryResetAt: later,
    ...overrides,
  },
});

const claude = (overrides: Partial<ClaudeUsageSnapshot>): CachedUsageSnapshots => ({
  codex: null,
  claude: {
    status: "ok",
    source: "oauth-api",
    fetchedAt: "2026-09-21T11:59:00.000Z",
    primaryUsedPercent: 40,
    primaryResetAt: later,
    secondaryUsedPercent: 60,
    secondaryResetAt: later,
    ...overrides,
  },
});

describe("findExhaustedUsage", () => {
  it("flags a Codex window at 100% or the account limit flag", () => {
    expect(findExhaustedUsage("codex", null, codex({ primaryUsedPercent: 100 }), now)).toEqual({
      provider: "codex",
      bucket: "5-hour",
      usedPercent: 100,
      resetAt: later,
    });
    expect(
      findExhaustedUsage("codex", null, codex({ secondaryUsedPercent: 100.4 }), now)?.bucket,
    ).toBe("weekly");
    expect(findExhaustedUsage("codex", null, codex({ limitReached: true }), now)).toEqual({
      provider: "codex",
      bucket: "usage",
      usedPercent: null,
      resetAt: later,
    });
    expect(findExhaustedUsage("codex", null, codex({ primaryUsedPercent: 99 }), now)).toBeNull();
  });

  it("ignores a limit whose reset time has already passed", () => {
    expect(
      findExhaustedUsage(
        "codex",
        null,
        codex({ primaryUsedPercent: 100, primaryResetAt: earlier, limitReached: true }),
        now,
      ),
    ).toBeNull();
    expect(
      findExhaustedUsage(
        "codex",
        null,
        codex({ primaryUsedPercent: 100, primaryResetAt: null }),
        now,
      )?.resetAt,
    ).toBeNull();
  });

  it("checks Claude's model buckets only for the model the worker runs", () => {
    expect(
      findExhaustedUsage("claude-code", null, claude({ secondaryUsedPercent: 100 }), now)?.bucket,
    ).toBe("weekly");
    const sonnetFull = claude({ sonnetUsedPercent: 100, sonnetResetAt: later });
    expect(findExhaustedUsage("claude-code", "sonnet", sonnetFull, now)?.bucket).toBe(
      "weekly Sonnet",
    );
    expect(findExhaustedUsage("claude-code", "opus", sonnetFull, now)).toBeNull();
    expect(findExhaustedUsage("claude-code", null, sonnetFull, now)).toBeNull();
    const opusFull = claude({ scopedUsedPercent: 100, scopedResetAt: later, scopedLabel: "Opus" });
    expect(findExhaustedUsage("claude-code", "claude-opus-5", opusFull, now)?.bucket).toBe(
      "weekly Opus",
    );
    expect(findExhaustedUsage("claude-code", "sonnet", opusFull, now)).toBeNull();
  });

  it("stays silent without a usable snapshot for the chosen provider", () => {
    expect(
      findExhaustedUsage("claude-code", null, codex({ primaryUsedPercent: 100 }), now),
    ).toBeNull();
    expect(findExhaustedUsage("codex", null, { codex: null, claude: null }, now)).toBeNull();
  });
});

describe("rememberUsageSnapshot", () => {
  it("keeps the last good reading and passes every reading through", async () => {
    const readings: CodexUsageSnapshot[] = [
      { status: "ok", source: "oauth-api", fetchedAt: "a", primaryUsedPercent: 100 },
      { status: "error", source: "none", fetchedAt: "b", message: "offline" },
    ];
    const remember = vi.fn();
    const read = rememberUsageSnapshot(
      async () => readings.shift() as CodexUsageSnapshot,
      remember,
    );
    expect((await read()).status).toBe("ok");
    expect((await read()).status).toBe("error");
    expect(remember).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fetchedAt: "a" }));
  });
});
