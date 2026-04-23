import { execFile, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { type ClaudeUsageSnapshot, asNumber, asRecord, asString } from "@octogent/core";
import { logVerbose, logWarn } from "./logging";
import { toResetIso } from "./usageUtils";

const CLAUDE_CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_USAGE_BETA_HEADER = "oauth-2025-04-20";

const CLI_PTY_TIMEOUT_MS = 25_000;
const CLI_PTY_SETTLE_MS = 3_500;
const CLI_PTY_ENTER_INTERVAL_MS = 600;
const CLI_PTY_POST_USAGE_GRACE_MS = 2_500;
const CLI_PTY_READY_DELAY_MS = 900;
const CLI_PTY_USAGE_RETRY_MS = 3_000;
const CLI_PTY_COLS = 160;
const CLI_PTY_ROWS = 50;

/** Like core's `asString`, but trims whitespace and rejects empty strings. */
const asTrimmedString = (value: unknown): string | null => {
  const raw = asString(value);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export type { ClaudeUsageSnapshot };

type ClaudeUsageStatus = ClaudeUsageSnapshot["status"];

type ClaudeOauthCredentials = {
  accessToken: string;
  scopes: string[];
  rateLimitTier: string | null;
};

type ClaudeUsageDependencies = {
  now?: () => Date;
  readCredentialsJson?: () => Promise<unknown>;
  fetchImpl?: typeof fetch;
  spawnCliUsage?: () => Promise<string | null>;
  projectStateDir?: string;
  backgroundRefreshOnly?: boolean;
};

const unavailableSnapshot = (
  now: Date,
  message: string,
  status: ClaudeUsageStatus = "unavailable",
): ClaudeUsageSnapshot => ({
  status,
  fetchedAt: now.toISOString(),
  source: "none",
  message,
});

const normalizeScopes = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => asTrimmedString(item))
      .filter((item): item is string => item !== null);
  }

  const scopeString = asTrimmedString(value);
  if (!scopeString) {
    return [];
  }

  return scopeString
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const readClaudeOauthCredentials = (credentialsJson: unknown): ClaudeOauthCredentials | null => {
  const record = asRecord(credentialsJson);
  if (!record) {
    return null;
  }

  const oauth = asRecord(record.claudeAiOauth ?? record.claude_ai_oauth);
  if (!oauth) {
    return null;
  }

  const accessToken = asTrimmedString(oauth.accessToken ?? oauth.access_token);
  if (!accessToken) {
    return null;
  }

  const scopes = normalizeScopes(oauth.scopes ?? oauth.scope);
  const rateLimitTier = asTrimmedString(oauth.rateLimitTier ?? oauth.rate_limit_tier);

  return {
    accessToken,
    scopes,
    rateLimitTier,
  };
};

const resolveUsageWindow = (
  usagePayload: Record<string, unknown>,
  key: "five_hour" | "seven_day" | "seven_day_sonnet" | "seven_day_opus",
): Record<string, unknown> | null => {
  const directWindow = asRecord(usagePayload[key]);
  if (directWindow) {
    return directWindow;
  }

  const rateLimits = asRecord(usagePayload.rate_limits ?? usagePayload.rateLimits);
  return asRecord(rateLimits?.[key]);
};

const readErrorMessage = (value: unknown): string | null => {
  const payload = asRecord(value);
  if (!payload) {
    return null;
  }

  const directMessage = asTrimmedString(payload.message);
  if (directMessage) {
    return directMessage;
  }

  const errorPayload = asRecord(payload.error);
  return asTrimmedString(errorPayload?.message);
};

const readUsageErrorMessage = async (response: Response): Promise<string | null> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("application/json")) {
      return readErrorMessage((await response.json()) as unknown);
    }
    return asTrimmedString(await response.text());
  } catch {
    return null;
  }
};

const readWindowPercent = (window: Record<string, unknown> | null): number | null =>
  asNumber(window?.used_percent ?? window?.usedPercent ?? window?.utilization);

const readWindowResetAt = (window: Record<string, unknown> | null): string | null =>
  toResetIso(window?.reset_at ?? window?.resetAt ?? window?.resets_at);

const inferPlanType = (rateLimitTier: string | null): string | null => {
  const tier = rateLimitTier?.toLowerCase() ?? "";
  if (tier.includes("max")) return "Claude Max";
  if (tier.includes("pro")) return "Claude Pro";
  if (tier.includes("team")) return "Claude Team";
  if (tier.includes("enterprise")) return "Claude Enterprise";
  return null;
};

const mapUsageSnapshot = (
  usageJson: unknown,
  now: Date,
  rateLimitTier: string | null,
): ClaudeUsageSnapshot => {
  const usagePayload = asRecord(usageJson);
  if (!usagePayload) {
    throw new Error("invalid_usage_payload");
  }

  const primaryWindow = resolveUsageWindow(usagePayload, "five_hour");
  const weeklyWindow =
    resolveUsageWindow(usagePayload, "seven_day") ??
    resolveUsageWindow(usagePayload, "seven_day_opus");
  const sonnetWindow = resolveUsageWindow(usagePayload, "seven_day_sonnet");

  const extraUsage = asRecord(usagePayload.extra_usage ?? usagePayload.extraUsage);
  let extraUsageCostUsed: number | null = null;
  let extraUsageCostLimit: number | null = null;
  if (extraUsage?.is_enabled === true || extraUsage?.isEnabled === true) {
    const rawUsed = asNumber(extraUsage.used_credits ?? extraUsage.usedCredits);
    const rawLimit = asNumber(extraUsage.monthly_limit ?? extraUsage.monthlyLimit);
    if (rawUsed !== null && rawLimit !== null) {
      extraUsageCostUsed = rawUsed / 100;
      extraUsageCostLimit = rawLimit / 100;
    }
  }

  return {
    status: "ok",
    fetchedAt: now.toISOString(),
    source: "oauth-api",
    planType:
      asTrimmedString(usagePayload.plan_type ?? usagePayload.planType) ??
      inferPlanType(rateLimitTier),
    primaryUsedPercent: readWindowPercent(primaryWindow),
    primaryResetAt: readWindowResetAt(primaryWindow),
    secondaryUsedPercent: readWindowPercent(weeklyWindow),
    secondaryResetAt: readWindowResetAt(weeklyWindow),
    sonnetUsedPercent: readWindowPercent(sonnetWindow),
    sonnetResetAt: readWindowResetAt(sonnetWindow),
    extraUsageCostUsed,
    extraUsageCostLimit,
  };
};

const readKeychainCredentials = (): Promise<string | null> =>
  new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve(null);
      return;
    }

    execFile(
      "security",
      ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
      { timeout: 5_000 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });

const readDefaultCredentialsJson = async (): Promise<unknown> => {
  const keychainText = await readKeychainCredentials();
  if (keychainText) {
    try {
      return JSON.parse(keychainText) as unknown;
    } catch {
      // keychain data is not valid JSON, fall through to file
    }
  }

  const fileText = await readFile(CLAUDE_CREDENTIALS_PATH, "utf8");
  return JSON.parse(fileText) as unknown;
};

// ---------------------------------------------------------------------------
// CLI PTY usage source — persistent singleton session (like CodexBar)
// ---------------------------------------------------------------------------

const ANSI_ESCAPE = String.fromCharCode(0x1b);
const ANSI_CSI_RE = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "gu");

export const stripAnsiCodes = (text: string): string => text.replace(ANSI_CSI_RE, "");

const STOP_NEEDLES = [
  "current week (all models)",
  "current week (opus)",
  "current week (sonnet only)",
  "current week (sonnet)",
  "current session",
  "failed to load usage data",
];

const USAGE_COMMAND_NEEDLES = ["/usage", "current week", "current session"];

const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/u;

const USED_KEYWORDS = ["used", "spent", "consumed"];
const REMAINING_KEYWORDS = ["left", "remaining", "available"];
const CLI_USAGE_LABEL_GROUPS = [
  ["current session"],
  ["current week (all models)", "current week (opus)"],
  ["current week (sonnet only)", "current week (sonnet)"],
] as const;

type ParsedCliUsage = {
  primaryUsedPercent: number | null;
  secondaryUsedPercent: number | null;
  sonnetUsedPercent: number | null;
};

const percentFromLine = (line: string): number | null => {
  const match = PERCENT_RE.exec(line);
  if (!match) return null;

  const percentText = match[1];
  if (!percentText) return null;

  const raw = Number.parseFloat(percentText);
  const clamped = Math.max(0, Math.min(100, raw));
  const lower = line.toLowerCase();
  const contextStart = Math.max(0, match.index - 16);
  const contextEnd = Math.min(lower.length, match.index + match[0].length + 24);
  const context = lower.slice(contextStart, contextEnd);

  // "2% used" → store as 2 (already represents usage)
  if (USED_KEYWORDS.some((kw) => context.includes(kw))) {
    return Math.round(clamped * 10) / 10;
  }

  // "98% remaining" → convert to used: 100 - 98 = 2
  if (REMAINING_KEYWORDS.some((kw) => context.includes(kw))) {
    return Math.round((100 - clamped) * 10) / 10;
  }

  // Default: assume it's "used" (Claude CLI convention per screenshot)
  return Math.round(clamped * 10) / 10;
};

const normalizeCliText = (text: string): string => text.toLowerCase().replace(/\s+/gu, " ");

const findLabelMatch = (
  normalizedText: string,
  labelSubstrings: readonly string[],
): { index: number; label: string } | null => {
  let bestMatch: { index: number; label: string } | null = null;

  for (const label of labelSubstrings) {
    const index = normalizedText.indexOf(label);
    if (index === -1) continue;
    if (bestMatch === null || index < bestMatch.index) {
      bestMatch = { index, label };
    }
  }

  return bestMatch;
};

const extractLabeledPercent = (
  cleanOutput: string,
  labelSubstrings: readonly string[],
): number | null => {
  const normalizedText = normalizeCliText(cleanOutput);
  const match = findLabelMatch(normalizedText, labelSubstrings);
  if (!match) {
    return null;
  }

  const start = match.index + match.label.length;
  let end = normalizedText.length;

  for (const labels of CLI_USAGE_LABEL_GROUPS) {
    const nextMatch = findLabelMatch(normalizedText.slice(start), labels);
    if (!nextMatch) continue;
    end = Math.min(end, start + nextMatch.index);
  }

  return percentFromLine(normalizedText.slice(start, end));
};

export const parseCliUsageOutput = (rawOutput: string): ParsedCliUsage => {
  const clean = stripAnsiCodes(rawOutput);
  const primaryUsedPercent = extractLabeledPercent(clean, ["current session"]);
  const secondaryUsedPercent = extractLabeledPercent(clean, [
    "current week (all models)",
    "current week (opus)",
  ]);
  const sonnetUsedPercent = extractLabeledPercent(clean, [
    "current week (sonnet only)",
    "current week (sonnet)",
  ]);

  return { primaryUsedPercent, secondaryUsedPercent, sonnetUsedPercent };
};

const resolveClaudeBinary = (): string | null => {
  try {
    const result = execFileSync("which", ["claude"], {
      timeout: 3_000,
      encoding: "utf8",
    }).trim();
    return result || null;
  } catch {
    return null;
  }
};

const scrubbedEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "CLAUDECODE") continue;
    if (key.startsWith("ANTHROPIC_")) continue;
    if (value !== undefined) env[key] = value;
  }
  return env;
};

// ---------------------------------------------------------------------------
// CLI PTY spawn — fresh process each time, results cached
// ---------------------------------------------------------------------------

let cachedSnapshot: { snapshot: ClaudeUsageSnapshot; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 300_000;
let refreshInFlight: Promise<ClaudeUsageSnapshot> | null = null;
const CLAUDE_USAGE_SNAPSHOT_FILENAME = "claude-usage-snapshot.json";

const getCachedOkSnapshot = (): ClaudeUsageSnapshot | null =>
  cachedSnapshot?.snapshot.status === "ok" ? cachedSnapshot.snapshot : null;

const resolveSnapshotPath = (projectStateDir: string | undefined): string | null =>
  projectStateDir ? join(projectStateDir, "state", CLAUDE_USAGE_SNAPSHOT_FILENAME) : null;

const normalizePersistedSnapshot = (value: unknown): ClaudeUsageSnapshot | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const status = asTrimmedString(record.status);
  const source = asTrimmedString(record.source);
  const fetchedAt = asTrimmedString(record.fetchedAt);
  if (status !== "ok" || (source !== "cli-pty" && source !== "oauth-api") || fetchedAt === null) {
    return null;
  }

  return {
    status,
    source,
    fetchedAt,
    message: asTrimmedString(record.message),
    planType: asTrimmedString(record.planType),
    primaryUsedPercent: asNumber(record.primaryUsedPercent),
    primaryResetAt: asTrimmedString(record.primaryResetAt),
    secondaryUsedPercent: asNumber(record.secondaryUsedPercent),
    secondaryResetAt: asTrimmedString(record.secondaryResetAt),
    sonnetUsedPercent: asNumber(record.sonnetUsedPercent),
    sonnetResetAt: asTrimmedString(record.sonnetResetAt),
    extraUsageCostUsed: asNumber(record.extraUsageCostUsed),
    extraUsageCostLimit: asNumber(record.extraUsageCostLimit),
  };
};

const readPersistedOkSnapshot = async (
  projectStateDir: string | undefined,
): Promise<ClaudeUsageSnapshot | null> => {
  const snapshotPath = resolveSnapshotPath(projectStateDir);
  if (!snapshotPath) {
    return null;
  }

  try {
    const raw = await readFile(snapshotPath, "utf8");
    return normalizePersistedSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
};

const persistOkSnapshot = async (
  snapshot: ClaudeUsageSnapshot,
  projectStateDir: string | undefined,
): Promise<void> => {
  if (snapshot.status !== "ok") {
    return;
  }

  const snapshotPath = resolveSnapshotPath(projectStateDir);
  if (!snapshotPath) {
    return;
  }

  try {
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
  } catch (error) {
    logWarn(
      `[claude-usage] unable to persist snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const cacheOkSnapshot = async (
  snapshot: ClaudeUsageSnapshot,
  projectStateDir: string | undefined,
): Promise<ClaudeUsageSnapshot> => {
  cachedSnapshot = { snapshot, fetchedAt: Date.now() };
  await persistOkSnapshot(snapshot, projectStateDir);
  return snapshot;
};

// Patterns that indicate the CLI welcome screen has fully rendered.
// After ANSI stripping, cursor-movement codes collapse spaces, so we
// match with all whitespace removed (e.g. "tipsforgettingstarted").
const READY_NEEDLES = [
  "tipsforgettingstarted",
  "recentactivity",
  "welcomeback",
  "whatcanihelpyouwith",
];

const isClaudeCliReady = (normalized: string, collapsed: string): boolean => {
  if (READY_NEEDLES.some((needle) => collapsed.includes(needle))) {
    return true;
  }

  // Claude Code v2.1.x can land directly on the shell prompt instead of the
  // older welcome copy. In that mode we see the product header and a visible
  // prompt glyph, but none of the historical ready markers.
  return collapsed.includes("claudecodev") && normalized.includes("❯");
};

const spawnCliAndCapture = (binary: string): Promise<string | null> =>
  new Promise<string | null>((resolve) => {
    import("node-pty")
      .then((pty) => {
        let buffer = "";
        let usageBuffer = "";
        let done = false;
        let phase: "waiting" | "capturing" = "waiting";
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        let enterTimer: ReturnType<typeof setInterval> | null = null;
        let usageRetryTimer: ReturnType<typeof setTimeout> | null = null;
        let usageSentAt = 0;
        let usageSendCount = 0;

        const term = pty.spawn(binary, ["--allowed-tools", ""], {
          name: "xterm-256color",
          cols: CLI_PTY_COLS,
          rows: CLI_PTY_ROWS,
          env: scrubbedEnv(),
        });

        const finish = (result: string | null) => {
          if (done) return;
          done = true;
          if (deadlineTimer) clearTimeout(deadlineTimer);
          if (settleTimer) clearTimeout(settleTimer);
          if (enterTimer) clearInterval(enterTimer);
          if (usageRetryTimer) clearTimeout(usageRetryTimer);
          try {
            term.kill();
          } catch {
            /* already dead */
          }
          resolve(result);
        };

        const deadlineTimer = setTimeout(() => {
          finish(usageBuffer.length > 0 ? usageBuffer : buffer.length > 0 ? buffer : null);
        }, CLI_PTY_TIMEOUT_MS);

        const sendUsageCommand = () => {
          if (phase === "waiting") {
            phase = "capturing";
          }

          // Capture only the latest /usage render, not the startup shell.
          usageBuffer = "";
          usageSentAt = Date.now();
          usageSendCount += 1;
          logVerbose("[claude-usage] CLI ready, sending /usage");
          try {
            term.write("/usage\r");
          } catch {
            finish(null);
            return;
          }
          // Periodic Enter presses to refresh TUI render
          enterTimer = setInterval(() => {
            try {
              term.write("\r");
            } catch {
              /* ignore */
            }
          }, CLI_PTY_ENTER_INTERVAL_MS);

          if (usageRetryTimer) clearTimeout(usageRetryTimer);
          usageRetryTimer = setTimeout(() => {
            const usageCollapsed = stripAnsiCodes(usageBuffer).toLowerCase().replace(/\s+/gu, "");
            const sawStopNeedle = STOP_NEEDLES.some((needle) =>
              usageCollapsed.includes(needle.replace(/\s+/gu, "")),
            );
            if (!done && usageSendCount < 2 && !sawStopNeedle) {
              logVerbose("[claude-usage] CLI usage view did not render yet, retrying /usage");
              sendUsageCommand();
            }
          }, CLI_PTY_USAGE_RETRY_MS);
        };

        term.onData((data: string) => {
          buffer += data;
          if (phase === "capturing") {
            usageBuffer += data;
          }

          const normalized = stripAnsiCodes(buffer).toLowerCase();

          const collapsed = normalized.replace(/\s+/gu, "");

          // Handle trust prompts
          if (collapsed.includes("doyoutrust")) {
            try {
              term.write("y\r");
            } catch {
              /* ignore */
            }
            return;
          }

          // Phase 1: wait for welcome screen to render, then send /usage
          if (phase === "waiting") {
            if (isClaudeCliReady(normalized, collapsed)) {
              phase = "capturing";
              usageBuffer = "";
              setTimeout(() => {
                if (!done && phase === "capturing" && usageSendCount === 0) {
                  sendUsageCommand();
                }
              }, CLI_PTY_READY_DELAY_MS);
            }
            return;
          }

          // Phase 2: capturing /usage output — look for stop needles
          const usageCollapsed = stripAnsiCodes(usageBuffer).toLowerCase().replace(/\s+/gu, "");
          const sawUsageCommand = USAGE_COMMAND_NEEDLES.some((needle) =>
            usageCollapsed.includes(needle.replace(/\s+/gu, "")),
          );
          const usageGraceElapsed = Date.now() - usageSentAt >= CLI_PTY_POST_USAGE_GRACE_MS;
          if (
            !settleTimer &&
            usageGraceElapsed &&
            sawUsageCommand &&
            STOP_NEEDLES.some((n) => usageCollapsed.includes(n.replace(/\s+/gu, "")))
          ) {
            settleTimer = setTimeout(() => finish(usageBuffer), CLI_PTY_SETTLE_MS);
          }
        });

        term.onExit(() =>
          finish(usageBuffer.length > 0 ? usageBuffer : buffer.length > 0 ? buffer : null),
        );
      })
      .catch(() => resolve(null));
  });

const spawnDefaultCliUsage = async (): Promise<string | null> => {
  const binary = resolveClaudeBinary();
  if (!binary) return null;
  return spawnCliAndCapture(binary);
};

/** Exported for testing — resets the snapshot cache. */
export const resetCliSession = (): void => {
  cachedSnapshot = null;
  refreshInFlight = null;
};

/** Clears the cached usage snapshot so the next read triggers a fresh fetch. */
export const invalidateUsageCache = (): void => {
  cachedSnapshot = null;
  refreshInFlight = null;
};

const readOauthUsageSnapshot = async (
  now: Date,
  readCredentialsJson: () => Promise<unknown>,
  fetchImpl: typeof fetch,
): Promise<ClaudeUsageSnapshot> => {
  let credentialsJson: unknown;
  try {
    credentialsJson = await readCredentialsJson();
  } catch (error) {
    const errorCode =
      typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (errorCode === "ENOENT") {
      return unavailableSnapshot(now, "Claude credentials not found. Run `claude login`.");
    }
    return unavailableSnapshot(now, "Unable to read Claude credentials.", "error");
  }

  const oauthCredentials = readClaudeOauthCredentials(credentialsJson);
  if (!oauthCredentials) {
    return unavailableSnapshot(now, "Claude OAuth access token is missing. Re-run `claude login`.");
  }

  if (!oauthCredentials.scopes.includes("user:profile")) {
    return unavailableSnapshot(
      now,
      "Claude OAuth credentials are missing the required `user:profile` scope. Re-run `claude login`.",
    );
  }

  try {
    const usageResponse = await fetchImpl(CLAUDE_OAUTH_USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${oauthCredentials.accessToken}`,
        "anthropic-beta": CLAUDE_OAUTH_USAGE_BETA_HEADER,
      },
    });

    if (usageResponse.status === 401 || usageResponse.status === 403) {
      return unavailableSnapshot(
        now,
        "Claude OAuth token is expired or unauthorized. Re-run `claude login`.",
      );
    }

    if (!usageResponse.ok) {
      const usageErrorMessage = await readUsageErrorMessage(usageResponse);
      if (usageResponse.status === 429) {
        const retryAfterSeconds = asTrimmedString(usageResponse.headers.get("retry-after"));
        const retrySuffix =
          retryAfterSeconds && retryAfterSeconds.length > 0
            ? ` Retry after ${retryAfterSeconds}s.`
            : "";
        return unavailableSnapshot(
          now,
          usageErrorMessage ?? `Claude OAuth usage API is rate limited.${retrySuffix}`,
        );
      }

      return unavailableSnapshot(
        now,
        usageErrorMessage
          ? `${usageErrorMessage} (HTTP ${usageResponse.status}).`
          : `Claude OAuth usage request failed (HTTP ${usageResponse.status}).`,
        "error",
      );
    }

    const usageJson = (await usageResponse.json()) as unknown;
    return mapUsageSnapshot(usageJson, now, oauthCredentials.rateLimitTier);
  } catch {
    return unavailableSnapshot(now, "Unable to read Claude usage from OAuth API.", "error");
  }
};

const buildCliSnapshot = (parsed: ParsedCliUsage, now: Date): ClaudeUsageSnapshot => ({
  status: "ok",
  fetchedAt: now.toISOString(),
  source: "cli-pty",
  primaryUsedPercent: parsed.primaryUsedPercent,
  secondaryUsedPercent: parsed.secondaryUsedPercent,
  sonnetUsedPercent: parsed.sonnetUsedPercent,
  primaryResetAt: null,
  secondaryResetAt: null,
  sonnetResetAt: null,
});

const cliHasRealData = (parsed: ParsedCliUsage): boolean =>
  parsed.primaryUsedPercent !== null ||
  parsed.secondaryUsedPercent !== null ||
  parsed.sonnetUsedPercent !== null;

export const readClaudeOauthUsageSnapshot = async (
  dependencies: ClaudeUsageDependencies = {},
): Promise<ClaudeUsageSnapshot> => {
  const now = dependencies.now?.() ?? new Date();
  const readCredentialsJson = dependencies.readCredentialsJson ?? readDefaultCredentialsJson;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const snapshot = await readOauthUsageSnapshot(now, readCredentialsJson, fetchImpl);
  return snapshot.status === "ok"
    ? await cacheOkSnapshot(snapshot, dependencies.projectStateDir)
    : snapshot;
};

export const readClaudeCliUsageSnapshot = async (
  dependencies: ClaudeUsageDependencies = {},
): Promise<ClaudeUsageSnapshot> => {
  const now = dependencies.now?.() ?? new Date();
  const spawnCliUsage = dependencies.spawnCliUsage ?? spawnDefaultCliUsage;
  try {
    const cliOutput = await spawnCliUsage();
    if (cliOutput) {
      const cleaned = stripAnsiCodes(cliOutput);
      logVerbose(`[claude-usage] CLI PTY captured ${cleaned.length} chars`);
      const parsed = parseCliUsageOutput(cliOutput);
      if (cliHasRealData(parsed)) {
        logVerbose(
          `[claude-usage] CLI PTY parsed: session=${parsed.primaryUsedPercent}% week=${parsed.secondaryUsedPercent}% sonnet=${parsed.sonnetUsedPercent}%`,
        );
        return await cacheOkSnapshot(buildCliSnapshot(parsed, now), dependencies.projectStateDir);
      }
      logVerbose(
        `[claude-usage] CLI PTY output had no parseable usage data. First 500 chars:\n${cleaned.slice(0, 500)}`,
      );
    } else {
      logVerbose("[claude-usage] CLI PTY returned null (binary missing or node-pty unavailable)");
    }
  } catch (error) {
    logVerbose(
      `[claude-usage] CLI PTY error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return unavailableSnapshot(now, "Claude CLI usage unavailable.", "error");
};

const refreshClaudeUsageSnapshot = async (
  dependencies: ClaudeUsageDependencies = {},
): Promise<ClaudeUsageSnapshot> => {
  const now = dependencies.now?.() ?? new Date();

  // Prefer the CLI PTY path when it works, since it reflects Claude Code
  // usage directly and avoids OAuth API rate-limit failures.
  const spawnCliUsage = dependencies.spawnCliUsage ?? spawnDefaultCliUsage;
  try {
    const cliOutput = await spawnCliUsage();
    if (cliOutput) {
      const cleaned = stripAnsiCodes(cliOutput);
      logVerbose(`[claude-usage] CLI PTY captured ${cleaned.length} chars`);
      const parsed = parseCliUsageOutput(cliOutput);
      if (cliHasRealData(parsed)) {
        logVerbose(
          `[claude-usage] CLI PTY parsed: session=${parsed.primaryUsedPercent}% week=${parsed.secondaryUsedPercent}% sonnet=${parsed.sonnetUsedPercent}%`,
        );
        return await cacheOkSnapshot(buildCliSnapshot(parsed, now), dependencies.projectStateDir);
      }
      logVerbose(
        `[claude-usage] CLI PTY output had no parseable usage data. First 500 chars:\n${cleaned.slice(0, 500)}`,
      );
    } else {
      logVerbose("[claude-usage] CLI PTY returned null (binary missing or node-pty unavailable)");
    }
  } catch (error) {
    logVerbose(
      `[claude-usage] CLI PTY error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Fall back to OAuth API when CLI does not yield usable data.
  const readCredentialsJson = dependencies.readCredentialsJson ?? readDefaultCredentialsJson;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const oauthSnapshot = await readOauthUsageSnapshot(now, readCredentialsJson, fetchImpl);

  if (oauthSnapshot.status === "ok") {
    return await cacheOkSnapshot(oauthSnapshot, dependencies.projectStateDir);
  }

  const cachedOkSnapshot = getCachedOkSnapshot();
  const oauthReachedApi =
    oauthSnapshot.source === "none" &&
    oauthSnapshot.message != null &&
    !oauthSnapshot.message.includes("not found") &&
    !oauthSnapshot.message.includes("missing") &&
    !oauthSnapshot.message.includes("Re-run");

  if (oauthReachedApi) {
    logVerbose(`[claude-usage] OAuth API responded with error: ${oauthSnapshot.message}`);
    if (cachedOkSnapshot) {
      return { ...cachedOkSnapshot, fetchedAt: now.toISOString() };
    }
    return oauthSnapshot;
  }

  if (cachedOkSnapshot) {
    logVerbose(
      `[claude-usage] OAuth unavailable (${oauthSnapshot.message}), serving stale cached snapshot`,
    );
    return { ...cachedOkSnapshot, fetchedAt: now.toISOString() };
  }

  return oauthSnapshot;
};

const startBackgroundRefresh = (dependencies: ClaudeUsageDependencies = {}): void => {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = refreshClaudeUsageSnapshot(dependencies)
    .catch((error) => {
      logVerbose(
        `[claude-usage] background refresh error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return unavailableSnapshot(
        dependencies.now?.() ?? new Date(),
        "Unable to refresh Claude usage in background.",
        "error",
      );
    })
    .finally(() => {
      refreshInFlight = null;
    });
};

export const readClaudeUsageSnapshot = async (
  dependencies: ClaudeUsageDependencies = {},
): Promise<ClaudeUsageSnapshot> => {
  const now = dependencies.now?.() ?? new Date();
  const backgroundRefreshOnly = dependencies.backgroundRefreshOnly ?? false;

  // Return cached snapshot if fresh enough (prevents rate-limit storms)
  if (cachedSnapshot && Date.now() - cachedSnapshot.fetchedAt < CACHE_TTL_MS) {
    return { ...cachedSnapshot.snapshot, fetchedAt: now.toISOString() };
  }

  if (!cachedSnapshot) {
    const persistedSnapshot = await readPersistedOkSnapshot(dependencies.projectStateDir);
    if (persistedSnapshot) {
      cachedSnapshot = { snapshot: persistedSnapshot, fetchedAt: 0 };
    }
  }

  const cachedOkSnapshot = getCachedOkSnapshot();
  if (cachedOkSnapshot) {
    startBackgroundRefresh(dependencies);
    return { ...cachedOkSnapshot, fetchedAt: now.toISOString() };
  }

  if (backgroundRefreshOnly) {
    startBackgroundRefresh(dependencies);
    return unavailableSnapshot(now, "Claude usage refresh in progress.");
  }

  if (refreshInFlight) {
    const snapshot = await refreshInFlight;
    return snapshot.status === "ok" ? { ...snapshot, fetchedAt: now.toISOString() } : snapshot;
  }

  refreshInFlight = refreshClaudeUsageSnapshot(dependencies)
    .catch((error) => {
      logVerbose(
        `[claude-usage] refresh error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return unavailableSnapshot(now, "Unable to refresh Claude usage.", "error");
    })
    .finally(() => {
      refreshInFlight = null;
    });

  const snapshot = await refreshInFlight;
  return snapshot.status === "ok" ? { ...snapshot, fetchedAt: now.toISOString() } : snapshot;
};
