import { afterEach, describe, expect, it } from "vitest";

import { createShellEnvironment } from "../src/terminalRuntime/ptyEnvironment";

const TOUCHED = ["CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE"] as const;
const saved = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of TOUCHED) {
    const value = saved.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  saved.clear();
});

const stub = (key: (typeof TOUCHED)[number], value: string) => {
  if (!saved.has(key)) {
    saved.set(key, process.env[key]);
  }
  process.env[key] = value;
};

describe("createShellEnvironment", () => {
  it("does not pass the parent's Claude session markers to agents", () => {
    // Octogent itself is often launched from inside a Claude Code session.
    // Inheriting these markers makes every agent believe it is a child
    // session — Claude then disables transcript saving, which breaks the
    // Stop-hook driven transcript pipeline completion detection relies on.
    stub("CLAUDE_CODE_CHILD_SESSION", "1");
    stub("CLAUDECODE", "1");

    const env = createShellEnvironment();

    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
  });

  it("keeps unrelated variables and the terminal defaults", () => {
    const env = createShellEnvironment({ octogentSessionId: "terminal-9" });

    expect(env.TERM).toBe("xterm-256color");
    expect(env.OCTOGENT_SESSION_ID).toBe("terminal-9");
    expect(env.PATH).toBe(process.env.PATH);
  });
});
