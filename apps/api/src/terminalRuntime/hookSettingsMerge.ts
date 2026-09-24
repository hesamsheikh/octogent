/**
 * Shared merge helpers for hook config files (Claude's .claude/settings.json
 * and Codex's .codex/hooks.json use the same nested `hooks` shape). Installs
 * must preserve entries an operator added themselves and stay idempotent.
 */

export const parseSettingsObject = (fileContents: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(fileContents) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const mergeHookEntries = (
  existingValue: unknown,
  eventName: string,
  nextEntries: unknown[],
): Record<string, unknown> => {
  const nextHooks =
    existingValue && typeof existingValue === "object" && !Array.isArray(existingValue)
      ? { ...(existingValue as Record<string, unknown>) }
      : {};
  const existingEntries = Array.isArray(nextHooks[eventName])
    ? [...(nextHooks[eventName] as unknown[])]
    : [];
  const mergedEntries = [...existingEntries];

  for (const nextEntry of nextEntries) {
    const serializedNextEntry = JSON.stringify(nextEntry);
    const alreadyPresent = existingEntries.some(
      (existingEntry) => JSON.stringify(existingEntry) === serializedNextEntry,
    );
    if (!alreadyPresent) {
      mergedEntries.push(nextEntry);
    }
  }

  nextHooks[eventName] = mergedEntries;
  return nextHooks;
};
