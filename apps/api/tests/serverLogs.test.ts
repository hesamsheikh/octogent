import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseServerLogsArgs, readServerLogTail, resolveServerLogPath } from "../src/serverLogs";

describe("server logs CLI helpers", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const makeStateDir = () => {
    const directory = mkdtempSync(join(tmpdir(), "octogent-server-logs-test-"));
    temporaryDirectories.push(directory);
    return directory;
  };

  it("parses line count and follow flags", () => {
    expect(parseServerLogsArgs(["--lines", "25", "--follow"])).toEqual({
      follow: true,
      lines: 25,
    });
    expect(parseServerLogsArgs([])).toEqual({ follow: false, lines: 100 });
    expect(() => parseServerLogsArgs(["--lines", "0"])).toThrow("positive integer");
  });

  it("reads only the requested trailing lines", () => {
    const projectStateDir = makeStateDir();
    const logPath = resolveServerLogPath(projectStateDir, {});
    mkdirSync(join(projectStateDir, "logs"), { recursive: true });
    writeFileSync(logPath, "one\ntwo\nthree\nfour\n");

    expect(readServerLogTail(logPath, 2)).toBe("three\nfour\n");
    expect(readFileSync(logPath, "utf8")).toContain("one");
  });

  it("uses the configured override path", () => {
    const projectStateDir = makeStateDir();
    const overridePath = join(projectStateDir, "custom.log");

    expect(resolveServerLogPath(projectStateDir, { OCTOGENT_SERVER_LOG: overridePath })).toBe(
      overridePath,
    );
  });
});
