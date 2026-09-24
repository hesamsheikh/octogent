import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import type { HubMetadata } from "./hubMetadata";
import {
  type ProjectRegistryEntry,
  type ProjectsRegistry,
  loadProjectConfig,
} from "./projectPersistence";
import { resolveProjectKey } from "./projectSlug";
import type { RuntimeMetadata } from "./runtimeMetadata";

/** The nearest `.octogent/project.json` at or above a directory. */
export type CwdProject = { root: string; projectId: string };

export type ApiTargetInput = {
  env: Record<string, string | undefined>;
  cwd: string;
  /** `--project <slug|id>`; undefined when not given. */
  projectFlag?: string | undefined;
  registry: ProjectsRegistry;
  /** hub.json, passed only while its hub is alive. */
  hubMetadata: HubMetadata | null;
  /** The current project's own runtime.json, passed only while its server is alive. */
  runtimeMetadata: RuntimeMetadata | null;
  cwdProject?: CwdProject | null;
  /** Root of the git repository containing cwd. */
  gitRoot?: string | null;
};

export type ApiTarget =
  | { kind: "explicit"; apiBase: string }
  | { kind: "standalone"; apiBase: string }
  | { kind: "hub"; apiBase: string; hubBaseUrl: string; project: ProjectRegistryEntry }
  /** The hub runs but does not know this workspace yet. */
  | { kind: "register"; hubBaseUrl: string; path: string }
  /** No hub answers; start one, then resolve again. */
  | { kind: "start-hub" }
  | {
      kind: "error";
      reason: "unknown-project" | "not-a-project" | "autostart-disabled";
      detail?: string;
    };

const isAtOrBelow = (directory: string, root: string): boolean =>
  directory === root || directory.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

/**
 * The project the working directory belongs to. The nearest project root
 * wins: a project.json names its project by id (so a moved workspace still
 * resolves), and a registered path nested deeper than it is more specific.
 */
export const findCurrentProject = (
  registry: ProjectsRegistry,
  cwd: string,
  cwdProject: CwdProject | null | undefined,
): ProjectRegistryEntry | null => {
  const containing = registry.projects
    .filter((project) => isAtOrBelow(cwd, project.path))
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (cwdProject && !(containing && containing.path.length > cwdProject.root.length)) {
    return registry.projects.find((project) => project.id === cwdProject.projectId) ?? null;
  }
  return containing ?? null;
};

/** OCTOGENT_API_BASE (set per worker; project-scoped under the hub) before the server-wide origin. */
export const readExplicitApiBase = (env: Record<string, string | undefined>): string | null =>
  env.OCTOGENT_API_BASE?.trim() || env.OCTOGENT_API_ORIGIN?.trim() || null;

const toProjectApiBase = (hubBaseUrl: string, project: ProjectRegistryEntry) =>
  // By id, never the slug: a base that outlives a rename must keep working.
  `${hubBaseUrl}/api/p/${encodeURIComponent(project.id)}`;

/**
 * Where a CLI command should send its requests, in order: an explicit base
 * from the environment (a worker's CLI; already project-scoped), the current
 * project's own single-project server, the hub (scoped to the project from
 * `--project` or cwd), and finally "start the hub".
 */
export const resolveApiTarget = ({
  env,
  cwd,
  projectFlag,
  registry,
  hubMetadata,
  runtimeMetadata,
  cwdProject = null,
  gitRoot = null,
}: ApiTargetInput): ApiTarget => {
  const explicitBase = readExplicitApiBase(env);
  if (explicitBase) {
    return { kind: "explicit", apiBase: explicitBase };
  }

  let project: ProjectRegistryEntry | null;
  if (projectFlag !== undefined) {
    project = resolveProjectKey(registry, projectFlag.trim());
    if (!project) {
      return { kind: "error", reason: "unknown-project", detail: projectFlag };
    }
  } else {
    project = findCurrentProject(registry, cwd, cwdProject);
  }

  // runtime.json describes cwd's project, so --project only keeps it when it
  // names that same workspace.
  if (
    runtimeMetadata &&
    (projectFlag === undefined || project?.path === runtimeMetadata.workspaceCwd)
  ) {
    return { kind: "standalone", apiBase: runtimeMetadata.apiBaseUrl };
  }

  const registrablePath = project ? null : (cwdProject?.root ?? gitRoot);
  if (!project && !registrablePath) {
    // Checked before starting a hub: one could never serve this directory.
    return { kind: "error", reason: "not-a-project", detail: cwd };
  }

  if (!hubMetadata) {
    return env.OCTOGENT_NO_AUTOSTART === "1"
      ? { kind: "error", reason: "autostart-disabled" }
      : { kind: "start-hub" };
  }

  const hubBaseUrl = hubMetadata.apiBaseUrl.replace(/\/+$/, "");
  if (project) {
    return { kind: "hub", apiBase: toProjectApiBase(hubBaseUrl, project), hubBaseUrl, project };
  }
  return { kind: "register", hubBaseUrl, path: registrablePath as string };
};

/**
 * Removes the flags every command accepts, so per-command parsers (and free
 * text such as a channel message) never see them.
 */
export const extractGlobalFlags = (
  argv: string[],
): { args: string[]; projectFlag: string | undefined; standalone: boolean } => {
  const args: string[] = [];
  let projectFlag: string | undefined;
  let standalone = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--standalone") {
      standalone = true;
    } else if (arg === "--project") {
      projectFlag = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--project=")) {
      projectFlag = arg.slice("--project=".length);
    } else {
      args.push(arg);
    }
  }

  return { args, projectFlag, standalone };
};

const walkUp = <T>(start: string, probe: (directory: string) => T | null): T | null => {
  let current = start;
  while (true) {
    const found = probe(current);
    if (found !== null) {
      return found;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};

export const findProjectConfigRoot = (cwd: string): CwdProject | null =>
  walkUp(cwd, (directory) => {
    const config = loadProjectConfig(directory);
    return config ? { root: directory, projectId: config.projectId } : null;
  });

/** A `.git` file counts too: linked worktrees and submodules have one. */
export const findGitRoot = (cwd: string): string | null =>
  walkUp(cwd, (directory) => (existsSync(join(directory, ".git")) ? directory : null));
