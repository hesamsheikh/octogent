import {
  type ProjectRegistryEntry,
  type ProjectsRegistry,
  ensureProjectConfig,
  ensureProjectScaffold,
  loadProjectConfig,
  loadProjectsRegistry,
  migrateStateToGlobal,
  registerProject,
  resolveProjectStateDir,
} from "./projectPersistence";

/** The hub's view of the project registry; tests may substitute their own. */
export type HubProjectRegistry = {
  load(): ProjectsRegistry;
  /** Scaffolds the workspace if needed and records it; returns its entry. */
  register(workspaceCwd: string, name?: string): ProjectRegistryEntry;
  /** Readies a registered project's state dir, the way a single-project start does. */
  prepare(entry: ProjectRegistryEntry): { projectId: string; projectStateDir: string };
};

export const createFileProjectRegistry = (): HubProjectRegistry => ({
  load: loadProjectsRegistry,

  register(workspaceCwd, name) {
    // Deliberately no .gitignore edit (unlike `octogent init`): registering is
    // an API call, and touching a tracked file stays the setup flow's decision.
    const config = ensureProjectScaffold(workspaceCwd, name);
    return registerProject(workspaceCwd, config.displayName);
  },

  prepare(entry) {
    // A workspace whose .octogent/project.json went missing would otherwise be
    // re-initialized under a fresh id, orphaning all of its state; restore the
    // config under the id the registry already knows.
    ensureProjectConfig(entry.path, entry.name, entry.id);
    const projectStateDir = resolveProjectStateDir(entry.path, entry.name);
    migrateStateToGlobal(entry.path, projectStateDir);
    return {
      projectId: loadProjectConfig(entry.path)?.projectId ?? entry.id,
      projectStateDir,
    };
  },
});
