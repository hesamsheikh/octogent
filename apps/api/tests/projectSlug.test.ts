import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECTS_FILE,
  type ProjectRegistryEntry,
  loadProjectsRegistry,
  registerProject,
  saveProjectsRegistry,
} from "../src/projectPersistence";
import { assignUniqueSlug, resolveProjectKey, toProjectSlug } from "../src/projectSlug";

const entry = (
  overrides: Partial<ProjectRegistryEntry> & { id: string },
): ProjectRegistryEntry => ({
  name: overrides.id,
  path: `/work/${overrides.id}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

describe("toProjectSlug", () => {
  it("lowercases and collapses every run of other characters into one dash", () => {
    expect(toProjectSlug("My Project")).toBe("my-project");
    expect(toProjectSlug("Octogent__Hub  (v2)")).toBe("octogent-hub-v2");
    expect(toProjectSlug("API.server")).toBe("api-server");
  });

  it("trims leading and trailing dashes", () => {
    expect(toProjectSlug("  --Hello World!--  ")).toBe("hello-world");
  });

  it("falls back to 'project' when nothing slug-worthy is left", () => {
    expect(toProjectSlug("")).toBe("project");
    expect(toProjectSlug("中文项目")).toBe("project");
    expect(toProjectSlug("!!!")).toBe("project");
  });
});

describe("assignUniqueSlug", () => {
  it("returns the plain slug when nothing else uses it", () => {
    expect(assignUniqueSlug({ projects: [] }, "Web App")).toBe("web-app");
  });

  it("appends -2, -3, … on collision with slugs and aliases", () => {
    const registry = {
      projects: [
        entry({ id: "a", slug: "web-app" }),
        entry({ id: "b", slug: "other", aliases: ["web-app-2"] }),
      ],
    };
    expect(assignUniqueSlug(registry, "Web App")).toBe("web-app-3");
  });

  it("ignores the entry being renamed so it can keep its own slug", () => {
    const registry = { projects: [entry({ id: "a", slug: "web-app" })] };
    expect(assignUniqueSlug(registry, "Web App", "a")).toBe("web-app");
  });
});

describe("resolveProjectKey", () => {
  const registry = {
    projects: [
      entry({ id: "0f1e-uuid", slug: "alpha", aliases: ["old-alpha"] }),
      entry({ id: "beta-id", slug: "beta" }),
    ],
  };

  it("accepts an id, a slug, or an alias", () => {
    expect(resolveProjectKey(registry, "0f1e-uuid")?.id).toBe("0f1e-uuid");
    expect(resolveProjectKey(registry, "alpha")?.id).toBe("0f1e-uuid");
    expect(resolveProjectKey(registry, "old-alpha")?.id).toBe("0f1e-uuid");
    expect(resolveProjectKey(registry, "BETA")?.id).toBe("beta-id");
  });

  it("returns null for an unknown key", () => {
    expect(resolveProjectKey(registry, "gamma")).toBeNull();
    expect(resolveProjectKey(registry, "")).toBeNull();
  });

  it("prefers an exact id over another project's slug", () => {
    const shadowed = {
      projects: [entry({ id: "p1", slug: "beta-id" }), entry({ id: "beta-id", slug: "beta" })],
    };
    expect(resolveProjectKey(shadowed, "beta-id")?.id).toBe("beta-id");
  });
});

describe("registry slugs", () => {
  const workspaces: string[] = [];

  beforeEach(() => {
    saveProjectsRegistry({ projects: [] });
  });

  afterEach(() => {
    for (const directory of workspaces) {
      rmSync(directory, { recursive: true, force: true });
    }
    workspaces.length = 0;
  });

  const makeWorkspace = () => {
    const directory = mkdtempSync(join(tmpdir(), "octogent-slug-test-"));
    workspaces.push(directory);
    return directory;
  };

  it("backfills missing slugs on load and persists them", () => {
    // What a registry written by an older Octogent looks like.
    writeFileSync(
      PROJECTS_FILE,
      JSON.stringify({
        projects: [
          { id: "one", name: "Web App", path: "/w/one", createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "two", name: "web app", path: "/w/two", createdAt: "2026-01-02T00:00:00.000Z" },
        ],
      }),
    );

    const registry = loadProjectsRegistry();
    expect(registry.projects.map((project) => project.slug)).toEqual(["web-app", "web-app-2"]);

    const persisted = JSON.parse(readFileSync(PROJECTS_FILE, "utf8")) as {
      projects: ProjectRegistryEntry[];
    };
    expect(persisted.projects.map((project) => project.slug)).toEqual(["web-app", "web-app-2"]);
  });

  it("reassigns a slug that duplicates an earlier entry's", () => {
    writeFileSync(
      PROJECTS_FILE,
      JSON.stringify({
        projects: [
          { id: "one", name: "A", path: "/w/one", createdAt: "x", slug: "same" },
          { id: "two", name: "B", path: "/w/two", createdAt: "x", slug: "same" },
        ],
      }),
    );

    expect(loadProjectsRegistry().projects.map((project) => project.slug)).toEqual(["same", "b"]);
  });

  it("keeps slug and aliases across a load/save round trip", () => {
    saveProjectsRegistry({
      projects: [entry({ id: "one", slug: "alpha", aliases: ["first"] })],
    });

    expect(loadProjectsRegistry().projects[0]).toMatchObject({
      slug: "alpha",
      aliases: ["first"],
    });
  });

  it("gives a newly registered project a unique slug", () => {
    const first = registerProject(makeWorkspace(), "Same Name");
    const second = registerProject(makeWorkspace(), "Same Name");

    expect(first.slug).toBe("same-name");
    expect(second.slug).toBe("same-name-2");
    expect(loadProjectsRegistry().projects.map((project) => project.slug)).toEqual([
      "same-name",
      "same-name-2",
    ]);
  });

  it("remembers the old slug as an alias when the name changes", () => {
    const workspace = makeWorkspace();
    const registered = registerProject(workspace, "Before");
    expect(registered.slug).toBe("before");

    // A rename lands in the project config; the next register picks it up.
    const configPath = join(workspace, ".octogent", "project.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    writeFileSync(configPath, JSON.stringify({ ...config, displayName: "After" }));

    const renamed = registerProject(workspace);
    expect(renamed.slug).toBe("after");
    expect(renamed.aliases).toEqual(["before"]);
    expect(resolveProjectKey(loadProjectsRegistry(), "before")?.id).toBe(registered.id);
  });
});
