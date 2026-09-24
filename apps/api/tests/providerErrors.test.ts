import { describe, expect, it } from "vitest";

import {
  clearProviderError,
  createProviderErrorScanner,
  detectProviderError,
  recordProviderError,
} from "../src/terminalRuntime/providerErrors";
import type { PersistedTerminal } from "../src/terminalRuntime/types";

// Real banners from the 2026-09-21 log analysis.
const CODEX_USAGE_LIMIT =
  "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 15th, 2026 11:51 AM.";
const CLAUDE_CONNECTION_LOST =
  "API Error: Connection lost mid-response. The response may be incomplete; please try again.";

describe("detectProviderError", () => {
  it.each([
    [`■ ${CODEX_USAGE_LIMIT}`, "usage-limit"],
    [`  ⎿  ${CLAUDE_CONNECTION_LOST}`, "api-error"],
    ["Claude usage limit reached. Your limit will reset at 5pm (Asia/Taipei).", "usage-limit"],
    ["  ⎿  5-hour limit reached ∙ resets 5pm", "usage-limit"],
    ["You've hit your limit · resets 3pm", "usage-limit"],
    ["■ Rate limit reached for gpt-5 in organization org-x on tokens per min.", "rate-limit"],
    [
      '  ⎿  API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}',
      "rate-limit",
    ],
    ["■ exceeded retry limit, last status: 429 Too Many Requests", "rate-limit"],
    [
      '● API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      "api-error",
    ],
    ["Connection lost", "api-error"],
    ["■ stream disconnected before completion: error sending request", "api-error"],
    [
      '  ⎿  API Error: 401 {"type":"error","error":{"type":"authentication_error"}} · Please run /login',
      "auth",
    ],
    ["● Invalid API key · Please run /login", "auth"],
    ["■ unexpected status 401 Unauthorized: token expired", "auth"],
  ])("recognizes %j as %s", (line, kind) => {
    expect(detectProviderError(`${line}\r\n`)?.kind).toBe(kind);
  });

  it("reports the first matching line without its TUI glyph, bounded to 200 chars", () => {
    expect(detectProviderError(`working…\r\n■ ${CODEX_USAGE_LIMIT}\r\n› \r\n`)).toEqual({
      kind: "usage-limit",
      message: CODEX_USAGE_LIMIT,
    });
    const long = `API Error: ${"x".repeat(400)}`;
    expect(detectProviderError(long)?.message).toHaveLength(200);
  });

  it("sees through ANSI styling and cursor-addressed rows", () => {
    expect(
      detectProviderError(
        `\x1b]0;✳ Worker\x07\x1b[12;1H\x1b[2K\x1b[31m■\x1b[39m \x1b[1mYou've hit your usage limit.\x1b[22m`,
      ),
    ).toEqual({ kind: "usage-limit", message: "You've hit your usage limit." });
    // A terminal bell rung just before the banner is not part of the line.
    expect(detectProviderError("\x07\x1b[2K  ⎿  API Error: Connection lost\r\n")?.kind).toBe(
      "api-error",
    );
    // Rows painted by cursor moves are separate lines, not one run-on string.
    expect(detectProviderError("previous row\x1b[5;3HAPI Error: Connection lost")?.kind).toBe(
      "api-error",
    );
  });

  it.each([
    // A worker discussing limits in prose is not a banner.
    "● I added retry handling so an API Error: Connection lost banner is detected, and the rate limit reached case too.",
    "The worker should back off when the rate limit is hit; see the usage limit docs.",
    "Rate limit handling lives in apps/api/src/codexUsage.ts",
    // Warnings before a limit are not the limit.
    "⚠ Heads up, you've used over 75% of your 5h limit.",
    "Approaching usage limit · resets at 5pm",
    // Transient errors the CLI is still retrying on its own.
    "  ⎿  API Error (Connection error.) · Retrying in 5 seconds… (attempt 2/10)",
    // Diff and code lines that merely contain the banner text.
    '      12 +  "API Error: Connection lost mid-response",',
    "      401 +  const status = 401;",
    '> tell me what "API Error:" means',
    "apps/api/src/cli.ts:12: API Error: handler",
  ])("ignores %j", (line) => {
    expect(detectProviderError(`${line}\r\n`)).toBeNull();
  });
});

describe("createProviderErrorScanner", () => {
  it("assembles a banner split across PTY chunks, including a split escape sequence", () => {
    const scanner = createProviderErrorScanner();
    expect(scanner.push("\x1b[2K■ You've hit your us")).toBeNull();
    expect(
      scanner.push("age limit. Visit https://chatgpt.com/codex/settings/usage \x1b[3"),
    ).toBeNull();
    expect(scanner.push("1mor try again at Sep 15th, 2026 11:51 AM.")).toBeNull();
    expect(scanner.push("\x1b[0m\r\n› ")).toEqual({
      kind: "usage-limit",
      message:
        "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage or try again at Sep 15th, 2026 11:51 AM.",
    });
  });

  it("treats a split row as a continuation, not a new line start", () => {
    const scanner = createProviderErrorScanner();
    expect(scanner.push("● The fix handles the case where ")).toBeNull();
    expect(scanner.push("API Error: Connection lost appears.\r\n")).toBeNull();
  });

  it("does not let an overlong line turn its continuation into a line start", () => {
    const scanner = createProviderErrorScanner();
    expect(scanner.push(`● ${"prose ".repeat(1000)}`)).toBeNull();
    expect(scanner.push("API Error: Connection lost")).toBeNull();
    expect(scanner.push(" still prose\r\n")).toBeNull();
    expect(scanner.push("API Error: Connection lost\r\n")?.kind).toBe("api-error");
  });
});

describe("provider error record", () => {
  const terminal = (): PersistedTerminal => ({
    terminalId: "worker",
    tentacleId: "worker",
    tentacleName: "worker",
    createdAt: "2026-09-21T12:00:00.000Z",
    workspaceMode: "shared",
    lifecycleState: "running",
  });
  const match = { kind: "usage-limit" as const, message: CODEX_USAGE_LIMIT };

  it("records once per distinct banner and names it in the lifecycle reason", () => {
    const record = terminal();
    expect(recordProviderError(record, match, "2026-09-21T12:01:00.000Z")).toBe(true);
    expect(record).toMatchObject({
      lifecycleState: "running",
      lifecycleReason: `provider error: ${CODEX_USAGE_LIMIT}`,
      providerError: { ...match, at: "2026-09-21T12:01:00.000Z" },
    });
    // A repaint of the same banner keeps the original time.
    expect(recordProviderError(record, match, "2026-09-21T12:02:00.000Z")).toBe(false);
    expect(record.providerError?.at).toBe("2026-09-21T12:01:00.000Z");
  });

  it("leaves a settled verdict's reason alone", () => {
    const record = {
      ...terminal(),
      lifecycleState: "exited" as const,
      lifecycleReason: "pty_exit",
    };
    expect(recordProviderError(record, match, "2026-09-21T12:01:00.000Z")).toBe(true);
    expect(record.lifecycleReason).toBe("pty_exit");
  });

  it("clears the error and only its own lifecycle reason", () => {
    const record = terminal();
    expect(clearProviderError(record)).toBe(false);
    recordProviderError(record, match, "2026-09-21T12:01:00.000Z");
    expect(clearProviderError(record)).toBe(true);
    expect(record.providerError).toBeUndefined();
    expect(record.lifecycleReason).toBeUndefined();

    recordProviderError(record, match, "2026-09-21T12:01:00.000Z");
    record.lifecycleReason = "initial prompt not acknowledged";
    clearProviderError(record);
    expect(record.lifecycleReason).toBe("initial prompt not acknowledged");
  });
});
