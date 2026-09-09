import { describe, expect, it } from "vitest";

import { resolveTerminalReleaseAfterTurn } from "../src/terminalRuntime/releaseAfterTurn";

describe("resolveTerminalReleaseAfterTurn", () => {
  it.each([undefined, "", "0", "true", "yes", "2"])(
    "defaults to keeping workers alive for %s",
    (raw) => {
      expect(resolveTerminalReleaseAfterTurn(raw)).toBe(false);
    },
  );
  it.each(["1", " 1 "])("opts into release for %s", (raw) => {
    expect(resolveTerminalReleaseAfterTurn(raw)).toBe(true);
  });
});
