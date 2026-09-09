import { describe, expect, it } from "vitest";

import { normalizeFrontendUiStateSnapshot } from "../src/app/uiStateNormalizers";

describe("normalizeFrontendUiStateSnapshot", () => {
  it("keeps the operator's language so it survives a reload", () => {
    expect(normalizeFrontendUiStateSnapshot({ locale: "zh-CN" })?.locale).toBe("zh-CN");
    expect(normalizeFrontendUiStateSnapshot({ locale: "en" })?.locale).toBe("en");
  });

  it("drops a locale the build cannot render", () => {
    expect(normalizeFrontendUiStateSnapshot({ locale: "fr" })?.locale).toBeUndefined();
    expect(normalizeFrontendUiStateSnapshot({ locale: 42 })?.locale).toBeUndefined();
  });

  it("leaves the locale unset when the snapshot never carried one", () => {
    expect(normalizeFrontendUiStateSnapshot({})?.locale).toBeUndefined();
  });

  it("rejects a non-object snapshot", () => {
    expect(normalizeFrontendUiStateSnapshot(null)).toBeNull();
  });
});

describe("primary nav migration", () => {
  it("shifts a legacy snapshot's nav index for the flow-first order", () => {
    // Old order: 1 was Agents. New order: Flow takes 1, everything shifts +1.
    expect(normalizeFrontendUiStateSnapshot({ activePrimaryNav: 1 })?.activePrimaryNav).toBe(2);
    expect(normalizeFrontendUiStateSnapshot({ activePrimaryNav: 8 })?.activePrimaryNav).toBe(9);
  });

  it("keeps a versioned snapshot untouched", () => {
    const next = normalizeFrontendUiStateSnapshot({ navSchemaVersion: 2, activePrimaryNav: 1 });
    expect(next?.activePrimaryNav).toBe(1);
    expect(next?.navSchemaVersion).toBe(2);
  });

  it("maps the legacy preview slot 9 back to the new first page", () => {
    expect(normalizeFrontendUiStateSnapshot({ activePrimaryNav: 9 })?.activePrimaryNav).toBe(1);
  });

  it("stamps the schema version on migrated snapshots", () => {
    expect(normalizeFrontendUiStateSnapshot({ activePrimaryNav: 3 })?.navSchemaVersion).toBe(2);
  });
});
