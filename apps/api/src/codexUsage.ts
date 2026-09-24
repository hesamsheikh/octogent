import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { type CodexUsageSnapshot, asNumber, asRecord, asString } from "@octogent/core";
import { toResetIso } from "./usageUtils";

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
const OAUTH_REFRESH_URL = "https://auth.openai.com/oauth/token";
const OAUTH_REFRESH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

const resolveCodexHome = (env: NodeJS.ProcessEnv): string => {
  const codexHome = env.CODEX_HOME?.trim();
  if (codexHome && codexHome.length > 0) {
    return codexHome;
  }
  return join(homedir(), ".codex");
};

type CodexCredentials = {
  accessToken: string;
  refreshToken: string | null;
  accountId: string | null;
  lastRefresh: Date | null;
};

type CodexUsageApiResponse = {
  plan_type?: unknown;
  rate_limit?: unknown;
  credits?: unknown;
};

type RefreshTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
};

export type { CodexUsageSnapshot };

type CodexUsageStatus = CodexUsageSnapshot["status"];

type CodexUsageDependencies = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  readFileText?: (path: string) => Promise<string>;
  writeFileText?: (path: string, contents: string) => Promise<void>;
  fetchImpl?: typeof fetch;
};

const unavailableSnapshot = (
  now: Date,
  message: string,
  status: CodexUsageStatus = "unavailable",
): CodexUsageSnapshot => ({
  status,
  source: "none",
  fetchedAt: now.toISOString(),
  message,
});

const mapUsageResponse = (response: CodexUsageApiResponse, now: Date): CodexUsageSnapshot => {
  const rateLimit = asRecord(response.rate_limit);
  const primaryWindow = asRecord(rateLimit?.primary_window);
  const secondaryWindow = asRecord(rateLimit?.secondary_window);
  const credits = asRecord(response.credits);

  return {
    status: "ok",
    source: "oauth-api",
    fetchedAt: now.toISOString(),
    planType: asString(response.plan_type),
    primaryUsedPercent: asNumber(primaryWindow?.used_percent),
    primaryResetAt: toResetIso(primaryWindow?.reset_at),
    secondaryUsedPercent: asNumber(secondaryWindow?.used_percent),
    secondaryResetAt: toResetIso(secondaryWindow?.reset_at),
    creditsBalance: asNumber(credits?.balance),
    creditsUnlimited: typeof credits?.unlimited === "boolean" ? credits.unlimited : null,
    limitReached: typeof rateLimit?.limit_reached === "boolean" ? rateLimit.limit_reached : null,
  };
};

const loadCredentials = (authJson: unknown): CodexCredentials | null => {
  const auth = asRecord(authJson);
  if (!auth) {
    return null;
  }

  const apiKey = auth.OPENAI_API_KEY;
  if (typeof apiKey === "string" && apiKey.trim().length > 0) {
    return {
      accessToken: apiKey.trim(),
      refreshToken: null,
      accountId: null,
      lastRefresh: null,
    };
  }

  const tokens = asRecord(auth.tokens);
  const accessToken = asString(tokens?.access_token)?.trim();
  if (!accessToken) {
    return null;
  }

  const refreshToken = asString(tokens?.refresh_token)?.trim() ?? null;
  const accountId = asString(tokens?.account_id)?.trim() ?? null;
  const lastRefreshRaw = asString(auth.last_refresh);
  const lastRefresh = lastRefreshRaw ? new Date(lastRefreshRaw) : null;

  return {
    accessToken,
    refreshToken: refreshToken && refreshToken.length > 0 ? refreshToken : null,
    accountId: accountId && accountId.length > 0 ? accountId : null,
    lastRefresh: lastRefresh && Number.isFinite(lastRefresh.getTime()) ? lastRefresh : null,
  };
};

const shouldRefreshToken = (credentials: CodexCredentials, now: Date) => {
  if (!credentials.refreshToken) {
    return false;
  }

  if (!credentials.lastRefresh) {
    return true;
  }

  return now.getTime() - credentials.lastRefresh.getTime() > EIGHT_DAYS_MS;
};

const refreshCredentials = async (
  authPath: string,
  authJson: Record<string, unknown>,
  credentials: CodexCredentials,
  now: Date,
  dependencies: Required<Omit<CodexUsageDependencies, "env" | "now">>,
): Promise<CodexCredentials> => {
  if (!credentials.refreshToken) {
    return credentials;
  }

  const refreshResponse = await dependencies.fetchImpl(OAUTH_REFRESH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: OAUTH_REFRESH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      scope: "openid profile email",
    }),
  });

  if (!refreshResponse.ok) {
    throw new Error(`oauth_refresh_failed_${refreshResponse.status}`);
  }

  const refreshPayload = (await refreshResponse.json()) as RefreshTokenResponse;
  const refreshedAccessToken = asString(refreshPayload.access_token)?.trim();
  if (!refreshedAccessToken) {
    throw new Error("oauth_refresh_missing_access_token");
  }

  const refreshedRefreshToken =
    asString(refreshPayload.refresh_token)?.trim() || credentials.refreshToken;

  const mergedTokens = {
    ...(asRecord(authJson.tokens) ?? {}),
    access_token: refreshedAccessToken,
    refresh_token: refreshedRefreshToken,
  };

  const nextAuthJson = {
    ...authJson,
    tokens: mergedTokens,
    last_refresh: now.toISOString(),
  };
  await dependencies.writeFileText(authPath, `${JSON.stringify(nextAuthJson, null, 2)}\n`);

  return {
    ...credentials,
    accessToken: refreshedAccessToken,
    refreshToken: refreshedRefreshToken,
    lastRefresh: now,
  };
};

export const readCodexUsageSnapshot = async (
  dependencies: CodexUsageDependencies = {},
): Promise<CodexUsageSnapshot> => {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now?.() ?? new Date();
  const readFileText = dependencies.readFileText ?? ((path: string) => readFile(path, "utf8"));
  const writeFileText =
    dependencies.writeFileText ??
    ((path: string, contents: string) => writeFile(path, contents, "utf8"));
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  const authPath = join(resolveCodexHome(env), "auth.json");

  let authText: string;
  try {
    authText = await readFileText(authPath);
  } catch (error) {
    const errorCode =
      typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (errorCode === "ENOENT") {
      return unavailableSnapshot(now, "Codex auth not found. Run `codex login`.");
    }
    return unavailableSnapshot(now, "Unable to read Codex auth file.", "error");
  }

  let authJson: unknown;
  try {
    authJson = JSON.parse(authText) as unknown;
  } catch {
    return unavailableSnapshot(now, "Codex auth file is not valid JSON.", "error");
  }

  const authRecord = asRecord(authJson);
  const credentials = loadCredentials(authRecord);
  if (!credentials) {
    return unavailableSnapshot(
      now,
      "Codex auth file is missing OAuth credentials. Re-run `codex login`.",
    );
  }

  let nextCredentials = credentials;
  try {
    if (shouldRefreshToken(credentials, now) && authRecord) {
      nextCredentials = await refreshCredentials(authPath, authRecord, credentials, now, {
        readFileText,
        writeFileText,
        fetchImpl,
      });
    }
  } catch {
    return unavailableSnapshot(
      now,
      "Unable to refresh Codex OAuth credentials. Re-run `codex login`.",
      "error",
    );
  }

  try {
    const headers = new Headers({
      Authorization: `Bearer ${nextCredentials.accessToken}`,
      Accept: "application/json",
      "User-Agent": "Octogent",
    });

    if (nextCredentials.accountId) {
      headers.set("ChatGPT-Account-Id", nextCredentials.accountId);
    }

    const usageResponse = await fetchImpl(OAUTH_USAGE_URL, {
      method: "GET",
      headers,
    });

    if (usageResponse.status === 401 || usageResponse.status === 403) {
      return unavailableSnapshot(now, "Codex OAuth session expired. Re-run `codex login`.");
    }

    if (!usageResponse.ok) {
      return unavailableSnapshot(
        now,
        `Codex usage request failed (${usageResponse.status}).`,
        "error",
      );
    }

    const usagePayload = (await usageResponse.json()) as CodexUsageApiResponse;
    return mapUsageResponse(usagePayload, now);
  } catch {
    return unavailableSnapshot(now, "Unable to reach Codex usage service.", "error");
  }
};
