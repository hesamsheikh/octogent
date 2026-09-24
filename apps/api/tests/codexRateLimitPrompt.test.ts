import { describe, expect, it } from "vitest";

import {
  CODEX_RATE_LIMIT_PROMPT_ANSWERS,
  createCodexRateLimitPromptScanner,
  resolveCodexRateLimitPromptPolicy,
} from "../src/terminalRuntime/codexRateLimitPrompt";

// Captured from a live Codex TUI on 2026-09-21 (PTY debug log), trimmed at the end.
const REAL_PROMPT =
  "\u001b[39;49m\u001b[K\u001b[2m  done 6:08 PM\u001b[39m\u001b[49m\u001b[0m\u001b[r\u001b[21;3H\u001b[21;2H\u001b[0m\u001b[49m\u001b[K\u001b[22;2H\u001b[0m\u001b[49m\u001b[K\u001b[21;1H \u001b[22;1H \u001b[23;1H  \u001b[1mApproaching rate limits\u001b[24;1H\u001b[22m  \u001b[2mSwitch to gpt-5.6-luna for lower credit usage?\u001b[25;1H\u001b[22m \u001b[26;1H\u001b[1m\u001b[38;5;6;49m› 1. Switch to gpt-5.6-luna                 Fast and affordable agentic coding model.\u001b[27;1H\u001b[22m\u001b[39;49m  2. Keep current model\u001b[28;1H  3. Keep current model (never show again)  \u001b[2mHide future rate limit reminders about switching models.\u001b[29;1H\u001b[22m \u001b[30;1H  \u001b[2mPress enter to confirm or esc to go back";

describe("codex rate-limit prompt scanner", () => {
  it("recognizes the real prompt and names the suggested model", () => {
    const scanner = createCodexRateLimitPromptScanner();
    expect(scanner.push(REAL_PROMPT)).toEqual({ suggestedModel: "gpt-5.6-luna" });
  });

  it("reports once per paint, and again after reset", () => {
    const scanner = createCodexRateLimitPromptScanner();
    expect(scanner.push(REAL_PROMPT)).not.toBeNull();
    expect(scanner.push(REAL_PROMPT)).toBeNull();
    scanner.reset();
    expect(scanner.push(REAL_PROMPT)).not.toBeNull();
  });

  it("waits until the whole prompt is on screen when it arrives in pieces", () => {
    const scanner = createCodexRateLimitPromptScanner();
    const cut = REAL_PROMPT.indexOf("2. Keep current model");
    // Answering a half-painted prompt would send keys to the wrong screen.
    expect(scanner.push(REAL_PROMPT.slice(0, cut))).toBeNull();
    expect(scanner.push(REAL_PROMPT.slice(cut))).toEqual({ suggestedModel: "gpt-5.6-luna" });
  });

  it("ignores a worker merely talking about rate limits", () => {
    const scanner = createCodexRateLimitPromptScanner();
    expect(
      scanner.push("We are approaching rate limits in the API client; switch to a backoff.\r\n"),
    ).toBeNull();
    expect(scanner.push("Approaching rate limits\r\nbut no question follows\r\n")).toBeNull();
  });
});

describe("codex rate-limit prompt policy", () => {
  it("keeps the operator's model by default and on nonsense", () => {
    expect(resolveCodexRateLimitPromptPolicy(undefined)).toBe("keep");
    expect(resolveCodexRateLimitPromptPolicy("  ")).toBe("keep");
    expect(resolveCodexRateLimitPromptPolicy("yes please")).toBe("keep");
  });

  it("accepts switch and ask", () => {
    expect(resolveCodexRateLimitPromptPolicy(" Switch ")).toBe("switch");
    expect(resolveCodexRateLimitPromptPolicy("ask")).toBe("ask");
  });

  it("answers keep with Down then Enter, never the config-editing third option", () => {
    expect(CODEX_RATE_LIMIT_PROMPT_ANSWERS.keep).toBe("\u001b[B\r");
    expect(CODEX_RATE_LIMIT_PROMPT_ANSWERS.switch).toBe("\r");
  });
});
