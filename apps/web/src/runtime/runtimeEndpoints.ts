import { resolvePageMode } from "../app/hub/pageMode";

type LocationLike = Pick<Location, "host" | "protocol">;

/** A project page under a hub talks to that project's mount; any other page to the root API. */
export const resolveApiPrefix = (pathname: string): string => {
  const mode = resolvePageMode(pathname);
  return mode.kind === "project" ? `/api/p/${mode.projectKey}` : "";
};

// Read once: moving to another project is a full page load, and the app never
// rewrites the path itself, so a live page's project cannot change under it.
const apiPrefix = typeof window === "undefined" ? "" : resolveApiPrefix(window.location.pathname);

const readRuntimeBaseUrl = (): string | null => {
  const value = import.meta.env.VITE_OCTOGENT_API_ORIGIN;
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const withTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`);

const buildAbsoluteUrl = (baseUrl: string, pathname: string) => {
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return new URL(normalizedPath, withTrailingSlash(baseUrl)).toString();
};

const localRuntimeWebSocketUrl = (location: LocationLike, pathname: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${pathname}`;
};

const toWebSocketBase = (runtimeBaseUrl: string): string | null => {
  try {
    const url = new URL(runtimeBaseUrl);
    if (url.protocol === "https:") {
      url.protocol = "wss:";
      return url.toString();
    }
    if (url.protocol === "http:") {
      url.protocol = "ws:";
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
};

const buildRuntimeUrl = (path: string, runtimeBaseUrl: string | null) => {
  const prefixedPath = `${apiPrefix}${path}`;
  return runtimeBaseUrl ? buildAbsoluteUrl(runtimeBaseUrl, prefixedPath) : prefixedPath;
};

const buildRuntimeSocketUrl = (
  path: string,
  runtimeBaseUrl: string | null,
  location: LocationLike,
) => {
  const prefixedPath = `${apiPrefix}${path}`;
  const webSocketBase = runtimeBaseUrl ? toWebSocketBase(runtimeBaseUrl) : null;
  return webSocketBase
    ? buildAbsoluteUrl(webSocketBase, prefixedPath)
    : localRuntimeWebSocketUrl(location, prefixedPath);
};

// The hub's own route: it lists every project, so it never sits behind one project's mount.
export const buildHubProjectsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  runtimeBaseUrl ? buildAbsoluteUrl(runtimeBaseUrl, "/api/projects") : "/api/projects";

export const buildTerminalSnapshotsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/terminal-snapshots", runtimeBaseUrl);

export const buildTerminalEventsSocketUrl = (
  runtimeBaseUrl = readRuntimeBaseUrl(),
  location: LocationLike = window.location,
) => buildRuntimeSocketUrl("/api/terminal-events/ws", runtimeBaseUrl, location);

export const buildTerminalsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/terminals", runtimeBaseUrl);

export const buildTerminalUrl = (terminalId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl(`/api/terminals/${encodeURIComponent(terminalId)}`, runtimeBaseUrl);

export const buildCodexUsageUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/codex/usage", runtimeBaseUrl);

export const buildClaudeUsageUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/claude/usage", runtimeBaseUrl);

export const buildGithubSummaryUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/github/summary", runtimeBaseUrl);

export const buildUiStateUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/ui-state", runtimeBaseUrl);

export const buildWorkspaceSetupUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/setup", runtimeBaseUrl);

export const buildWorkspaceSetupStepUrl = (stepId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl(`/api/setup/steps/${encodeURIComponent(stepId)}`, runtimeBaseUrl);

export const buildMonitorConfigUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/monitor/config", runtimeBaseUrl);

export const buildMonitorFeedUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/monitor/feed", runtimeBaseUrl);

export const buildMonitorRefreshUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/monitor/refresh", runtimeBaseUrl);

export const buildUsageHeatmapUrl = (
  scope: "all" | "project" = "all",
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildRuntimeUrl(`/api/analytics/usage-heatmap?scope=${scope}`, runtimeBaseUrl);

export const buildCodeIntelEventsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/code-intel/events", runtimeBaseUrl);

export const buildConversationsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/conversations", runtimeBaseUrl);

export const buildConversationSearchUrl = (query: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl(`/api/conversations/search?q=${encodeURIComponent(query)}`, runtimeBaseUrl);

export const buildConversationSessionUrl = (
  sessionId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildRuntimeUrl(`/api/conversations/${encodeURIComponent(sessionId)}`, runtimeBaseUrl);

export const buildConversationExportUrl = (
  sessionId: string,
  format: "json" | "md",
  runtimeBaseUrl = readRuntimeBaseUrl(),
) =>
  buildRuntimeUrl(
    `/api/conversations/${encodeURIComponent(sessionId)}/export?format=${format}`,
    runtimeBaseUrl,
  );

export const buildTentacleRenameUrl = (tentacleId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl(`/api/tentacles/${encodeURIComponent(tentacleId)}`, runtimeBaseUrl);

const buildTentacleGitUrl = (
  tentacleId: string,
  action: "status" | "commit" | "push" | "sync" | "pr" | "pr/merge",
  runtimeBaseUrl: string | null,
) =>
  buildRuntimeUrl(`/api/tentacles/${encodeURIComponent(tentacleId)}/git/${action}`, runtimeBaseUrl);

export const buildTentacleGitStatusUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitUrl(tentacleId, "status", runtimeBaseUrl);

export const buildTentacleGitCommitUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitUrl(tentacleId, "commit", runtimeBaseUrl);

export const buildTentacleGitPushUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitUrl(tentacleId, "push", runtimeBaseUrl);

export const buildTentacleGitSyncUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitUrl(tentacleId, "sync", runtimeBaseUrl);

export const buildTentacleGitPullRequestUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitUrl(tentacleId, "pr", runtimeBaseUrl);

export const buildTentacleGitPullRequestMergeUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildTentacleGitUrl(tentacleId, "pr/merge", runtimeBaseUrl);

export const buildDeckTentaclesUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/deck/tentacles", runtimeBaseUrl);

export const buildDeckSkillsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/deck/skills", runtimeBaseUrl);

const buildDeckTentaclePathUrl = (
  tentacleId: string,
  subPath: string,
  runtimeBaseUrl: string | null,
) =>
  buildRuntimeUrl(
    `/api/deck/tentacles/${encodeURIComponent(tentacleId)}${subPath}`,
    runtimeBaseUrl,
  );

export const buildDeckTentacleUrl = (tentacleId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildDeckTentaclePathUrl(tentacleId, "", runtimeBaseUrl);

export const buildDeckTentacleSkillsUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildDeckTentaclePathUrl(tentacleId, "/skills", runtimeBaseUrl);

export const buildDeckTentacleSwarmUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildDeckTentaclePathUrl(tentacleId, "/swarm", runtimeBaseUrl);

export const buildDeckVaultFileUrl = (
  tentacleId: string,
  fileName: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => buildDeckTentaclePathUrl(tentacleId, `/files/${encodeURIComponent(fileName)}`, runtimeBaseUrl);

export const buildDeckTodoToggleUrl = (tentacleId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildDeckTentaclePathUrl(tentacleId, "/todo/toggle", runtimeBaseUrl);

export const buildDeckTodoEditUrl = (tentacleId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildDeckTentaclePathUrl(tentacleId, "/todo/edit", runtimeBaseUrl);

export const buildDeckTodoAddUrl = (tentacleId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildDeckTentaclePathUrl(tentacleId, "/todo", runtimeBaseUrl);

export const buildDeckTodoDeleteUrl = (tentacleId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildDeckTentaclePathUrl(tentacleId, "/todo/delete", runtimeBaseUrl);

export const buildDeckTodoSolveUrl = (tentacleId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildDeckTentaclePathUrl(tentacleId, "/todo/solve", runtimeBaseUrl);

export const buildPromptsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl("/api/prompts", runtimeBaseUrl);

export const buildPromptItemUrl = (name: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildRuntimeUrl(`/api/prompts/${encodeURIComponent(name)}`, runtimeBaseUrl);

export const buildTerminalSocketUrl = (
  tentacleId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
  location: LocationLike = window.location,
) =>
  buildRuntimeSocketUrl(
    `/api/terminals/${encodeURIComponent(tentacleId)}/ws`,
    runtimeBaseUrl,
    location,
  );
