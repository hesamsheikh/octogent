import { t } from "@octogent/core";

import {
  type ApiTarget,
  type CwdProject,
  findGitRoot,
  findProjectConfigRoot,
  readExplicitApiBase,
  resolveApiTarget,
} from "./cliApiTarget";
import { type HubCliContext, HubCliError, ensureHubRunning } from "./cliHub";
import { type HubMetadata, isProcessAlive, readLiveHubMetadata } from "./hubMetadata";
import { createDriftWarner } from "./hubVersionDrift";
import {
  loadProjectsRegistry,
  resolveEphemeralProjectStateDir,
  resolveGlobalProjectDir,
} from "./projectPersistence";
import { type RuntimeMetadata, readRuntimeMetadata } from "./runtimeMetadata";

const HEALTH_TIMEOUT_MS = 1500;

const answersHealth = async (apiBaseUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${apiBaseUrl}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * The current workspace's own single-project server, when it is alive. The
 * health probe matters: runtime.json outlives crashes and reboots, and a
 * stale one would otherwise hide the hub behind a dead address.
 */
export const readLiveRuntimeMetadata = async (
  cwd: string,
  cwdProject: CwdProject | null,
  gitRoot: string | null,
): Promise<RuntimeMetadata | null> => {
  // An uninitialized workspace's server keeps its state under a path-derived id.
  const stateDirs = cwdProject
    ? [resolveGlobalProjectDir(cwdProject.projectId)]
    : [...new Set([cwd, gitRoot].filter((path): path is string => path !== null))].map(
        resolveEphemeralProjectStateDir,
      );
  for (const stateDir of stateDirs) {
    const runtime = readRuntimeMetadata(stateDir);
    if (runtime && isProcessAlive(runtime.pid) && (await answersHealth(runtime.apiBaseUrl))) {
      return runtime;
    }
  }
  return null;
};

export type RegisteredProject = { id: string; slug: string; created: boolean };

/** POST /api/projects on the hub; a worded error when it refuses. */
export const registerWithHub = async (
  hubBaseUrl: string,
  path: string,
  context: HubCliContext,
): Promise<RegisteredProject> => {
  let response: Response;
  try {
    response = await fetch(`${hubBaseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch (error) {
    throw new HubCliError(
      t(context.locale, "cli.hub.registerFailed", {
        path,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof payload.id !== "string") {
    throw new HubCliError(
      t(context.locale, "cli.hub.registerFailed", {
        path,
        reason: typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`,
      }),
    );
  }
  return {
    id: payload.id,
    slug: typeof payload.slug === "string" ? payload.slug : payload.id,
    created: response.status === 201,
  };
};

const describeTargetError = (
  target: Extract<ApiTarget, { kind: "error" }>,
  context: HubCliContext,
): string => {
  switch (target.reason) {
    case "unknown-project":
      return t(context.locale, "cli.hub.unknownProject", { key: target.detail ?? "" });
    case "not-a-project":
      return t(context.locale, "cli.hub.notAProject", { path: target.detail ?? "" });
    case "autostart-disabled":
      return t(context.locale, "cli.hub.autostartDisabled");
  }
};

/**
 * Resolves the API base a command talks to, doing what the pure resolution
 * asks for along the way: starting the hub, registering the workspace, and
 * warning (once) when the hub runs another build than this CLI.
 */
export const createCliApiBaseResolver = (
  context: HubCliContext,
  projectFlag: string | undefined,
) => {
  const env = context.env ?? process.env;
  const warnDrift = createDriftWarner(context.build, context.locale, (line) => console.error(line));
  let lastApiBase: string | null = null;

  const resolveUncached = async (): Promise<string> => {
    if (projectFlag !== undefined && projectFlag.trim() === "") {
      throw new HubCliError(t(context.locale, "cli.hub.projectFlagEmpty"));
    }
    // A worker's CLI: skip every lookup below, it runs on each agent command.
    const explicitBase = readExplicitApiBase(env);
    if (explicitBase) {
      return explicitBase;
    }

    const cwd = process.cwd();
    const cwdProject = findProjectConfigRoot(cwd);
    const gitRoot = findGitRoot(cwd);
    const runtimeMetadata = await readLiveRuntimeMetadata(cwd, cwdProject, gitRoot);
    let hubMetadata: HubMetadata | null = await readLiveHubMetadata();

    // Twice at most: once to learn a hub is needed, once more after starting it.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const target = resolveApiTarget({
        env,
        cwd,
        projectFlag,
        registry: loadProjectsRegistry(),
        hubMetadata,
        runtimeMetadata,
        cwdProject,
        gitRoot,
      });
      switch (target.kind) {
        case "explicit":
        case "standalone":
          return target.apiBase;
        case "hub":
          if (hubMetadata) {
            warnDrift(hubMetadata);
          }
          return target.apiBase;
        case "register": {
          const project = await registerWithHub(target.hubBaseUrl, target.path, context);
          if (project.created) {
            console.error(
              t(context.locale, "cli.hub.registered", { path: target.path, slug: project.slug }),
            );
          }
          if (hubMetadata) {
            warnDrift(hubMetadata);
          }
          return `${target.hubBaseUrl}/api/p/${encodeURIComponent(project.id)}`;
        }
        case "start-hub":
          hubMetadata = await ensureHubRunning(context, { announce: true });
          break;
        case "error":
          throw new HubCliError(describeTargetError(target, context));
      }
    }
    throw new Error("Hub resolution still asked for a hub after starting one.");
  };

  return {
    async resolveApiBase(): Promise<string> {
      lastApiBase ??= await resolveUncached();
      return lastApiBase;
    },
    /** For error messages; null until a base was resolved. */
    lastApiBase: () => lastApiBase,
  };
};
