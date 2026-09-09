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
};

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);

export const buildTerminalResult = (
  snapshot: Record<string, unknown>,
  turns: unknown,
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
  return {
    terminalId: asString(snapshot.terminalId) ?? "",
    lifecycleState,
    lifecycleReason: asString(snapshot.lifecycleReason),
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
 * `wait <id> [<id>...] [--timeout <seconds>] [--interval <seconds>] [--json]`.
 * A timeout of 0 (the default) waits forever; the interval never drops below
 * one second so a tight loop cannot hammer the API.
 */
export const parseTerminalWaitArgs = (rest: string[]): TerminalWaitArgs => {
  const terminalIds: string[] = [];
  let timeoutMs = 0;
  let intervalMs = DEFAULT_WAIT_INTERVAL_MS;
  let json = false;
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index] ?? "";
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--timeout" || token === "--interval") {
      const raw = rest[index + 1];
      const parsed = raw === undefined ? Number.NaN : Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return { ok: false, errorKey: "cli.error.invalidNumberFlag", flag: token };
      }
      if (token === "--timeout") {
        timeoutMs = Math.floor(parsed * 1000);
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
  return { ok: true, terminalIds, timeoutMs, intervalMs, json };
};
