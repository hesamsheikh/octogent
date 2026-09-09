export type Locale = "en" | "zh-CN";

export const SUPPORTED_LOCALES: Locale[] = ["en", "zh-CN"];

export const DEFAULT_LOCALE: Locale = "zh-CN";

export type TranslationParams = Record<string, string | number>;

export type TranslationMap = Record<string, string | ((params?: TranslationParams) => string)>;
