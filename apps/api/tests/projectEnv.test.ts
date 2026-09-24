import { describe, expect, it } from "vitest";

import {
  MAX_INHERITED_ENV_NAMES,
  isInheritableEnvName,
  parseEnvFile,
  renderProjectEnvTemplate,
} from "../src/terminalRuntime/projectEnv";

const BASE = { PATH: "/usr/bin:/bin", HOME: "/home/dev", PWD: "/work/app" };

describe("parseEnvFile", () => {
  it("reads KEY=VALUE lines and ignores comments and blank lines", () => {
    const result = parseEnvFile("# heading\n\nFOO=bar\n   # indented comment\nBAZ=qux\n", BASE);

    expect(result).toEqual({ env: { FOO: "bar", BAZ: "qux" }, issues: [] });
  });

  it("returns only the file's own assignments, not the base", () => {
    expect(parseEnvFile("FOO=1", BASE).env).toEqual({ FOO: "1" });
  });

  it("accepts an optional export prefix and CRLF line endings", () => {
    const result = parseEnvFile("export FOO=bar\r\nexport  BAR=baz\r\n", BASE);

    expect(result.env).toEqual({ FOO: "bar", BAR: "baz" });
  });

  it("strips matching single and double quotes", () => {
    const result = parseEnvFile(`A="two words"\nB='single'\nC=""\nD="x" # trailing note`, BASE);

    expect(result.env).toEqual({ A: "two words", B: "single", C: "", D: "x" });
  });

  it("drops an inline comment after an unquoted value but keeps a bare #", () => {
    const result = parseEnvFile("A=value # note\nB=color#1", BASE);

    expect(result.env).toEqual({ A: "value", B: "color#1" });
  });

  it("expands $VAR and ${VAR} against the base, with PWD as the workspace", () => {
    const result = parseEnvFile(
      "PATH=$PWD/.venv/bin:$PATH\nVIRTUAL_ENV=${PWD}/.venv\nCACHE=${HOME}/cache",
      BASE,
    );

    expect(result.env).toEqual({
      PATH: "/work/app/.venv/bin:/usr/bin:/bin",
      VIRTUAL_ENV: "/work/app/.venv",
      CACHE: "/home/dev/cache",
    });
  });

  it("lets later lines see earlier ones, like a shell would", () => {
    const result = parseEnvFile("VIRTUAL_ENV=$PWD/.venv\nPATH=$VIRTUAL_ENV/bin:$PATH", BASE);

    expect(result.env.PATH).toBe("/work/app/.venv/bin:/usr/bin:/bin");
  });

  it("expands unknown variables to empty and leaves a lone $ alone", () => {
    const result = parseEnvFile("A=$MISSING-x\nB=cost $5\nC=${ALSO_MISSING}", BASE);

    expect(result.env).toEqual({ A: "-x", B: "cost $5", C: "" });
  });

  it("does not expand inside single quotes", () => {
    expect(parseEnvFile("A='$PATH'", BASE).env).toEqual({ A: "$PATH" });
  });

  it("skips malformed lines with their line numbers and keeps the rest", () => {
    const result = parseEnvFile(
      [
        "GOOD=1",
        "no equals sign",
        "1BAD=x",
        "BAD-NAME=x",
        'OPEN="never closed',
        "'Q'=x",
        "ALSO_GOOD=2",
      ].join("\n"),
      BASE,
    );

    expect(result.env).toEqual({ GOOD: "1", ALSO_GOOD: "2" });
    expect(result.issues.map((issue) => issue.line)).toEqual([2, 3, 4, 5, 6]);
    for (const issue of result.issues) {
      expect(issue.reason.length).toBeGreaterThan(0);
    }
  });

  it("rejects values containing NUL", () => {
    const result = parseEnvFile("A=before\0after\nB=ok", BASE);

    expect(result.env).toEqual({ B: "ok" });
    expect(result.issues).toEqual([{ line: 1, reason: expect.stringMatching(/NUL/) }]);
  });

  it("rejects a value that picks up a newline through expansion", () => {
    const result = parseEnvFile("A=$MULTI", { ...BASE, MULTI: "one\ntwo" });

    expect(result.env).toEqual({});
    expect(result.issues).toHaveLength(1);
  });

  it("treats an empty file as no assignments", () => {
    expect(parseEnvFile("", BASE)).toEqual({ env: {}, issues: [] });
  });
});

describe("isInheritableEnvName", () => {
  it("accepts upper-case shell identifiers only", () => {
    for (const name of ["PATH", "VIRTUAL_ENV", "_PRIVATE", "A1"]) {
      expect(isInheritableEnvName(name)).toBe(true);
    }
    for (const name of ["", "path", "1ABC", "A-B", "A B", "A=B", 42, null]) {
      expect(isInheritableEnvName(name)).toBe(false);
    }
  });

  it("caps the list at 64 names", () => {
    expect(MAX_INHERITED_ENV_NAMES).toBe(64);
  });
});

describe("renderProjectEnvTemplate", () => {
  it("activates a detected virtualenv", () => {
    const template = renderProjectEnvTemplate(".venv");
    const parsed = parseEnvFile(template, BASE);

    expect(parsed.issues).toEqual([]);
    expect(parsed.env).toEqual({
      PATH: "/work/app/.venv/bin:/usr/bin:/bin",
      VIRTUAL_ENV: "/work/app/.venv",
    });
  });

  it("points at venv/ when that is the directory found", () => {
    expect(parseEnvFile(renderProjectEnvTemplate("venv"), BASE).env.VIRTUAL_ENV).toBe(
      "/work/app/venv",
    );
  });

  it("only shows the virtualenv lines as comments without one", () => {
    const template = renderProjectEnvTemplate(null);

    expect(template).toContain("# PATH=$PWD/.venv/bin:$PATH");
    expect(template).toContain("# VIRTUAL_ENV=$PWD/.venv");
    expect(parseEnvFile(template, BASE)).toEqual({ env: {}, issues: [] });
  });
});
