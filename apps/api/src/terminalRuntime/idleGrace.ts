import { TERMINAL_SESSION_IDLE_GRACE_MS } from "./constants";

/**
 * How long a PTY with no browser attached and no keep-alive stays open before
 * the runtime closes it. `OCTOGENT_TERMINAL_IDLE_GRACE_MS` overrides the
 * default; anything unparsable or non-positive falls back to it so a typo
 * cannot make sessions close instantly.
 */
export const resolveSessionIdleGraceMs = (rawValue: string | undefined): number => {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return TERMINAL_SESSION_IDLE_GRACE_MS;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return TERMINAL_SESSION_IDLE_GRACE_MS;
  }

  return Math.floor(parsed);
};
