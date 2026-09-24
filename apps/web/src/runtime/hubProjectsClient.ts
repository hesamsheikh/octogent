import { type HubProject, normalizeHubProject, normalizeHubProjects } from "../app/hub/hubProjects";
import { buildHubProjectsUrl } from "./runtimeEndpoints";

type HubProjectsResult =
  | { kind: "hub"; projects: HubProject[] }
  /** The server has no hub routes: a single-project server answers 404 here. */
  | { kind: "not-hub" }
  | { kind: "error"; message: string };

type RegisterHubProjectResult =
  | { kind: "registered"; project: HubProject; isNew: boolean }
  /** 401/403: this browser may use the hub but not register directories with it. */
  | { kind: "denied" }
  | { kind: "rejected"; message: string };

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // Not JSON; the status is all there is to report.
  }
  return `HTTP ${response.status}`;
};

const describeFailure = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const fetchHubProjects = async (signal?: AbortSignal): Promise<HubProjectsResult> => {
  try {
    const response = await fetch(buildHubProjectsUrl(), {
      headers: { Accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404) {
      return { kind: "not-hub" };
    }
    if (!response.ok) {
      return { kind: "error", message: await readErrorMessage(response) };
    }
    const projects = normalizeHubProjects(await response.json());
    return projects ? { kind: "hub", projects } : { kind: "not-hub" };
  } catch (error) {
    return { kind: "error", message: describeFailure(error) };
  }
};

const postProjectRegistration = (body: Record<string, unknown>, signal?: AbortSignal) =>
  fetch(buildHubProjectsUrl(), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

const isDenied = (response: Response) => response.status === 401 || response.status === 403;

export const registerHubProject = async (path: string): Promise<RegisterHubProjectResult> => {
  try {
    const response = await postProjectRegistration({ path });
    if (isDenied(response)) {
      return { kind: "denied" };
    }
    if (!response.ok) {
      return { kind: "rejected", message: await readErrorMessage(response) };
    }
    const project = normalizeHubProject(await response.json());
    return project
      ? { kind: "registered", project, isNew: response.status === 201 }
      : { kind: "rejected", message: `HTTP ${response.status}` };
  } catch (error) {
    return { kind: "rejected", message: describeFailure(error) };
  }
};

/**
 * Whether this browser may register projects. The hub checks access before it
 * reads the body, so a registration without a path is a side-effect-free probe:
 * 400 means allowed, 401/403 means not. Anything inconclusive counts as allowed,
 * since a real attempt still reports a denial.
 */
export const canRegisterHubProjects = async (signal?: AbortSignal): Promise<boolean> => {
  try {
    return !isDenied(await postProjectRegistration({}, signal));
  } catch {
    return true;
  }
};
