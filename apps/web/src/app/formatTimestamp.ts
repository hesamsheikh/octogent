import { t } from "@octogent/core";

export const formatTimestamp = (value: string | null, locale?: string) => {
  if (!value) {
    return locale ? t(locale, "format.null") : "--";
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString(locale ?? "en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};
