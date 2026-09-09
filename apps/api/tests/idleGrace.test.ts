import { describe, expect, it } from "vitest";

import { TERMINAL_SESSION_IDLE_GRACE_MS } from "../src/terminalRuntime/constants";
import { resolveSessionIdleGraceMs } from "../src/terminalRuntime/idleGrace";

describe("resolveSessionIdleGraceMs", () => {
  it("defaults to five minutes", () => {
    expect(resolveSessionIdleGraceMs(undefined)).toBe(TERMINAL_SESSION_IDLE_GRACE_MS);
    expect(resolveSessionIdleGraceMs("")).toBe(5 * 60 * 1000);
  });

  it("honors a positive override in milliseconds", () => {
    expect(resolveSessionIdleGraceMs("1800000")).toBe(30 * 60 * 1000);
    expect(resolveSessionIdleGraceMs(" 90000.9 ")).toBe(90000);
  });

  it("falls back on values that would close sessions instantly or never", () => {
    for (const raw of ["0", "-5", "abc", "Infinity", "NaN"]) {
      expect(resolveSessionIdleGraceMs(raw), raw).toBe(TERMINAL_SESSION_IDLE_GRACE_MS);
    }
  });
});
