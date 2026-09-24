import type { ProjectRegistryEntry, ProjectsRegistry } from "./projectPersistence";

const FALLBACK_SLUG = "project";

export const toProjectSlug = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : FALLBACK_SLUG;
};

/**
 * Picks a slug no other project answers to. Aliases count as taken so a URL
 * someone bookmarked before a rename never silently opens a different project.
 */
export const assignUniqueSlug = (
  registry: ProjectsRegistry,
  name: string,
  excludeProjectId?: string,
): string => {
  const taken = new Set<string>();
  for (const project of registry.projects) {
    if (project.id === excludeProjectId) {
      continue;
    }
    if (project.slug) {
      taken.add(project.slug);
    }
    for (const alias of project.aliases ?? []) {
      taken.add(alias);
    }
  }

  const base = toProjectSlug(name);
  if (!taken.has(base)) {
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
};

/**
 * Resolves a URL key to a project. Ids win over slugs and slugs over aliases:
 * ids never change, so a link built from one must keep pointing where it did.
 */
export const resolveProjectKey = (
  registry: ProjectsRegistry,
  key: string,
): ProjectRegistryEntry | null => {
  if (key.length === 0) {
    return null;
  }

  const byId = registry.projects.find((project) => project.id === key);
  if (byId) {
    return byId;
  }

  const normalizedKey = key.toLowerCase();
  return (
    registry.projects.find((project) => project.slug === normalizedKey) ??
    registry.projects.find((project) => project.aliases?.includes(normalizedKey)) ??
    null
  );
};
