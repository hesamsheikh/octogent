import { describe, expect, it } from "vitest";
import { en, zhCN } from "../src/i18n";

// A translation whose placeholders drift from English silently renders a raw
// `{token}` to the operator, because t() only substitutes the params it is
// handed. Lock both catalogues together so a new key cannot land half-translated.
const placeholdersOf = (value: unknown): string[] =>
  typeof value === "string"
    ? [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    : [];

describe("i18n catalogue parity", () => {
  it("translates every English key", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the same placeholders in both locales", () => {
    const drift = Object.keys(en)
      .map((key) => ({
        key,
        en: placeholdersOf(en[key as keyof typeof en]),
        zh: placeholdersOf(zhCN[key as keyof typeof zhCN]),
      }))
      .filter((entry) => entry.en.join(",") !== entry.zh.join(","));

    expect(drift).toEqual([]);
  });

  it("keeps the same value kind in both locales", () => {
    const mismatched = Object.keys(en).filter(
      (key) => typeof en[key as keyof typeof en] !== typeof zhCN[key as keyof typeof zhCN],
    );

    expect(mismatched).toEqual([]);
  });
});
