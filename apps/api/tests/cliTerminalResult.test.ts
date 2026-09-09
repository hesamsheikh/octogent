import { describe, expect, it } from "vitest";

import {
  buildTerminalResult,
  isFinishedWell,
  isSettledLifecycle,
  lastAssistantMessage,
  parseTerminalWaitArgs,
} from "../src/cliTerminalResult";

describe("parseTerminalWaitArgs", () => {
  it("collects terminal ids and defaults to no timeout and a 5s interval", () => {
    expect(parseTerminalWaitArgs(["t-1", "t-2"])).toEqual({
      ok: true,
      terminalIds: ["t-1", "t-2"],
      timeoutMs: 0,
      intervalMs: 5_000,
      json: false,
    });
  });

  it("reads --timeout and --interval in seconds and --json", () => {
    expect(parseTerminalWaitArgs(["t-1", "--timeout", "600", "--interval", "2", "--json"])).toEqual(
      { ok: true, terminalIds: ["t-1"], timeoutMs: 600_000, intervalMs: 2_000, json: true },
    );
  });

  it("never polls faster than once a second", () => {
    const parsed = parseTerminalWaitArgs(["t-1", "--interval", "0.1"]);
    expect(parsed.ok && parsed.intervalMs).toBe(1_000);
  });

  it("rejects a missing id or a broken number", () => {
    expect(parseTerminalWaitArgs([])).toEqual({
      ok: false,
      errorKey: "cli.error.terminalIdRequired",
    });
    expect(parseTerminalWaitArgs(["t-1", "--timeout", "soon"])).toEqual({
      ok: false,
      errorKey: "cli.error.invalidNumberFlag",
      flag: "--timeout",
    });
  });
});

describe("settled lifecycles", () => {
  it("treats review, completion and every dead state as settled", () => {
    for (const state of ["awaiting-review", "completed", "stopped", "exited", "stale"]) {
      expect(isSettledLifecycle(state), state).toBe(true);
    }
    for (const state of ["running", "stalled", "registered", undefined]) {
      expect(isSettledLifecycle(state), String(state)).toBe(false);
    }
    expect(isFinishedWell("awaiting-review")).toBe(true);
    expect(isFinishedWell("stopped")).toBe(false);
  });
});

describe("buildTerminalResult", () => {
  it("assembles state, model, summary and the agent's last message", () => {
    const result = buildTerminalResult(
      {
        terminalId: "issue37-review-worker",
        lifecycleState: "completed",
        agentProvider: "codex",
        agentModel: "gpt-5.6-sol",
        completionSummary: {
          commits: [{ hash: "abc1234", message: "docs: result" }],
          branch: "octogent/issue37-review-worker",
          merged: false,
          filesChanged: 1,
          insertions: 40,
          deletions: 0,
        },
      },
      [
        { role: "user", content: "review #37" },
        { role: "assistant", content: "  有界審查已完成，交付於 RESULT.md。  " },
      ],
    );

    expect(result).toEqual({
      terminalId: "issue37-review-worker",
      lifecycleState: "completed",
      lifecycleReason: null,
      agentProvider: "codex",
      model: "gpt-5.6-sol",
      completionSummary: {
        commits: [{ hash: "abc1234", message: "docs: result" }],
        branch: "octogent/issue37-review-worker",
        merged: false,
        filesChanged: 1,
        insertions: 40,
        deletions: 0,
      },
      lastAssistantMessage: "有界審查已完成，交付於 RESULT.md。",
      finishedWell: true,
    });
  });

  it("falls back to the observed model and tolerates a missing conversation", () => {
    const result = buildTerminalResult(
      {
        terminalId: "t-1",
        lifecycleState: "stopped",
        lifecycleReason: "session_close",
        agentModelObserved: "claude-fable-5-1",
      },
      null,
    );
    expect(result.model).toBe("claude-fable-5-1");
    expect(result.lastAssistantMessage).toBeNull();
    expect(result.completionSummary).toBeNull();
    expect(result.finishedWell).toBe(false);
  });

  it("picks the last non-empty assistant turn", () => {
    expect(
      lastAssistantMessage([
        { role: "assistant", content: "first" },
        { role: "user", content: "more" },
        { role: "assistant", content: "   " },
      ]),
    ).toBe("first");
    expect(lastAssistantMessage("nope")).toBeNull();
  });
});
