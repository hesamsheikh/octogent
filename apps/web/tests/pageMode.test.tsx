import { describe, expect, it } from "vitest";

import { resolvePageMode } from "../src/app/hub/pageMode";

describe("resolvePageMode", () => {
  it("treats the site root as the page that probes for a hub", () => {
    expect(resolvePageMode("/")).toEqual({ kind: "root" });
    expect(resolvePageMode("/index.html")).toEqual({ kind: "root" });
    expect(resolvePageMode("")).toEqual({ kind: "root" });
  });

  it("recognizes a project page with or without a trailing path", () => {
    expect(resolvePageMode("/p/keycluster/")).toEqual({
      kind: "project",
      projectKey: "keycluster",
    });
    expect(resolvePageMode("/p/keycluster")).toEqual({ kind: "project", projectKey: "keycluster" });
    expect(resolvePageMode("/p/abc-123/deck")).toEqual({ kind: "project", projectKey: "abc-123" });
  });

  it("keeps the key exactly as the address bar encodes it", () => {
    expect(resolvePageMode("/p/my%20app/")).toEqual({ kind: "project", projectKey: "my%20app" });
  });

  it("does not mistake look-alike paths for a project page", () => {
    expect(resolvePageMode("/p/")).toEqual({ kind: "root" });
    expect(resolvePageMode("/p//deck")).toEqual({ kind: "root" });
    expect(resolvePageMode("/pages/keycluster/")).toEqual({ kind: "root" });
    expect(resolvePageMode("/api/p/keycluster/")).toEqual({ kind: "root" });
  });
});
