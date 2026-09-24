import { describe, expect, it } from "vitest";

import { parseUiStatePatch } from "../src/createApiServer/uiStateParsers";

describe("parseUiStatePatch", () => {
  it("round-trips navSchemaVersion so the nav migration runs only once", () => {
    // When this field is stripped, every reload replays the migration and the
    // restored page shifts by one per refresh.
    const { patch, error } = parseUiStatePatch({ activePrimaryNav: 1, navSchemaVersion: 2 });
    expect(error).toBeNull();
    expect(patch?.navSchemaVersion).toBe(2);
    expect(patch?.activePrimaryNav).toBe(1);
  });

  it("rejects a non-integer navSchemaVersion", () => {
    expect(parseUiStatePatch({ navSchemaVersion: "2" }).error).toContain("navSchemaVersion");
    expect(parseUiStatePatch({ navSchemaVersion: 0 }).error).toContain("navSchemaVersion");
  });

  it("leaves the field absent when not sent", () => {
    const { patch, error } = parseUiStatePatch({ activePrimaryNav: 3 });
    expect(error).toBeNull();
    expect(patch && "navSchemaVersion" in patch).toBe(false);
  });
});
