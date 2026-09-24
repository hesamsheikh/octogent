import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { assignUniqueSlug, toProjectSlug } from "./projectSlug";

// OCTOGENT_HOME relocates the global state root. Tests point it at a temp
// directory so a run cannot register throwaway projects into the operator's
// real ~/.octogent registry; operators can use it to keep isolated roots.
export const resolveGlobalOctogentDir = (): string =>
  process.env.OCTOGENT_HOME?.trim() || join(homedir(), ".octogent");

export const GLOBAL_OCTOGENT_DIR = resolveGlobalOctogentDir();
export const PROJECTS_FILE = join(GLOBAL_OCTOGENT_DIR, "projects.json");
export const PROJECT_CONFIG_RELATIVE_PATH = join(".octogent", "project.json");

type ProjectConfigDocument = {
  version: 1;
  projectId: string;
  displayName: string;
  createdAt: string;
};

export type ProjectRegistryEntry = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt?: string;
  /** URL key for the hub (`/p/<slug>/`); backfilled on load for older registries. */
  slug?: string;
  /** Slugs this project answered to before a rename, so old links keep resolving. */
  aliases?: string[];
};

type LegacyProjectRegistryEntry = {
  name?: unknown;
  path?: unknown;
  createdAt?: unknown;
};

export type ProjectsRegistry = { projects: ProjectRegistryEntry[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isWellFormedSlug = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && toProjectSlug(value) === value;

const readSlugFields = (
  value: Record<string, unknown>,
): Pick<ProjectRegistryEntry, "slug" | "aliases"> => {
  const aliases = Array.isArray(value.aliases) ? value.aliases.filter(isWellFormedSlug) : [];
  return {
    ...(isWellFormedSlug(value.slug) ? { slug: value.slug } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
  };
};

const toProjectRegistryEntry = (
  value: unknown,
  workspaceCwd?: string,
): ProjectRegistryEntry | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.path === "string" &&
    value.path.trim().length > 0 &&
    typeof value.createdAt === "string" &&
    value.createdAt.trim().length > 0
  ) {
    return {
      id: value.id,
      name: value.name,
      path: value.path,
      createdAt: value.createdAt,
      ...(typeof value.lastOpenedAt === "string" && value.lastOpenedAt.trim().length > 0
        ? { lastOpenedAt: value.lastOpenedAt }
        : {}),
      ...readSlugFields(value),
    };
  }

  if (
    workspaceCwd &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.path === "string" &&
    value.path === workspaceCwd
  ) {
    return {
      id: `legacy-${randomUUID()}`,
      name: value.name,
      path: value.path,
      createdAt:
        typeof value.createdAt === "string" && value.createdAt.trim().length > 0
          ? value.createdAt
          : new Date().toISOString(),
    };
  }

  return null;
};

const toProjectConfigDocument = (value: unknown): ProjectConfigDocument | null => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.projectId !== "string" ||
    value.projectId.trim().length === 0 ||
    typeof value.displayName !== "string" ||
    value.displayName.trim().length === 0 ||
    typeof value.createdAt !== "string" ||
    value.createdAt.trim().length === 0
  ) {
    return null;
  }

  return {
    version: 1,
    projectId: value.projectId,
    displayName: value.displayName,
    createdAt: value.createdAt,
  };
};

const readJsonFile = (filePath: string): unknown | null => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
};

export const ensureGlobalOctogentDir = () => {
  if (!existsSync(GLOBAL_OCTOGENT_DIR)) {
    mkdirSync(GLOBAL_OCTOGENT_DIR, { recursive: true });
  }
};

export const loadProjectsRegistry = (): ProjectsRegistry => {
  ensureGlobalOctogentDir();

  if (!existsSync(PROJECTS_FILE)) {
    return { projects: [] };
  }

  const parsed = readJsonFile(PROJECTS_FILE);
  if (!isRecord(parsed) || !Array.isArray(parsed.projects)) {
    return { projects: [] };
  }

  const registry = {
    projects: parsed.projects
      .map((entry) => toProjectRegistryEntry(entry))
      .filter((entry): entry is ProjectRegistryEntry => entry !== null),
  };
  if (backfillProjectSlugs(registry)) {
    try {
      saveProjectsRegistry(registry);
    } catch {
      // A read-only registry still resolves: the slugs just are not persisted.
    }
  }
  return registry;
};

/**
 * Gives every entry a unique slug. Existing slugs are kept (first one wins on
 * a duplicate) so URLs stay stable; only missing or clashing ones are
 * assigned, after all kept slugs are known. Returns whether anything changed.
 */
const backfillProjectSlugs = (registry: ProjectsRegistry): boolean => {
  const kept = new Set<string>();
  const needsSlug: ProjectRegistryEntry[] = [];
  for (const project of registry.projects) {
    if (project.slug && !kept.has(project.slug)) {
      kept.add(project.slug);
      continue;
    }
    needsSlug.push(project);
  }

  // Excluding the entry's own id means a clashing slug it still carries does
  // not count against it.
  for (const project of needsSlug) {
    project.slug = assignUniqueSlug(registry, project.name, project.id);
  }
  return needsSlug.length > 0;
};

export const saveProjectsRegistry = (registry: ProjectsRegistry) => {
  ensureGlobalOctogentDir();
  // Written aside and renamed into place: a hub, CLI calls, and other servers
  // all read this file, and one that catches it half-written sees an empty
  // registry and would save that back over everyone's projects.
  const temporaryPath = `${PROJECTS_FILE}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, PROJECTS_FILE);
};

export const resolveProjectConfigPath = (workspaceCwd: string) =>
  join(workspaceCwd, PROJECT_CONFIG_RELATIVE_PATH);

export const deriveProjectIdFromWorkspace = (workspaceCwd: string) =>
  `workspace-${createHash("sha1").update(workspaceCwd).digest("hex").slice(0, 16)}`;

const inferLegacyProjectName = (workspaceCwd: string): string | null => {
  const parsed = readJsonFile(PROJECTS_FILE);
  if (!isRecord(parsed) || !Array.isArray(parsed.projects)) {
    return null;
  }

  for (const legacyEntry of parsed.projects as LegacyProjectRegistryEntry[]) {
    if (legacyEntry.path === workspaceCwd && typeof legacyEntry.name === "string") {
      return legacyEntry.name;
    }
  }

  return null;
};

export const loadProjectConfig = (workspaceCwd: string): ProjectConfigDocument | null => {
  const configPath = resolveProjectConfigPath(workspaceCwd);
  if (!existsSync(configPath)) {
    return null;
  }

  return toProjectConfigDocument(readJsonFile(configPath));
};

export const ensureProjectConfig = (
  workspaceCwd: string,
  preferredName?: string,
  preferredProjectId?: string,
): ProjectConfigDocument => {
  const existing = loadProjectConfig(workspaceCwd);
  if (existing) {
    return existing;
  }

  const displayName =
    preferredName?.trim() ||
    inferLegacyProjectName(workspaceCwd) ||
    basename(workspaceCwd) ||
    "octogent-project";
  const config: ProjectConfigDocument = {
    version: 1,
    projectId: preferredProjectId?.trim() || randomUUID(),
    displayName,
    createdAt: new Date().toISOString(),
  };

  const configPath = resolveProjectConfigPath(workspaceCwd);
  mkdirSync(join(workspaceCwd, ".octogent"), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
};

export const registerProject = (
  workspaceCwd: string,
  preferredName?: string,
): ProjectRegistryEntry => {
  const projectConfig = ensureProjectConfig(workspaceCwd, preferredName);
  const registry = loadProjectsRegistry();
  const lastOpenedAt = new Date().toISOString();
  const existing = registry.projects.find((entry) => entry.id === projectConfig.projectId);

  if (existing) {
    if (existing.name !== projectConfig.displayName || !existing.slug) {
      const nextSlug = assignUniqueSlug(registry, projectConfig.displayName, existing.id);
      const aliases = (existing.aliases ?? []).filter((alias) => alias !== nextSlug);
      if (existing.slug && existing.slug !== nextSlug && !aliases.includes(existing.slug)) {
        aliases.push(existing.slug);
      }
      existing.slug = nextSlug;
      if (aliases.length > 0 || existing.aliases) {
        existing.aliases = aliases;
      }
    }
    existing.name = projectConfig.displayName;
    existing.path = workspaceCwd;
    existing.lastOpenedAt = lastOpenedAt;
    saveProjectsRegistry(registry);
    return existing;
  }

  const filteredProjects = registry.projects.filter(
    (entry) => entry.path !== workspaceCwd && entry.id !== projectConfig.projectId,
  );
  const nextEntry: ProjectRegistryEntry = {
    id: projectConfig.projectId,
    name: projectConfig.displayName,
    path: workspaceCwd,
    createdAt: projectConfig.createdAt,
    lastOpenedAt,
    slug: assignUniqueSlug({ projects: filteredProjects }, projectConfig.displayName),
  };
  filteredProjects.push(nextEntry);
  saveProjectsRegistry({ projects: filteredProjects });
  return nextEntry;
};

export const resolveGlobalProjectDir = (projectId: string) =>
  join(GLOBAL_OCTOGENT_DIR, "projects", projectId);

/** Hub-wide state (its server log) that belongs to no single project. */
export const resolveHubStateDir = () => join(GLOBAL_OCTOGENT_DIR, "hub");

export const resolveEphemeralProjectStateDir = (workspaceCwd: string) =>
  resolveGlobalProjectDir(deriveProjectIdFromWorkspace(workspaceCwd));

export const resolveProjectStateDir = (workspaceCwd: string, preferredName?: string): string => {
  const entry = registerProject(workspaceCwd, preferredName);
  const projectDir = resolveGlobalProjectDir(entry.id);
  mkdirSync(join(projectDir, "state"), { recursive: true });
  return projectDir;
};

export const ensureProjectScaffold = (
  workspaceCwd: string,
  preferredName?: string,
  preferredProjectId?: string,
) => {
  const octogentDir = join(workspaceCwd, ".octogent");
  for (const subdirectory of ["tentacles", "worktrees"]) {
    mkdirSync(join(octogentDir, subdirectory), { recursive: true });
  }

  return ensureProjectConfig(workspaceCwd, preferredName, preferredProjectId);
};

export const hasOctogentGitignoreEntry = (workspaceCwd: string) => {
  const gitignorePath = join(workspaceCwd, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return false;
  }

  const content = readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .includes(".octogent");
};

export const ensureOctogentGitignoreEntry = (workspaceCwd: string) => {
  const gitignorePath = join(workspaceCwd, ".gitignore");
  const entry = ".octogent";

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (
      content
        .split("\n")
        .map((line) => line.trim())
        .includes(entry)
    ) {
      return { changed: false };
    }

    appendFileSync(gitignorePath, `\n${entry}\n`, "utf-8");
    return { changed: true };
  }

  writeFileSync(gitignorePath, `${entry}\n`, "utf-8");
  return { changed: true };
};

export const migrateStateToGlobal = (workspaceCwd: string, projectStateDir: string) => {
  const fallbackProjectDir = join(workspaceCwd, ".octogent");
  if (projectStateDir === fallbackProjectDir) {
    return;
  }

  const currentConfig = loadProjectConfig(workspaceCwd);
  const legacyProjectName = inferLegacyProjectName(workspaceCwd);
  const legacyGlobalProjectDir =
    legacyProjectName && currentConfig
      ? join(GLOBAL_OCTOGENT_DIR, "projects", legacyProjectName)
      : null;
  const oldStateDir = join(fallbackProjectDir, "state");
  const newStateDir = join(projectStateDir, "state");

  // A dashboard started before `octogent init` parks its state in the
  // path-derived ephemeral root; without it as a source, everything created in
  // that first session (terminals and their worktrees) is orphaned on init.
  const ephemeralStateDir = join(resolveEphemeralProjectStateDir(workspaceCwd), "state");

  const sourceStateDirs = [
    oldStateDir,
    legacyGlobalProjectDir ? join(legacyGlobalProjectDir, "state") : null,
    ephemeralStateDir,
  ].filter((dir): dir is string => dir !== null && dir !== newStateDir && existsSync(dir));

  mkdirSync(newStateDir, { recursive: true });

  const stateFiles = [
    "tentacles.json",
    "deck.json",
    "monitor-config.json",
    "monitor-cache.json",
    "code-intel-events.jsonl",
    "claude-usage-snapshot.json",
    "runtime.json",
  ];

  // First source wins, so the list above doubles as the precedence order.
  const findSource = (relativePath: string) =>
    sourceStateDirs.map((dir) => join(dir, relativePath)).find((path) => existsSync(path));

  let migrated = 0;
  for (const file of stateFiles) {
    const destination = join(newStateDir, file);
    if (existsSync(destination)) {
      continue;
    }

    const source = findSource(file);
    if (source) {
      copyFileSync(source, destination);
      migrated += 1;
    }
  }

  const transcriptDestination = join(newStateDir, "transcripts");
  if (!existsSync(transcriptDestination)) {
    const transcriptSource = findSource("transcripts");
    if (transcriptSource) {
      cpSync(transcriptSource, transcriptDestination, { recursive: true });
      migrated += 1;
    }
  }

  if (migrated > 0) {
    console.log(`  Migrated state to ${projectStateDir}`);
  }
};
