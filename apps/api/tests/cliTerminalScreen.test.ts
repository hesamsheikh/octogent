import { describe, expect, it } from "vitest";
import { buildTerminalResult } from "../src/cliTerminalResult";
import { formatScreen, parseInputArgs, parseScreenArgs } from "../src/cliTerminalScreen";

describe("terminal screen and input arguments", () => {
  it("defaults to 40 processed lines and accepts raw tails", () => {
    expect(parseScreenArgs(["worker"])).toEqual({ terminalId: "worker", lines: 40, raw: false });
    expect(parseScreenArgs(["worker", "--lines", "20", "--raw"])).toEqual({
      terminalId: "worker",
      lines: 20,
      raw: true,
    });
  });
  it.each([
    [],
    ["--raw"],
    ["worker", "--lines"],
    ["worker", "--lines", "0"],
    ["worker", "--lines", "1.5"],
    ["worker", "--lines", "201"],
    ["worker", "--wat"],
  ])("rejects invalid screen args %j", (...args) => {
    expect(parseScreenArgs(args)).toBeNull();
  });
  it("preserves literal input and allows key-only input", () => {
    expect(parseInputArgs(["worker", " yes ", "--enter", "--keys", "up,1"])).toEqual({
      terminalId: "worker",
      text: " yes ",
      enter: true,
      keys: ["up", "1"],
    });
    expect(parseInputArgs(["worker", "--keys", "ctrl-c"])).toEqual({
      terminalId: "worker",
      text: "",
      enter: false,
      keys: ["ctrl-c"],
    });
  });
  it.each([
    [],
    ["worker"],
    ["worker", "text", "extra"],
    ["worker", "--keys"],
    ["worker", "--keys", "delete"],
  ])("rejects invalid input args %j", (...args) => {
    expect(parseInputArgs(args)).toBeNull();
  });
  it("labels saved screens and includes screen in results only when requested", () => {
    const screen = { text: "Limit reached", savedAt: "2026-09-21T00:00:00Z", raw: false };
    expect(formatScreen(screen, "en")).toContain("saved at 2026-09-21T00:00:00Z");
    expect(formatScreen(screen, "zh-CN")).toContain("2026-09-21T00:00:00Z");
    expect(buildTerminalResult({ terminalId: "worker" }, [], screen).screen).toEqual(screen);
    expect(buildTerminalResult({ terminalId: "worker" }, [])).not.toHaveProperty("screen");
  });
});
