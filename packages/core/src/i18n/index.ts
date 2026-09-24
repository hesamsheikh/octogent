import { en } from "./en";
import type { Locale, TranslationParams } from "./types";
import { zhCN } from "./zh-CN";

export type { Locale, TranslationParams } from "./types";
export { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "./types";
export { en } from "./en";
export { zhCN } from "./zh-CN";

const maps: Record<Locale, Record<string, unknown>> = { en, "zh-CN": zhCN };

function resolve(locale: Locale, key: string): string | ((params?: TranslationParams) => string) {
  const map = maps[locale];
  if (key in map) {
    return map[key] as string | ((params?: TranslationParams) => string);
  }
  // Fall back to English
  if (locale !== "en" && key in maps.en) {
    return maps.en[key] as string | ((params?: TranslationParams) => string);
  }
  // Missing key marker (visible in dev to catch missing keys)
  return `MISSING:${key}`;
}

export function t(locale: string | Locale, key: string, params?: TranslationParams): string {
  const effectiveLocale: Locale = locale === "zh-CN" ? "zh-CN" : "en";
  const entry = resolve(effectiveLocale, key);

  if (typeof entry === "function") {
    return entry(params);
  }

  if (params) {
    let result = entry;
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(`{${k}}`, String(v));
    }
    return result;
  }

  return entry;
}
