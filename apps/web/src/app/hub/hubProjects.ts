import { decodeProjectKey } from "./pageMode";

export type HubProjectSummary = {
  ptySessions: number;
  runningTerminals: number;
  awaitingReviewTerminals: number;
  lastActivityAt: string | null;
};

export type HubProject = {
  id: string;
  name: string;
  slug: string;
  path: string;
  loaded: boolean;
  /** Only a loaded project has live counts; the hub does not load one just to list it. */
  summary: HubProjectSummary | null;
};

export const HUB_PROJECTS_REFRESH_MS = 15_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

const readText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const normalizeSummary = (value: unknown): HubProjectSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    ptySessions: readCount(value.ptySessions),
    runningTerminals: readCount(value.runningTerminals),
    awaitingReviewTerminals: readCount(value.awaitingReviewTerminals),
    lastActivityAt: readText(value.lastActivityAt),
  };
};

export const normalizeHubProject = (value: unknown): HubProject | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id);
  const slug = readText(value.slug);
  if (!id || !slug) {
    return null;
  }
  const loaded = value.loaded === true;
  return {
    id,
    name: readText(value.name) ?? slug,
    slug,
    path: readText(value.path) ?? "",
    loaded,
    summary: loaded ? normalizeSummary(value.summary) : null,
  };
};

/** `null` when the payload is not a hub project listing at all. */
export const normalizeHubProjects = (payload: unknown): HubProject[] | null => {
  if (!isRecord(payload) || !Array.isArray(payload.projects)) {
    return null;
  }
  return payload.projects
    .map(normalizeHubProject)
    .filter((project): project is HubProject => project !== null);
};

export const buildProjectPageHref = (slug: string): string => `/p/${encodeURIComponent(slug)}/`;

/** The page key is whatever the address bar holds: a slug or, from hooks and links, an id. */
export const findProjectByKey = (
  projects: readonly HubProject[],
  projectKey: string,
): HubProject | null => {
  const key = decodeProjectKey(projectKey);
  return projects.find((project) => project.slug === key || project.id === key) ?? null;
};
