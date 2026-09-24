import type {
  ClaudeUsageSnapshot,
  CodexUsageSnapshot,
  TerminalAgentProvider,
} from "@octogent/core";

/**
 * Warns at `terminal create` time when the chosen provider is already out of
 * quota: a worker dispatched into an exhausted plan stops on its first
 * request, and coordinators kept re-dispatching into that wall (2026-09-21).
 * Only readings the usage routes already fetched are consulted, so creating a
 * terminal never waits on a provider's usage service.
 */

export type CachedUsageSnapshots = {
  codex: CodexUsageSnapshot | null;
  claude: ClaudeUsageSnapshot | null;
};

export type ExhaustedUsage = {
  provider: TerminalAgentProvider;
  bucket: string;
  /** Null when only an account-level limit flag says so. */
  usedPercent: number | null;
  resetAt: string | null;
};

type UsageBucket = Omit<ExhaustedUsage, "provider"> & { exhausted: boolean };

const windowBucket = (
  bucket: string,
  usedPercent: number | null | undefined,
  resetAt: string | null | undefined,
): UsageBucket => ({
  bucket,
  usedPercent: usedPercent ?? null,
  resetAt: resetAt ?? null,
  exhausted: typeof usedPercent === "number" && usedPercent >= 100,
});

const codexBuckets = (snapshot: CodexUsageSnapshot): UsageBucket[] => [
  windowBucket("5-hour", snapshot.primaryUsedPercent, snapshot.primaryResetAt),
  windowBucket("weekly", snapshot.secondaryUsedPercent, snapshot.secondaryResetAt),
  {
    bucket: "usage",
    usedPercent: null,
    resetAt: snapshot.primaryResetAt ?? null,
    exhausted: snapshot.limitReached === true,
  },
];

// Model-scoped weekly buckets only stop a worker that runs that model; with
// no model requested the CLI default is unknown here, so they are skipped.
const claudeBuckets = (snapshot: ClaudeUsageSnapshot, model: string | null): UsageBucket[] => {
  const modelName = model?.toLowerCase() ?? "";
  const buckets = [
    windowBucket("5-hour", snapshot.primaryUsedPercent, snapshot.primaryResetAt),
    windowBucket("weekly", snapshot.secondaryUsedPercent, snapshot.secondaryResetAt),
  ];
  if (modelName.includes("sonnet")) {
    buckets.push(windowBucket("weekly Sonnet", snapshot.sonnetUsedPercent, snapshot.sonnetResetAt));
  }
  const scopedLabel = snapshot.scopedLabel?.trim();
  const scopedFamily = scopedLabel?.split(/\s+/)[0]?.toLowerCase();
  if (scopedLabel && scopedFamily && modelName.includes(scopedFamily)) {
    buckets.push(
      windowBucket(`weekly ${scopedLabel}`, snapshot.scopedUsedPercent, snapshot.scopedResetAt),
    );
  }
  return buckets;
};

/** The first exhausted bucket that binds this worker, or null. */
export const findExhaustedUsage = (
  provider: TerminalAgentProvider,
  model: string | null,
  cached: CachedUsageSnapshots,
  nowMs: number,
): ExhaustedUsage | null => {
  const buckets =
    provider === "codex"
      ? cached.codex?.status === "ok"
        ? codexBuckets(cached.codex)
        : []
      : cached.claude?.status === "ok"
        ? claudeBuckets(cached.claude, model)
        : [];
  // A cached reading can outlive its window; a reset already past means the
  // quota has come back even though the reading still says 100%.
  const hit = buckets.find(
    (bucket) =>
      bucket.exhausted && !(bucket.resetAt !== null && Date.parse(bucket.resetAt) <= nowMs),
  );
  return hit
    ? { provider, bucket: hit.bucket, usedPercent: hit.usedPercent, resetAt: hit.resetAt }
    : null;
};

/** Wraps a usage reader so its last good reading stays available without another fetch. */
export const rememberUsageSnapshot =
  <T extends { status: string }>(read: () => Promise<T>, remember: (snapshot: T) => void) =>
  async (): Promise<T> => {
    const snapshot = await read();
    if (snapshot.status === "ok") {
      remember(snapshot);
    }
    return snapshot;
  };
