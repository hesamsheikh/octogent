import { describe, expect, it } from "vitest";
import { parseTerminalInput } from "../src/terminalRuntime/terminalInput";

describe("parseTerminalInput", () => {
  it("types text followed by only the allowed key sequences", () => {
    expect(
      parseTerminalInput({
        text: "是",
        keys: ["1", "tab", "esc", "up", "down", "ctrl-c", "enter"],
        enter: true,
      }),
    ).toEqual({ data: "是1\t\x1b\x1b[A\x1b[B\x03\r", enter: true });
  });
  it.each([
    null,
    [],
    {},
    { text: 1 },
    { enter: "true" },
    { keys: "up" },
    { keys: ["toString"] },
    { keys: ["10"] },
    { text: "界".repeat(1400) },
    { keys: Array(4097).fill("1") },
  ])("rejects invalid or oversized input %j", (payload) => {
    expect(() => parseTerminalInput(payload)).toThrow();
  });
});
