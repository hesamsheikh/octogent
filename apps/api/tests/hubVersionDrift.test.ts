import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type BuildIdentity,
  createDriftWarner,
  describeBuildDrift,
  resolveBuildIdentity,
} from "../src/hubVersionDrift";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const cli: BuildIdentity = {
  version: "0.2.0",
  commit: "bbbbbbb",
  builtAt: "2026-09-22T10:00:00.000Z",
};

describe("describeBuildDrift", () => {
  it("is silent for the same build", () => {
    expect(describeBuildDrift({ ...cli }, cli)).toBeNull();
    expect(describeBuildDrift({ version: "0.2.0" }, { version: "0.2.0" })).toBeNull();
  });

  it("calls a lower version older and a higher one different", () => {
    expect(describeBuildDrift({ version: "0.1.9" }, cli)).toBe("older");
    expect(describeBuildDrift({ version: "0.10.0" }, cli)).toBe("different");
  });

  it("compares commits when both sides know theirs", () => {
    expect(describeBuildDrift({ ...cli, commit: "aaaaaaa" }, cli)).toBe("different");
  });

  it("falls back to the bundle build time when a commit is unknown", () => {
    expect(describeBuildDrift({ version: "0.2.0", builtAt: "2026-09-21T10:00:00.000Z" }, cli)).toBe(
      "older",
    );
    expect(
      describeBuildDrift(
        { version: "0.2.0", builtAt: "2026-09-21T10:00:00.000Z" },
        { version: "0.2.0", builtAt: "2026-09-21T10:00:00.000Z" },
      ),
    ).toBeNull();
  });

  it("stays silent when neither commits nor build times can be compared", () => {
    // A hub started under systemd with a commit set and a shell CLI without
    // one must not warn on every command.
    expect(
      describeBuildDrift({ version: "0.2.0", commit: "bbbbbbb" }, { version: "0.2.0" }),
    ).toBeNull();
  });
});

describe("createDriftWarner", () => {
  it("warns once per command when the builds differ", () => {
    const lines: string[] = [];
    const warn = createDriftWarner(cli, "en", (line) => lines.push(line));

    warn({ version: "0.2.0", commit: "aaaaaaa" });
    warn({ version: "0.2.0", commit: "aaaaaaa" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("different build");
    expect(lines[0]).toContain("octogent hub restart");
    expect(lines[0]).toContain("aaaaaaa");
  });

  it("says older when it can tell", () => {
    const lines: string[] = [];
    createDriftWarner(cli, "en", (line) => lines.push(line))({ version: "0.1.0" });

    expect(lines[0]).toContain("older build");
    expect(lines[0]).toContain("when workers are idle");
  });

  it("is silent when the builds match", () => {
    const lines: string[] = [];
    const warn = createDriftWarner(cli, "zh-CN", (line) => lines.push(line));

    warn({ ...cli });

    expect(lines).toEqual([]);
  });
});

describe("resolveBuildIdentity", () => {
  const makePackageRoot = () => {
    const root = mkdtempSync(join(tmpdir(), "octogent-build-id-"));
    temporaryDirectories.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "3.4.5" }));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "");
    return root;
  };

  it("takes the version from the package, the commit from the env, and the bundle's mtime", () => {
    const root = makePackageRoot();
    mkdirSync(join(root, "dist", "api"), { recursive: true });
    const bundle = join(root, "dist", "api", "cli.js");
    writeFileSync(bundle, "");
    const builtAt = new Date("2026-09-20T08:00:00.000Z");
    utimesSync(bundle, builtAt, builtAt);

    expect(resolveBuildIdentity(root, { OCTOGENT_BUILD_COMMIT: " abc1234 " })).toEqual({
      version: "3.4.5",
      commit: "abc1234",
      builtAt: builtAt.toISOString(),
    });
  });

  it("leaves out what it cannot know", () => {
    expect(resolveBuildIdentity(makePackageRoot(), {})).toEqual({ version: "3.4.5" });
  });
});
