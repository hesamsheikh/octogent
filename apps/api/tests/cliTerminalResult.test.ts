import { describe, expect, it } from "vitest";

import {
  PROVIDER_ERROR_ATTENTION_MS,
  buildTerminalResult,
  formatProviderErrorLine,
  formatTerminalAttention,
  formatTerminalListLine,
  isFinishedWell,
  isSettledLifecycle,
  lastAssistantMessage,
  needsAttention,
  parseTerminalWaitArgs,
} from "../src/cliTerminalResult";

describe("parseTerminalWaitArgs", () => {
  it("collects terminal ids and defaults to no timeout and a 5s interval", () => {
    expect(parseTerminalWaitArgs(["t-1", "t-2"])).toEqual({
      ok: true,
      terminalIds: ["t-1", "t-2"],
      timeoutMs: 0,
      attentionAfterMs: 60_000,
      intervalMs: 5_000,
      json: false,
    });
  });

  it("reads --timeout and --interval in seconds and --json", () => {
    expect(parseTerminalWaitArgs(["t-1", "--timeout", "600", "--interval", "2", "--json"])).toEqual(
      {
        ok: true,
        terminalIds: ["t-1"],
        timeoutMs: 600_000,
        attentionAfterMs: 60_000,
        intervalMs: 2_000,
        json: true,
      },
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
      attentionKind: null,
      attentionSince: null,
      attentionToolName: null,
      providerError: null,
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

  it("lists the variable names the terminal inherited from its creator", () => {
    const result = buildTerminalResult(
      { terminalId: "t-2", lifecycleState: "running", inheritedEnv: ["PATH", "VIRTUAL_ENV", 7] },
      null,
    );
    expect(result.inheritedEnv).toEqual(["PATH", "VIRTUAL_ENV"]);
    expect(buildTerminalResult({ terminalId: "t-3" }, null)).not.toHaveProperty("inheritedEnv");
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

describe("terminal attention", () => {
  const since = "2026-09-21T12:03:04.000Z";
  const snapshot = {
    lifecycleState: "running",
    attentionKind: "permission",
    attentionSince: since,
    attentionToolName: "Read",
  };
  const now = Date.parse(since) + 7 * 60_000;

  it("parses attention seconds, including disabling", () => {
    expect(parseTerminalWaitArgs(["t", "--attention-after", "2.5"])).toMatchObject({
      ok: true,
      attentionAfterMs: 2500,
    });
    expect(parseTerminalWaitArgs(["t", "--attention-after", "0"])).toMatchObject({
      ok: true,
      attentionAfterMs: 0,
    });
    for (const raw of ["-1", "NaN", "Infinity", "", "1e309"]) {
      expect(parseTerminalWaitArgs(["t", "--attention-after", raw])).toMatchObject({ ok: false });
    }
    expect(parseTerminalWaitArgs(["t", "--attention-after"])).toMatchObject({ ok: false });
  });

  it("decides using wait age, ignoring disabled, invalid and settled snapshots", () => {
    expect(needsAttention(snapshot, now, 60_000)).toBe(true);
    expect(
      needsAttention(
        { ...snapshot, attentionKind: "user", lifecycleState: "stalled" },
        now,
        60_000,
      ),
    ).toBe(true);
    expect(needsAttention(snapshot, now, 0)).toBe(false);
    expect(needsAttention(snapshot, Date.parse(since) + 59_999, 60_000)).toBe(false);
    expect(needsAttention(snapshot, Date.parse(since) + 60_000, 60_000)).toBe(true);
    for (const change of [
      { attentionSince: "bad" },
      { attentionSince: undefined },
      { attentionKind: "bad" },
      { lifecycleState: "stopped" },
    ]) {
      expect(needsAttention({ ...snapshot, ...change }, now, 60_000)).toBe(false);
    }
  });

  it("exposes result fields and formats list age", () => {
    expect(buildTerminalResult(snapshot, [])).toMatchObject({
      attentionKind: "permission",
      attentionSince: since,
      attentionToolName: "Read",
    });
    expect(formatTerminalAttention(snapshot, now)).toBe("permission:Read 7m");
    expect(
      formatTerminalAttention(
        { attentionKind: "user", attentionSince: since },
        Date.parse(since) + 180_000,
      ),
    ).toBe("user 3m");
    expect(formatTerminalAttention({}, now)).toBeNull();
  });
});

describe("provider errors", () => {
  const at = "2026-09-21T12:03:04.000Z";
  const providerError = {
    kind: "usage-limit" as const,
    message: "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage.",
    at,
  };
  const snapshot = {
    terminalId: "worker",
    tentacleName: "Worker",
    lifecycleState: "running",
    lifecycleReason: `provider error: ${providerError.message}`,
    agentProvider: "codex",
    providerError,
  };

  it("exposes the error in the result and drops malformed ones", () => {
    expect(buildTerminalResult(snapshot, []).providerError).toEqual(providerError);
    for (const broken of [
      { ...providerError, kind: "quota" },
      { ...providerError, message: 1 },
      { ...providerError, at: "bad" },
      "usage-limit",
    ]) {
      expect(buildTerminalResult({ ...snapshot, providerError: broken }, []).providerError).toBe(
        null,
      );
    }
  });

  it("appends error=<kind> to the list line", () => {
    expect(formatTerminalListLine(snapshot, Date.parse(at))).toBe(
      `  worker  running agent=codex reason=provider error: ${providerError.message}  Worker error=usage-limit`,
    );
    expect(
      formatTerminalListLine({ ...snapshot, providerError: undefined }, Date.parse(at)),
    ).not.toContain("error=");
  });

  it("formats the result line in both languages", () => {
    expect(formatProviderErrorLine(providerError, "en")).toBe(
      `Provider error: usage-limit — ${providerError.message} (since ${at})`,
    );
    expect(formatProviderErrorLine(providerError, "zh-CN")).toBe(
      `服务商错误: usage-limit — ${providerError.message} (自 ${at} 起)`,
    );
  });

  it("needs attention once the error is 30 s old, unless settled or disabled", () => {
    const since = Date.parse(at);
    expect(PROVIDER_ERROR_ATTENTION_MS).toBe(30_000);
    expect(needsAttention(snapshot, since + 29_999, 60_000)).toBe(false);
    expect(needsAttention(snapshot, since + 30_000, 60_000)).toBe(true);
    // The provider wall does not wait for the longer dialog threshold.
    expect(needsAttention(snapshot, since + 30_000, 600_000)).toBe(true);
    expect(needsAttention({ ...snapshot, lifecycleState: "stalled" }, since + 30_000, 60_000)).toBe(
      true,
    );
    expect(needsAttention({ ...snapshot, lifecycleState: "exited" }, since + 30_000, 60_000)).toBe(
      false,
    );
    expect(needsAttention(snapshot, since + 30_000, 0)).toBe(false);
  });
});
