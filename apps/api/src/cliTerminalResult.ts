import {
  type Locale,
  type TerminalProviderError,
  isTerminalProviderErrorKind,
  t,
} from "@octogent/core";

import type { TerminalScreen } from "./cliTerminalScreen";

/**
 * Pure helpers behind `octogent terminal wait` and `octogent terminal result`.
 *
 * A headless coordinator (a Codex or Claude session driving Octogent over
 * the CLI) had no way to learn that a worker finished or what it answered
 * short of attaching to the terminal's WebSocket by hand; the trial on
 * 2026-09-09 stalled on exactly that. These helpers turn a terminal
 * snapshot plus its stored conversation into one answer block.
 */

/** Lifecycle states after which nothing more will happen without an operator. */
const SETTLED_LIFECYCLES: ReadonlySet<string> = new Set([
  "awaiting-review",
  "completed",
  "stopped",
  "exited",
  "stale",
]);

const FINISHED_WELL_LIFECYCLES: ReadonlySet<string> = new Set(["awaiting-review", "completed"]);

export const isSettledLifecycle = (lifecycleState: unknown): boolean =>
  typeof lifecycleState === "string" && SETTLED_LIFECYCLES.has(lifecycleState);

export const isFinishedWell = (lifecycleState: unknown): boolean =>
  typeof lifecycleState === "string" && FINISHED_WELL_LIFECYCLES.has(lifecycleState);

/** The agent's last message, as stored from its Stop hook; null when there is none yet. */
export const lastAssistantMessage = (turns: unknown): string | null => {
  if (!Array.isArray(turns)) {
    return null;
  }
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index] as { role?: unknown; content?: unknown };
    if (turn && turn.role === "assistant" && typeof turn.content === "string") {
      const content = turn.content.trim();
      if (content.length > 0) {
        return content;
      }
    }
  }
  return null;
};

export type TerminalResult = {
  terminalId: string;
  lifecycleState: string;
  lifecycleReason: string | null;
  attentionSince: string | null;
  attentionKind: "permission" | "user" | null;
  attentionToolName: string | null;
  providerError: TerminalProviderError | null;
  agentProvider: string | null;
  model: string | null;
  completionSummary: {
    commits: Array<{ hash: string; message: string }>;
    branch: string | null;
    merged: boolean;
    filesChanged: number;
    insertions: number;
    deletions: number;
  } | null;
  lastAssistantMessage: string | null;
  finishedWell: boolean;
  /** Names passed with `--inherit-env` at creation; only present when there were any. */
  inheritedEnv?: string[];
  screen?: TerminalScreen | null;
};

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);

/** The snapshot's provider error, or null when absent or malformed. */
const readProviderError = (snapshot: Record<string, unknown>): TerminalProviderError | null => {
  const value = snapshot.providerError as Record<string, unknown> | undefined;
  if (
    !value ||
    typeof value !== "object" ||
    !isTerminalProviderErrorKind(value.kind) ||
    typeof value.message !== "string" ||
    !Number.isFinite(Date.parse(asString(value.at) ?? ""))
  ) {
    return null;
  }
  return { kind: value.kind, message: value.message, at: value.at as string };
};

export const buildTerminalResult = (
  snapshot: Record<string, unknown>,
  turns: unknown,
  screen?: TerminalScreen | null,
): TerminalResult => {
  const lifecycleState = asString(snapshot.lifecycleState) ?? asString(snapshot.state) ?? "unknown";
  const summary = snapshot.completionSummary as Record<string, unknown> | undefined;
  const commits = Array.isArray(summary?.commits)
    ? summary.commits
        .map((commit) => commit as Record<string, unknown>)
        .map((commit) => ({
          hash: asString(commit.hash) ?? "",
          message: asString(commit.message) ?? "",
        }))
    : [];
  const inheritedEnv = Array.isArray(snapshot.inheritedEnv)
    ? snapshot.inheritedEnv.filter((name): name is string => typeof name === "string")
    : [];
  return {
    ...(screen !== undefined ? { screen } : {}),
    ...(inheritedEnv.length > 0 ? { inheritedEnv } : {}),
    terminalId: asString(snapshot.terminalId) ?? "",
    lifecycleState,
    lifecycleReason: asString(snapshot.lifecycleReason),
    attentionSince: asString(snapshot.attentionSince),
    attentionKind: attentionKind(snapshot),
    attentionToolName: asString(snapshot.attentionToolName),
    providerError: readProviderError(snapshot),
    agentProvider: asString(snapshot.agentProvider),
    model: asString(snapshot.agentModel) ?? asString(snapshot.agentModelObserved),
    completionSummary: summary
      ? {
          commits,
          branch: asString(summary.branch),
          merged: summary.merged === true,
          filesChanged: asNumber(summary.filesChanged),
          insertions: asNumber(summary.insertions),
          deletions: asNumber(summary.deletions),
        }
      : null,
    lastAssistantMessage: lastAssistantMessage(turns),
    finishedWell: isFinishedWell(lifecycleState),
  };
};

export type TerminalWaitArgs =
  | {
      ok: true;
      terminalIds: string[];
      timeoutMs: number;
      attentionAfterMs: number;
      intervalMs: number;
      json: boolean;
    }
  | {
      ok: false;
      errorKey: "cli.error.terminalIdRequired" | "cli.error.invalidNumberFlag";
      flag?: string;
    };

const DEFAULT_WAIT_INTERVAL_MS = 5_000;

/**
 * `wait <id> [<id>...] [--timeout <seconds>] [--interval <seconds>]
 * [--attention-after <seconds>] [--json]`.
 * A timeout of 0 (the default) waits forever; the interval never drops below
 * one second so a tight loop cannot hammer the API.
 */
export const parseTerminalWaitArgs = (rest: string[]): TerminalWaitArgs => {
  const terminalIds: string[] = [];
  let timeoutMs = 0;
  let attentionAfterMs = 60_000;
  let intervalMs = DEFAULT_WAIT_INTERVAL_MS;
  let json = false;
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index] ?? "";
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--timeout" || token === "--interval" || token === "--attention-after") {
      const raw = rest[index + 1];
      const parsed = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
      if (!Number.isFinite(parsed * 1000) || parsed < 0) {
        return { ok: false, errorKey: "cli.error.invalidNumberFlag", flag: token };
      }
      if (token === "--timeout") {
        timeoutMs = Math.floor(parsed * 1000);
      } else if (token === "--attention-after") {
        attentionAfterMs = Math.floor(parsed * 1000);
      } else {
        intervalMs = Math.max(1_000, Math.floor(parsed * 1000));
      }
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    terminalIds.push(token);
  }
  if (terminalIds.length === 0) {
    return { ok: false, errorKey: "cli.error.terminalIdRequired" };
  }
  return { ok: true, terminalIds, timeoutMs, attentionAfterMs, intervalMs, json };
};

const attentionKind = (snapshot: Record<string, unknown>): "permission" | "user" | null =>
  snapshot.attentionKind === "permission" || snapshot.attentionKind === "user"
    ? snapshot.attentionKind
    : null;

/**
 * How long a provider error must stand before `wait` gives up on the worker.
 * Shorter than the dialog default: nothing on the worker's side will lift a
 * usage limit, and a coordinator that keeps waiting just re-dispatches into
 * the same wall. The grace covers a banner the CLI recovers from by itself.
 */
export const PROVIDER_ERROR_ATTENTION_MS = 30_000;

export const needsAttention = (
  snapshot: Record<string, unknown>,
  nowMs: number,
  afterMs: number,
): boolean => {
  if (afterMs <= 0 || isSettledLifecycle(snapshot.lifecycleState ?? snapshot.state)) return false;
  const providerError = readProviderError(snapshot);
  if (providerError && nowMs - Date.parse(providerError.at) >= PROVIDER_ERROR_ATTENTION_MS) {
    return true;
  }
  if (!attentionKind(snapshot)) return false;
  const since = Date.parse(asString(snapshot.attentionSince) ?? "");
  return Number.isFinite(since) && nowMs - since >= afterMs;
};

export const formatTerminalAttention = (
  snapshot: Record<string, unknown>,
  nowMs: number,
): string | null => {
  const kind = attentionKind(snapshot);
  const since = Date.parse(asString(snapshot.attentionSince) ?? "");
  if (!kind || !Number.isFinite(since)) return null;
  const seconds = Math.max(0, Math.floor((nowMs - since) / 1000));
  const age = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  const tool = asString(snapshot.attentionToolName);
  return `${kind}${tool ? `:${tool}` : ""} ${age}`;
};

/** One `octogent terminal list` line. */
export const formatTerminalListLine = (
  snapshot: Record<string, unknown>,
  nowMs: number,
): string => {
  const terminalId = String(snapshot.terminalId ?? "");
  const name = String(snapshot.tentacleName ?? snapshot.label ?? terminalId);
  const lifecycle = String(snapshot.lifecycleState ?? snapshot.state ?? "unknown");
  const pid =
    typeof snapshot.processId === "number" && Number.isFinite(snapshot.processId)
      ? ` pid=${snapshot.processId}`
      : "";
  const reason =
    typeof snapshot.lifecycleReason === "string" ? ` reason=${snapshot.lifecycleReason}` : "";
  const modelValue = asString(snapshot.agentModel) ?? asString(snapshot.agentModelObserved);
  const provider =
    typeof snapshot.agentProvider === "string" ? ` agent=${snapshot.agentProvider}` : "";
  const model = modelValue ? ` model=${modelValue}` : "";
  const attention = formatTerminalAttention(snapshot, nowMs);
  const providerError = readProviderError(snapshot);
  return `  ${terminalId}  ${lifecycle}${pid}${provider}${model}${reason}  ${name}${attention ? ` waiting=${attention}` : ""}${providerError ? ` error=${providerError.kind}` : ""}`;
};

export const formatProviderErrorLine = (error: TerminalProviderError, locale: Locale): string =>
  `${t(locale, "cli.result.providerError")}: ${error.kind} — ${error.message} (${t(locale, "cli.result.attentionSince", { since: error.at })})`;
