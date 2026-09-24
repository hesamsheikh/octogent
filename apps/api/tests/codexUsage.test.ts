import { describe, expect, it, vi } from "vitest";

import { readCodexUsageSnapshot } from "../src/codexUsage";

describe("readCodexUsageSnapshot", () => {
  it("returns unavailable when auth.json does not exist", async () => {
    const snapshot = await readCodexUsageSnapshot({
      now: () => new Date("2026-02-25T12:00:00.000Z"),
      readFileText: async () => {
        const error = new Error("missing");
        Object.assign(error, { code: "ENOENT" });
        throw error;
      },
    });

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toMatch(/codex auth not found/i);
  });

  it("refreshes stale OAuth token and maps usage response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            refresh_token: "fresh-refresh-token",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            plan_type: "pro",
            rate_limit: {
              limit_reached: false,
              primary_window: {
                used_percent: 19,
                reset_at: 1_766_948_068,
              },
              secondary_window: {
                used_percent: 44,
                reset_at: 1_767_407_914,
              },
            },
            credits: {
              has_credits: true,
              unlimited: false,
              balance: "123.45",
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );

    const writeFileText = vi.fn<(path: string, contents: string) => Promise<void>>();

    const snapshot = await readCodexUsageSnapshot({
      now: () => new Date("2026-02-25T12:00:00.000Z"),
      env: {
        CODEX_HOME: "/workspace/.codex",
      },
      readFileText: async () =>
        JSON.stringify({
          tokens: {
            access_token: "old-access-token",
            refresh_token: "old-refresh-token",
            account_id: "account-123",
          },
          last_refresh: "2026-01-01T00:00:00.000Z",
        }),
      writeFileText,
      fetchImpl: fetchMock,
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        status: "ok",
        source: "oauth-api",
        planType: "pro",
        primaryUsedPercent: 19,
        secondaryUsedPercent: 44,
        creditsBalance: 123.45,
        creditsUnlimited: false,
        limitReached: false,
      }),
    );
    expect(snapshot.primaryResetAt).toBe("2025-12-28T18:54:28.000Z");
    expect(snapshot.secondaryResetAt).toBe("2026-01-03T02:38:34.000Z");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://auth.openai.com/oauth/token");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://chatgpt.com/backend-api/wham/usage");

    expect(writeFileText).toHaveBeenCalledTimes(1);
    expect(writeFileText.mock.calls[0]?.[0]).toBe("/workspace/.codex/auth.json");
    expect(writeFileText.mock.calls[0]?.[1]).toContain("fresh-access-token");
  });
});
