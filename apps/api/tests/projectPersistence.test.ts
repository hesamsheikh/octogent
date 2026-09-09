import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveGlobalOctogentDir } from "../src/projectPersistence";

// stubEnv rather than assignment: writing `undefined` into process.env stores
// the literal string "undefined", which would not exercise the default path.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveGlobalOctogentDir", () => {
  it("defaults to the state root under the operator's home", () => {
    vi.stubEnv("OCTOGENT_HOME", undefined);

    expect(resolveGlobalOctogentDir()).toBe(join(homedir(), ".octogent"));
  });

  it("relocates the state root when OCTOGENT_HOME is set", () => {
    vi.stubEnv("OCTOGENT_HOME", "/tmp/octogent-isolated-root");

    expect(resolveGlobalOctogentDir()).toBe("/tmp/octogent-isolated-root");
  });

  it("ignores a blank override so a stray export cannot point at the filesystem root", () => {
    vi.stubEnv("OCTOGENT_HOME", "   ");

    expect(resolveGlobalOctogentDir()).toBe(join(homedir(), ".octogent"));
  });

  it("isolates the suite from the real registry", () => {
    // The setup file must win before any module captured the state root.
    expect(process.env.OCTOGENT_HOME).toMatch(/octogent-test-home-/);
    expect(resolveGlobalOctogentDir()).not.toBe(join(homedir(), ".octogent"));
  });
});

describe("claude config isolation", () => {
  it("keeps trust seeding out of the operator's real config during tests", () => {
    expect(process.env.OCTOGENT_CLAUDE_CONFIG).toMatch(/octogent-test-home-/);
  });
});
