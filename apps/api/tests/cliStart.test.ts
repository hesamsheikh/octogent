import { describe, expect, it } from "vitest";

import { type StartModeInput, resolveStartMode } from "../src/cliStart";

const input = (overrides: Partial<StartModeInput> = {}): StartModeInput => ({
  args: [],
  hubAlive: true,
  portHolder: "free",
  registered: null,
  registrablePath: null,
  ownServerUrl: null,
  autostart: true,
  ...overrides,
});

describe("resolveStartMode", () => {
  it("opens a registered project's page on a running hub", () => {
    expect(resolveStartMode(input({ registered: { slug: "alpha" } }))).toEqual({
      kind: "hub",
      page: { kind: "project", slug: "alpha" },
    });
  });

  it("registers a git repository the hub does not know yet", () => {
    expect(resolveStartMode(input({ registrablePath: "/work/repo" }))).toEqual({
      kind: "hub",
      page: { kind: "register", path: "/work/repo" },
    });
  });

  it("opens the project overview outside any project", () => {
    expect(resolveStartMode(input())).toEqual({ kind: "hub", page: { kind: "overview" } });
  });

  it("starts the hub when none runs and its port is free", () => {
    expect(resolveStartMode(input({ hubAlive: false, registered: { slug: "alpha" } }))).toEqual({
      kind: "hub",
      page: { kind: "project", slug: "alpha" },
    });
    expect(resolveStartMode(input({ hubAlive: false }))).toEqual({
      kind: "hub",
      page: { kind: "overview" },
    });
  });

  it("never starts a hub beside whatever already holds its port", () => {
    for (const portHolder of ["other", "hub"] as const) {
      expect(
        resolveStartMode(input({ hubAlive: false, portHolder, registered: { slug: "alpha" } })),
        portHolder,
      ).toEqual({ kind: "port-blocked" });
    }
    // The port only matters while no hub answers: a live hub is what holds it.
    expect(resolveStartMode(input({ portHolder: "hub", registered: { slug: "a" } }))).toEqual({
      kind: "hub",
      page: { kind: "project", slug: "a" },
    });
  });

  it("keeps --standalone the single-project server, whatever else is true", () => {
    for (const args of [["--standalone"], ["start", "--standalone"]]) {
      expect(
        resolveStartMode(
          input({ args, registered: { slug: "alpha" }, ownServerUrl: "http://127.0.0.1:8788" }),
        ),
      ).toEqual({ kind: "standalone" });
    }
    expect(
      resolveStartMode(input({ args: ["--standalone"], hubAlive: false, portHolder: "other" })),
    ).toEqual({ kind: "standalone" });
  });

  it("points at the project's own single-project server instead of loading it twice", () => {
    const ownServerUrl = "http://127.0.0.1:8788";
    expect(resolveStartMode(input({ ownServerUrl, registered: { slug: "alpha" } }))).toEqual({
      kind: "own-server",
      url: ownServerUrl,
    });
    // Holding the hub's port itself is no reason to fail: it is the answer.
    expect(resolveStartMode(input({ ownServerUrl, hubAlive: false, portHolder: "other" }))).toEqual(
      { kind: "own-server", url: ownServerUrl },
    );
  });

  it("refuses to start a hub under OCTOGENT_NO_AUTOSTART but uses a running one", () => {
    expect(resolveStartMode(input({ hubAlive: false, autostart: false }))).toEqual({
      kind: "autostart-disabled",
    });
    expect(resolveStartMode(input({ autostart: false, registered: { slug: "alpha" } }))).toEqual({
      kind: "hub",
      page: { kind: "project", slug: "alpha" },
    });
  });
});
