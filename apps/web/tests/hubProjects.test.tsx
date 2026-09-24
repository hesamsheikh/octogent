import { describe, expect, it } from "vitest";

import {
  buildProjectPageHref,
  findProjectByKey,
  normalizeHubProjects,
} from "../src/app/hub/hubProjects";

const loadedEntry = {
  id: "abc-123",
  name: "Key Cluster",
  slug: "keycluster",
  path: "/work/keycluster",
  loaded: true,
  summary: {
    id: "abc-123",
    name: "Key Cluster",
    path: "/work/keycluster",
    ptySessions: 3,
    runningTerminals: 2,
    awaitingReviewTerminals: 1,
    lastActivityAt: "2026-09-22T08:00:00.000Z",
  },
};

describe("normalizeHubProjects", () => {
  it("reads loaded and unloaded projects from the hub listing", () => {
    const projects = normalizeHubProjects({
      projects: [
        loadedEntry,
        { id: "def-456", name: "Docs", slug: "docs", path: "/work/docs", loaded: false },
      ],
    });

    expect(projects).toEqual([
      {
        id: "abc-123",
        name: "Key Cluster",
        slug: "keycluster",
        path: "/work/keycluster",
        loaded: true,
        summary: {
          ptySessions: 3,
          runningTerminals: 2,
          awaitingReviewTerminals: 1,
          lastActivityAt: "2026-09-22T08:00:00.000Z",
        },
      },
      {
        id: "def-456",
        name: "Docs",
        slug: "docs",
        path: "/work/docs",
        loaded: false,
        summary: null,
      },
    ]);
  });

  it("returns null for anything that is not a project listing", () => {
    expect(normalizeHubProjects(null)).toBeNull();
    expect(normalizeHubProjects({ error: "Not found" })).toBeNull();
    expect(normalizeHubProjects({ projects: "nope" })).toBeNull();
  });

  it("drops malformed entries and zeroes malformed counts", () => {
    const projects = normalizeHubProjects({
      projects: [
        { name: "no id" },
        {
          ...loadedEntry,
          summary: { runningTerminals: "2", awaitingReviewTerminals: -1, lastActivityAt: 5 },
        },
      ],
    });

    expect(projects).toHaveLength(1);
    expect(projects?.[0]?.summary).toEqual({
      ptySessions: 0,
      runningTerminals: 0,
      awaitingReviewTerminals: 0,
      lastActivityAt: null,
    });
  });
});

describe("buildProjectPageHref", () => {
  it("links to the project page with a trailing slash", () => {
    expect(buildProjectPageHref("keycluster")).toBe("/p/keycluster/");
    expect(buildProjectPageHref("my app")).toBe("/p/my%20app/");
  });
});

describe("findProjectByKey", () => {
  const projects = normalizeHubProjects({ projects: [loadedEntry] }) ?? [];

  it("matches the page key against the slug or the id", () => {
    expect(findProjectByKey(projects, "keycluster")?.name).toBe("Key Cluster");
    expect(findProjectByKey(projects, "abc-123")?.name).toBe("Key Cluster");
    expect(findProjectByKey(projects, "Key%20Cluster")).toBeNull();
    expect(findProjectByKey(projects, "unknown")).toBeNull();
  });
});
