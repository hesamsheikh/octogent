import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  invalidateUsageCache,
  killProcessGroup,
  parseClaudeUsageSource,
  parseCliUsageOutput,
  readClaudeUsageSnapshot,
  resetCliSession,
  stripAnsiCodes,
} from "../src/claudeUsage";

const noCliPty = async () => null;

const validCredentials = (overrides: Record<string, unknown> = {}) => ({
  claudeAiOauth: {
    accessToken: "oauth-token",
    scopes: ["user:profile", "offline_access"],
    ...overrides,
  },
});

const usageResponseBody = JSON.stringify({
  plan_type: "pro",
  five_hour: { used_percent: 14, reset_at: "2026-03-03T15:00:00.000Z" },
  seven_day: { used_percent: 52, reset_at: 1_772_539_200 },
  seven_day_sonnet: { used_percent: 33, reset_at: 1_772_711_999 },
});

// Newer OAuth payload shape: a top-level `limits` array alongside legacy
// windows. The legacy values are deliberately different so tests can prove
// which shape the parser preferred.
const limitsUsageResponseBody = JSON.stringify({
  plan_type: "max",
  five_hour: { utilization: 99, resets_at: "2026-03-01T00:00:00.000Z" },
  seven_day: { utilization: 98, resets_at: "2026-03-01T00:00:00.000Z" },
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [
    {
      kind: "session",
      group: "session",
      percent: 14,
      severity: "normal",
      resets_at: "2026-03-03T15:00:00+00:00",
      scope: null,
      is_active: true,
    },
    {
      kind: "weekly_all",
      group: "weekly",
      percent: 52,
      severity: "normal",
      resets_at: "2026-03-06T09:00:00+00:00",
      scope: null,
      is_active: false,
    },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 45,
      severity: "normal",
      resets_at: "2026-03-06T09:00:00+00:00",
      scope: { model: { id: null, display_name: "Fable" }, surface: null },
      is_active: false,
    },
  ],
});

const cliUsageOutput = [
  "Current session",
  "  2% used",
  "Current week (all models)",
  "  0% used",
  "Current week (Sonnet only)",
  "  0% used",
].join("\n");

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe("stripAnsiCodes", () => {
  it("strips CSI sequences", () => {
    expect(stripAnsiCodes("\u001B[32mHello\u001B[0m")).toBe("Hello");
  });

  it("strips complex SGR sequences", () => {
    expect(stripAnsiCodes("\u001B[1;34;48;5;220mBold Blue\u001B[0m")).toBe("Bold Blue");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsiCodes("plain text")).toBe("plain text");
  });
});

describe("parseCliUsageOutput", () => {
  it("passes through used percentages directly", () => {
    const output = [
      "Current session",
      "  2% used",
      "Current week (all models)",
      "  0% used",
      "Current week (Sonnet only)",
      "  0% used",
    ].join("\n");

    const result = parseCliUsageOutput(output);
    expect(result.primaryUsedPercent).toBe(2);
    expect(result.secondaryUsedPercent).toBe(0);
    expect(result.sonnetUsedPercent).toBe(0);
  });

  it("inverts remaining percentages to used (100 - value)", () => {
    const output = [
      "Current session",
      "  72.5% remaining",
      "Current week (all models)",
      "  45% remaining",
      "Current week (Sonnet only)",
      "  88.3% remaining",
    ].join("\n");

    const result = parseCliUsageOutput(output);
    expect(result.primaryUsedPercent).toBe(27.5);
    expect(result.secondaryUsedPercent).toBe(55);
    expect(result.sonnetUsedPercent).toBe(11.7);
  });

  it("handles ANSI codes in output", () => {
    const output = [
      "\u001B[1mCurrent session\u001B[0m",
      "  \u001B[32m85%\u001B[0m remaining",
      "\u001B[1mCurrent week (all models)\u001B[0m",
      "  \u001B[33m50%\u001B[0m remaining",
    ].join("\n");

    const result = parseCliUsageOutput(output);
    expect(result.primaryUsedPercent).toBe(15);
    expect(result.secondaryUsedPercent).toBe(50);
  });

  it("returns nulls when no labels found", () => {
    const result = parseCliUsageOutput("some unrelated output\nno percentages here");
    expect(result.primaryUsedPercent).toBeNull();
    expect(result.secondaryUsedPercent).toBeNull();
    expect(result.sonnetUsedPercent).toBeNull();
  });

  it("handles Opus label variant", () => {
    const output = ["Current session", "  10% used", "Current week (Opus)", "  30% used"].join(
      "\n",
    );

    const result = parseCliUsageOutput(output);
    expect(result.primaryUsedPercent).toBe(10);
    expect(result.secondaryUsedPercent).toBe(30);
  });

  it("handles percentage on same line as label", () => {
    const output = "Current session: 35% used\nCurrent week (all models): 60% used";
    const result = parseCliUsageOutput(output);
    expect(result.primaryUsedPercent).toBe(35);
    expect(result.secondaryUsedPercent).toBe(60);
  });

  it("does not reuse the session percentage for week when labels are tightly packed", () => {
    const output = [
      "Status Config Usage Stats",
      "Current session 1% used Current week (all models) 52% used Current week (Sonnet only) 33% used",
    ].join("\n");

    const result = parseCliUsageOutput(output);
    expect(result.primaryUsedPercent).toBe(1);
    expect(result.secondaryUsedPercent).toBe(52);
    expect(result.sonnetUsedPercent).toBe(33);
  });
});

describe("parseClaudeUsageSource", () => {
  it("accepts the four supported values", () => {
    expect(parseClaudeUsageSource("auto")).toBe("auto");
    expect(parseClaudeUsageSource("oauth")).toBe("oauth");
    expect(parseClaudeUsageSource("cli")).toBe("cli");
    expect(parseClaudeUsageSource("off")).toBe("off");
  });

  it("trims whitespace and ignores case", () => {
    expect(parseClaudeUsageSource("  OAuth ")).toBe("oauth");
    expect(parseClaudeUsageSource("OFF")).toBe("off");
  });

  it("falls back to auto for blank, undefined, and unknown values", () => {
    expect(parseClaudeUsageSource(undefined)).toBe("auto");
    expect(parseClaudeUsageSource("")).toBe("auto");
    expect(parseClaudeUsageSource("   ")).toBe("auto");
    expect(parseClaudeUsageSource("bogus")).toBe("auto");
  });
});

describe("readClaudeUsageSnapshot", () => {
  beforeEach(() => resetCliSession());
  afterEach(() => vi.unstubAllEnvs());

  it("auto prefers OAuth and does not spawn the CLI when OAuth succeeds", async () => {
    const spawnCliUsage = vi.fn(async () => cliUsageOutput);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(usageResponseBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.source).toBe("oauth-api");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spawnCliUsage).not.toHaveBeenCalled();
  });

  it("auto falls back to CLI when OAuth fails", async () => {
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: async () => cliUsageOutput,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: async () => new Response("boom", { status: 500 }),
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.source).toBe("cli-pty");
    expect(snapshot.primaryUsedPercent).toBe(2);
    expect(snapshot.secondaryUsedPercent).toBe(0);
    expect(snapshot.sonnetUsedPercent).toBe(0);
  });

  it("auto returns the OAuth failure when the CLI fallback yields no data", async () => {
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: async () => "Welcome to Claude! No usage data here.",
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: async () => new Response("boom", { status: 500 }),
    });

    expect(snapshot.status).toBe("error");
    expect(snapshot.message).toMatch(/HTTP 500/);
  });

  it("an unrecognized usageSource behaves like auto", async () => {
    const spawnCliUsage = vi.fn(async () => cliUsageOutput);
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      usageSource: "bogus",
      spawnCliUsage,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: async () =>
        new Response(usageResponseBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(snapshot.source).toBe("oauth-api");
    expect(spawnCliUsage).not.toHaveBeenCalled();
  });

  it("oauth mode never spawns the CLI even when OAuth fails", async () => {
    const spawnCliUsage = vi.fn(async () => cliUsageOutput);
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      usageSource: "oauth",
      spawnCliUsage,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: async () => new Response("boom", { status: 500 }),
    });

    expect(snapshot.status).toBe("error");
    expect(spawnCliUsage).not.toHaveBeenCalled();
  });

  it("cli mode uses the CLI without calling the OAuth API", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const readCredentialsJson = vi.fn(async () => validCredentials());

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      usageSource: "cli",
      spawnCliUsage: async () => cliUsageOutput,
      readCredentialsJson,
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.source).toBe("cli-pty");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readCredentialsJson).not.toHaveBeenCalled();
  });

  it("cli mode reports an error when the CLI yields no data", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      usageSource: "cli",
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("error");
    expect(snapshot.message).toMatch(/cli usage unavailable/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("off mode returns a disabled snapshot without contacting any source", async () => {
    const spawnCliUsage = vi.fn(async () => cliUsageOutput);
    const fetchMock = vi.fn<typeof fetch>();
    const readCredentialsJson = vi.fn(async () => validCredentials());

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      usageSource: "off",
      spawnCliUsage,
      readCredentialsJson,
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.source).toBe("none");
    expect(snapshot.fetchedAt).toBe("2026-03-03T12:00:00.000Z");
    expect(snapshot.message).toMatch(/disabled/i);
    expect(snapshot.message).toContain("OCTOGENT_CLAUDE_USAGE_SOURCE");
    expect(spawnCliUsage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readCredentialsJson).not.toHaveBeenCalled();
  });

  it("off mode ignores a previously cached snapshot", async () => {
    const deps = {
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: async () =>
        new Response(usageResponseBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    };

    const okSnapshot = await readClaudeUsageSnapshot(deps);
    expect(okSnapshot.status).toBe("ok");

    const disabledSnapshot = await readClaudeUsageSnapshot({ ...deps, usageSource: "off" });
    expect(disabledSnapshot.status).toBe("unavailable");
    expect(disabledSnapshot.message).toMatch(/disabled/i);
  });

  it("reads the mode from OCTOGENT_CLAUDE_USAGE_SOURCE by default", async () => {
    vi.stubEnv("OCTOGENT_CLAUDE_USAGE_SOURCE", "off");

    const spawnCliUsage = vi.fn(async () => cliUsageOutput);
    const fetchMock = vi.fn<typeof fetch>();

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toMatch(/disabled/i);
    expect(spawnCliUsage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unavailable when credentials cannot be found", async () => {
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => {
        const error = new Error("missing");
        Object.assign(error, { code: "ENOENT" });
        throw error;
      },
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toMatch(/credentials not found/i);
  });

  it("returns unavailable when OAuth token is missing", async () => {
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => ({
        claudeAiOauth: { scopes: ["user:profile"] },
      }),
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toMatch(/access token.*missing/i);
  });

  it("returns unavailable when required user:profile scope is missing", async () => {
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials({ scopes: ["offline_access"] }),
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toMatch(/user:profile/i);
  });

  it("maps usage windows from OAuth API", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(usageResponseBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        status: "ok",
        source: "oauth-api",
        planType: "pro",
        primaryUsedPercent: 14,
        primaryResetAt: "2026-03-03T15:00:00.000Z",
        secondaryUsedPercent: 52,
        secondaryResetAt: "2026-03-03T12:00:00.000Z",
        sonnetUsedPercent: 33,
        sonnetResetAt: "2026-03-05T11:59:59.000Z",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/api/oauth/usage");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer oauth-token",
          "anthropic-beta": "oauth-2025-04-20",
        }),
      }),
    );
  });

  it("prefers the limits array over legacy windows and maps the scoped weekly limit", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(limitsUsageResponseBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        status: "ok",
        source: "oauth-api",
        planType: "max",
        primaryUsedPercent: 14,
        primaryResetAt: "2026-03-03T15:00:00.000Z",
        secondaryUsedPercent: 52,
        secondaryResetAt: "2026-03-06T09:00:00.000Z",
        scopedUsedPercent: 45,
        scopedResetAt: "2026-03-06T09:00:00.000Z",
        scopedLabel: "Fable",
      }),
    );
    expect(snapshot.sonnetUsedPercent).toBeNull();
  });

  it("falls back to a legacy window when the limits array lacks that kind", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 14, resets_at: "2026-03-03T15:00:00.000Z" },
          seven_day: { utilization: 52, resets_at: "2026-03-06T09:00:00.000Z" },
          limits: [
            {
              kind: "weekly_scoped",
              group: "weekly",
              percent: 45,
              severity: "normal",
              resets_at: "2026-03-06T09:00:00+00:00",
              scope: { model: { id: null, display_name: "Fable" }, surface: null },
              is_active: false,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.primaryUsedPercent).toBe(14);
    expect(snapshot.secondaryUsedPercent).toBe(52);
    expect(snapshot.scopedUsedPercent).toBe(45);
    expect(snapshot.scopedLabel).toBe("Fable");
  });

  it("falls back to legacy windows when the limits array is empty", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          plan_type: "pro",
          five_hour: { utilization: 14, resets_at: "2026-03-03T15:00:00.000Z" },
          seven_day: { utilization: 52, resets_at: "2026-03-06T09:00:00.000Z" },
          limits: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.primaryUsedPercent).toBe(14);
    expect(snapshot.secondaryUsedPercent).toBe(52);
    expect(snapshot.scopedUsedPercent).toBeNull();
    expect(snapshot.scopedLabel).toBeNull();
  });

  it("tolerates a weekly_scoped limit without a model display name", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          limits: [
            { kind: "session", group: "session", percent: 5, resets_at: null, scope: null },
            { kind: "weekly_all", group: "weekly", percent: 10, resets_at: null, scope: null },
            { kind: "weekly_scoped", group: "weekly", percent: 45, resets_at: null, scope: null },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.primaryUsedPercent).toBe(5);
    expect(snapshot.secondaryUsedPercent).toBe(10);
    expect(snapshot.scopedUsedPercent).toBe(45);
    expect(snapshot.scopedLabel).toBeNull();
  });

  it("returns unavailable on oauth unauthorized response", async () => {
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: async () => new Response("unauthorized", { status: 401 }),
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toMatch(/expired|unauthorized/i);
  });

  it("returns unavailable on oauth rate limit response", async () => {
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "rate_limit_error",
              message: "Rate limited. Please try again later.",
            },
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          },
        ),
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toMatch(/rate limit|rate limited/i);
  });

  it("maps utilization field directly as percent value", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 14, resets_at: "2026-03-03T15:00:00.000Z" },
          seven_day: { utilization: 52.3, resets_at: null },
          seven_day_sonnet: { utilization: 0.0, resets_at: null },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.primaryUsedPercent).toBe(14);
    expect(snapshot.primaryResetAt).toBe("2026-03-03T15:00:00.000Z");
    expect(snapshot.secondaryUsedPercent).toBe(52.3);
    expect(snapshot.sonnetUsedPercent).toBe(0);
  });

  it("maps extra_usage costs from cents to dollars for Max plans", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 0.0, resets_at: null },
          seven_day: { utilization: 0.0, resets_at: null },
          seven_day_sonnet: { utilization: 0.0, resets_at: null },
          extra_usage: {
            is_enabled: true,
            monthly_limit: 4250,
            used_credits: 1275,
            utilization: null,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials({ rateLimitTier: "default_claude_max_5x" }),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.planType).toBe("Claude Max");
    expect(snapshot.extraUsageCostUsed).toBe(12.75);
    expect(snapshot.extraUsageCostLimit).toBe(42.5);
    // Rate limit fields are also populated alongside extra usage
    expect(snapshot.primaryUsedPercent).toBe(0);
    expect(snapshot.secondaryUsedPercent).toBe(0);
    expect(snapshot.sonnetUsedPercent).toBe(0);
  });

  it("invalidateUsageCache forces a fresh fetch on next read", async () => {
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          plan_type: "pro",
          five_hour: { used_percent: callCount * 10, reset_at: null },
          seven_day: { used_percent: 50, reset_at: null },
          seven_day_sonnet: { used_percent: 30, reset_at: null },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const deps = {
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    };

    const first = await readClaudeUsageSnapshot(deps);
    expect(first.primaryUsedPercent).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Cached — same result without a new fetch
    const cached = await readClaudeUsageSnapshot(deps);
    expect(cached.primaryUsedPercent).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // After invalidation, next read triggers a fresh fetch
    invalidateUsageCache();
    const fresh = await readClaudeUsageSnapshot(deps);
    expect(fresh.primaryUsedPercent).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves the last successful oauth snapshot when a later oauth request is rate limited", async () => {
    const deps = {
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
    };

    const okSnapshot = await readClaudeUsageSnapshot({
      ...deps,
      fetchImpl: async () =>
        new Response(usageResponseBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(okSnapshot.status).toBe("ok");
    expect(okSnapshot.source).toBe("oauth-api");

    const staleSnapshot = await readClaudeUsageSnapshot({
      ...deps,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "rate_limit_error",
              message: "Rate limited. Please try again later.",
            },
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          },
        ),
    });

    expect(staleSnapshot.status).toBe("ok");
    expect(staleSnapshot.source).toBe("oauth-api");
    expect(staleSnapshot.primaryUsedPercent).toBe(14);
    expect(staleSnapshot.secondaryUsedPercent).toBe(52);
    expect(staleSnapshot.sonnetUsedPercent).toBe(33);
  });

  it("returns error when credentials json is not parseable", async () => {
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => {
        throw new Error("bad json");
      },
    });

    expect(snapshot.status).toBe("error");
    expect(snapshot.message).toMatch(/unable to read/i);
  });

  it("serves a persisted snapshot immediately and refreshes in background", async () => {
    const projectStateDir = mkdtempSync(join(tmpdir(), "octogent-claude-usage-"));
    temporaryDirectories.push(projectStateDir);

    await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      projectStateDir,
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: async () =>
        new Response(usageResponseBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    resetCliSession();

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        await new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(usageResponseBody, {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }, 50);
        }),
    );

    const startedAt = Date.now();
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:05:00.000Z"),
      projectStateDir,
      backgroundRefreshOnly: true,
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.source).toBe("oauth-api");
    expect(snapshot.primaryUsedPercent).toBe(14);
    expect(Date.now() - startedAt).toBeLessThan(40);

    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns immediately on a cold cache miss when background refresh mode is enabled", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        await new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(usageResponseBody, {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }, 50);
        }),
    );

    const startedAt = Date.now();
    const snapshot = await readClaudeUsageSnapshot({
      now: () => new Date("2026-03-03T12:00:00.000Z"),
      backgroundRefreshOnly: true,
      spawnCliUsage: noCliPty,
      readCredentialsJson: async () => validCredentials(),
      fetchImpl: fetchMock,
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toMatch(/refresh in progress/i);
    expect(Date.now() - startedAt).toBeLessThan(40);

    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("killProcessGroup", () => {
  it("reaps the group before the leader so nothing is orphaned", () => {
    const calls: Array<[number, NodeJS.Signals]> = [];
    killProcessGroup(4321, (target, signal) => {
      calls.push([target, signal]);
    });

    expect(calls).toEqual([
      [-4321, "SIGKILL"],
      [4321, "SIGKILL"],
    ]);
  });

  it("still kills the leader when the group is already gone", () => {
    const calls: number[] = [];
    killProcessGroup(99, (target) => {
      if (target < 0) throw new Error("ESRCH");
      calls.push(target);
    });

    expect(calls).toEqual([99]);
  });
});
