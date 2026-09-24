import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type ApiTargetInput,
  extractGlobalFlags,
  findCurrentProject,
  findGitRoot,
  findProjectConfigRoot,
  resolveApiTarget,
} from "../src/cliApiTarget";
import type { HubMetadata } from "../src/hubMetadata";
import type { ProjectRegistryEntry } from "../src/projectPersistence";
import type { RuntimeMetadata } from "../src/runtimeMetadata";

const HUB = "http://127.0.0.1:8787";

const entry = (overrides: Partial<ProjectRegistryEntry>): ProjectRegistryEntry => ({
  id: "id-alpha",
  name: "Alpha",
  slug: "alpha",
  path: "/work/alpha",
  createdAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

const alpha = entry({});
const beta = entry({
  id: "id-beta",
  name: "Beta",
  slug: "beta",
  aliases: ["old-beta"],
  path: "/work/beta",
});
const betaNested = entry({
  id: "id-beta-docs",
  name: "Beta docs",
  slug: "beta-docs",
  path: "/work/beta/docs",
});

const hubMetadata: HubMetadata = {
  apiBaseUrl: HUB,
  host: "127.0.0.1",
  port: 8787,
  pid: 4242,
  startedAt: "2026-09-22T00:00:00.000Z",
  version: "0.1.0",
};

const runtimeFor = (workspaceCwd: string): RuntimeMetadata => ({
  apiBaseUrl: "http://127.0.0.1:8790",
  host: "127.0.0.1",
  port: 8790,
  pid: 5151,
  startedAt: "2026-09-22T00:00:00.000Z",
  workspaceCwd,
});

const input = (overrides: Partial<ApiTargetInput> = {}): ApiTargetInput => ({
  env: {},
  cwd: "/work/alpha",
  registry: { projects: [alpha, beta, betaNested] },
  hubMetadata,
  runtimeMetadata: null,
  cwdProject: null,
  gitRoot: null,
  ...overrides,
});

describe("resolveApiTarget", () => {
  describe("(a) an explicit base", () => {
    it("uses OCTOGENT_API_BASE as is, ahead of everything else", () => {
      const target = resolveApiTarget(
        input({
          env: {
            OCTOGENT_API_BASE: `${HUB}/api/p/id-beta`,
            OCTOGENT_API_ORIGIN: "http://127.0.0.1:9999",
          },
          runtimeMetadata: runtimeFor("/work/alpha"),
          projectFlag: "alpha",
        }),
      );
      expect(target).toEqual({ kind: "explicit", apiBase: `${HUB}/api/p/id-beta` });
    });

    it("falls back to OCTOGENT_API_ORIGIN", () => {
      expect(
        resolveApiTarget(input({ env: { OCTOGENT_API_ORIGIN: " http://127.0.0.1:9999 " } })),
      ).toEqual({ kind: "explicit", apiBase: "http://127.0.0.1:9999" });
    });

    it("ignores blank values", () => {
      expect(resolveApiTarget(input({ env: { OCTOGENT_API_BASE: "  " } })).kind).toBe("hub");
    });
  });

  describe("(b) a live single-project server", () => {
    it("wins over the hub for the current project", () => {
      expect(resolveApiTarget(input({ runtimeMetadata: runtimeFor("/work/alpha") }))).toEqual({
        kind: "standalone",
        apiBase: "http://127.0.0.1:8790",
      });
    });

    it("is used even when no hub runs", () => {
      expect(
        resolveApiTarget(input({ hubMetadata: null, runtimeMetadata: runtimeFor("/work/alpha") })),
      ).toMatchObject({ kind: "standalone" });
    });

    it("is skipped when --project names a different project", () => {
      expect(
        resolveApiTarget(
          input({ runtimeMetadata: runtimeFor("/work/alpha"), projectFlag: "beta" }),
        ),
      ).toMatchObject({ kind: "hub", project: { id: "id-beta" } });
    });

    it("is kept when --project names the project it serves", () => {
      expect(
        resolveApiTarget(
          input({ runtimeMetadata: runtimeFor("/work/alpha"), projectFlag: "alpha" }),
        ),
      ).toMatchObject({ kind: "standalone" });
    });
  });

  describe("(c) the hub", () => {
    it("scopes the base to the id of the project named by slug", () => {
      expect(resolveApiTarget(input({ projectFlag: "beta" }))).toEqual({
        kind: "hub",
        apiBase: `${HUB}/api/p/id-beta`,
        hubBaseUrl: HUB,
        project: beta,
      });
    });

    it("accepts an id, an alias, and a slug in any case", () => {
      for (const key of ["id-beta", "old-beta", "BETA"]) {
        expect(resolveApiTarget(input({ projectFlag: key })), key).toMatchObject({
          apiBase: `${HUB}/api/p/id-beta`,
        });
      }
    });

    it("fails on an unknown --project without starting anything", () => {
      expect(resolveApiTarget(input({ projectFlag: "nope", hubMetadata: null }))).toEqual({
        kind: "error",
        reason: "unknown-project",
        detail: "nope",
      });
    });

    it("finds the registered project whose path contains cwd, nearest first", () => {
      expect(resolveApiTarget(input({ cwd: "/work/beta/src/lib" }))).toMatchObject({
        project: { id: "id-beta" },
      });
      expect(resolveApiTarget(input({ cwd: "/work/beta/docs/guide" }))).toMatchObject({
        project: { id: "id-beta-docs" },
      });
    });

    it("does not treat a sibling with a common prefix as containing cwd", () => {
      expect(resolveApiTarget(input({ cwd: "/work/alphabet", gitRoot: null }))).toMatchObject({
        kind: "error",
        reason: "not-a-project",
      });
    });

    it("prefers the id in the nearest project.json over the registered path", () => {
      // The workspace moved: its registry path is old, its project.json is not.
      expect(
        resolveApiTarget(
          input({
            cwd: "/moved/beta/src",
            cwdProject: { root: "/moved/beta", projectId: "id-beta" },
          }),
        ),
      ).toMatchObject({ kind: "hub", project: { id: "id-beta" } });
    });

    it("strips a trailing slash from the hub address", () => {
      expect(
        resolveApiTarget(input({ hubMetadata: { ...hubMetadata, apiBaseUrl: `${HUB}/` } })),
      ).toMatchObject({ apiBase: `${HUB}/api/p/id-alpha`, hubBaseUrl: HUB });
    });
  });

  describe("registration", () => {
    it("asks to register an unregistered git repository at its root", () => {
      expect(resolveApiTarget(input({ cwd: "/work/gamma/src", gitRoot: "/work/gamma" }))).toEqual({
        kind: "register",
        hubBaseUrl: HUB,
        path: "/work/gamma",
      });
    });

    it("asks to register an initialized but unregistered project even without git", () => {
      expect(
        resolveApiTarget(
          input({ cwd: "/work/delta", cwdProject: { root: "/work/delta", projectId: "id-delta" } }),
        ),
      ).toMatchObject({ kind: "register", path: "/work/delta" });
    });

    it("keeps a repository nested inside a registered project with that project", () => {
      expect(
        resolveApiTarget(
          input({ cwd: "/work/alpha/vendor/lib", gitRoot: "/work/alpha/vendor/lib" }),
        ),
      ).toMatchObject({ kind: "hub", project: { id: "id-alpha" } });
      // A nested project.json is a project of its own, though.
      expect(
        resolveApiTarget(
          input({
            cwd: "/work/alpha/vendor/lib",
            cwdProject: { root: "/work/alpha/vendor/lib", projectId: "id-lib" },
          }),
        ),
      ).toMatchObject({ kind: "register", path: "/work/alpha/vendor/lib" });
    });

    it("fails for a directory that is neither registered nor a repository", () => {
      expect(resolveApiTarget(input({ cwd: "/tmp/scratch" }))).toEqual({
        kind: "error",
        reason: "not-a-project",
        detail: "/tmp/scratch",
      });
    });
  });

  describe("(d) no hub", () => {
    it("asks to start one when the project is known or registrable", () => {
      expect(resolveApiTarget(input({ hubMetadata: null }))).toEqual({ kind: "start-hub" });
      expect(
        resolveApiTarget(input({ hubMetadata: null, cwd: "/work/gamma", gitRoot: "/work/gamma" })),
      ).toEqual({ kind: "start-hub" });
    });

    it("fails with OCTOGENT_NO_AUTOSTART=1 instead", () => {
      expect(
        resolveApiTarget(input({ hubMetadata: null, env: { OCTOGENT_NO_AUTOSTART: "1" } })),
      ).toEqual({ kind: "error", reason: "autostart-disabled" });
    });

    it("does not start a hub for a directory it could never serve", () => {
      expect(resolveApiTarget(input({ hubMetadata: null, cwd: "/tmp/scratch" }))).toMatchObject({
        kind: "error",
        reason: "not-a-project",
      });
    });
  });
});

describe("findCurrentProject", () => {
  it("returns the project cwd belongs to, or null", () => {
    const registry = { projects: [alpha, beta, betaNested] };
    expect(findCurrentProject(registry, "/work/beta/docs", null)?.id).toBe("id-beta-docs");
    expect(findCurrentProject(registry, "/elsewhere", null)).toBeNull();
    expect(
      findCurrentProject(registry, "/elsewhere", { root: "/elsewhere", projectId: "id-alpha" })?.id,
    ).toBe("id-alpha");
  });
});

describe("extractGlobalFlags", () => {
  it("pulls --project and --standalone out of the arguments", () => {
    expect(extractGlobalFlags(["terminal", "list", "--project", "beta", "--archived"])).toEqual({
      args: ["terminal", "list", "--archived"],
      projectFlag: "beta",
      standalone: false,
    });
    expect(extractGlobalFlags(["--project=beta", "tentacle", "list"])).toEqual({
      args: ["tentacle", "list"],
      projectFlag: "beta",
      standalone: false,
    });
    expect(extractGlobalFlags(["--standalone"])).toEqual({
      args: [],
      projectFlag: undefined,
      standalone: true,
    });
  });

  it("reports a --project without a value as an empty key", () => {
    expect(extractGlobalFlags(["terminal", "list", "--project"]).projectFlag).toBe("");
  });
});

describe("filesystem lookups", () => {
  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const makeTree = () => {
    const root = mkdtempSync(join(tmpdir(), "octogent-api-target-"));
    temporaryDirectories.push(root);
    const project = join(root, "project");
    const deep = join(project, "src", "deep");
    mkdirSync(deep, { recursive: true });
    return { root, project, deep };
  };

  it("walks up to the nearest .octogent/project.json", () => {
    const { root, project, deep } = makeTree();
    mkdirSync(join(project, ".octogent"));
    writeFileSync(
      join(project, ".octogent", "project.json"),
      JSON.stringify({
        version: 1,
        projectId: "id-fs",
        displayName: "fs",
        createdAt: "2026-09-01T00:00:00.000Z",
      }),
    );

    expect(findProjectConfigRoot(deep)).toEqual({ root: project, projectId: "id-fs" });
    expect(findProjectConfigRoot(root)).toBeNull();
  });

  it("walks up to the nearest git repository, worktree files included", () => {
    const { root, project, deep } = makeTree();
    expect(findGitRoot(deep)).not.toBe(project);

    mkdirSync(join(project, ".git"));
    expect(findGitRoot(deep)).toBe(project);

    const worktree = join(root, "worktree");
    mkdirSync(worktree);
    writeFileSync(join(worktree, ".git"), "gitdir: /elsewhere/.git/worktrees/w\n");
    expect(findGitRoot(worktree)).toBe(worktree);
  });
});
