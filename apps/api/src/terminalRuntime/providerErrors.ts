import { stripVTControlCharacters } from "node:util";

import type { TerminalProviderErrorKind } from "@octogent/core";

import type { PersistedTerminal } from "./types";

/**
 * Recognizes the banners agent CLIs print when their provider refuses work.
 *
 * Neither CLI reports these through hooks: Codex ended a usage-limited turn in
 * 2.6 s with no Stop hook, and Claude sat on "API Error: Connection lost" for
 * 417 minutes, so Octogent showed `running` and then a generic stall while
 * coordinators re-dispatched into the same wall (2026-09-21). The PTY text is
 * the only signal, so this matches banner shapes — a known prefix at the start
 * of a line — rather than words, which workers also use in ordinary prose.
 */

export type ProviderErrorMatch = { kind: TerminalProviderErrorKind; message: string };

const MAX_MESSAGE_LENGTH = 200;
// Only the start of a line can hold a banner, so an overlong line is judged
// by its head and the rest of it is skipped.
const MAX_PENDING_LENGTH = 1_024;

const BANNER_RULES: ReadonlyArray<{ kind: TerminalProviderErrorKind; pattern: RegExp }> = [
  // Auth first: Claude prints auth failures as "API Error: 401 …".
  { kind: "auth", pattern: /^API Error:?\s*\(?401\b/i },
  { kind: "auth", pattern: /^API Error\b.*\bauthentication_error\b/i },
  { kind: "auth", pattern: /^(?:unexpected status 401|401 Unauthorized)\b/i },
  { kind: "auth", pattern: /^(?:Invalid API key|OAuth token (?:has )?(?:expired|revoked))\b/i },
  { kind: "auth", pattern: /^(?:[^·∙•]{0,120}[·∙•]\s*)?Please run \/login\b/i },
  { kind: "usage-limit", pattern: /^You['’]ve hit your (?:usage )?limit\b/i },
  { kind: "usage-limit", pattern: /^(?:Claude (?:AI )?)?usage limit (?:reached|exceeded)\b/i },
  {
    kind: "usage-limit",
    pattern:
      /^(?:5-hour|session|daily|weekly|monthly|(?:opus|sonnet)(?: weekly)?) limit reached\b/i,
  },
  { kind: "usage-limit", pattern: /^Credit balance is too low\b/i },
  { kind: "rate-limit", pattern: /^API Error:?\s*\(?429\b/i },
  { kind: "rate-limit", pattern: /^API Error\b.*\brate_limit_error\b/i },
  {
    kind: "rate-limit",
    pattern: /^(?:(?:unexpected status|exceeded retry limit, last status:?) 429|429 Too Many)\b/i,
  },
  { kind: "rate-limit", pattern: /^rate limit(?:ed| (?:reached|exceeded|hit))\b/i },
  { kind: "api-error", pattern: /^API Error\b/i },
  { kind: "api-error", pattern: /^Connection lost\b/i },
  { kind: "api-error", pattern: /^Overloaded\b/i },
  { kind: "api-error", pattern: /^stream disconnected before completion\b/i },
  { kind: "api-error", pattern: /^unexpected status [45]\d\d\b/i },
];

// Cheap gate so ordinary output (spinners, code, prose) skips the line rules.
const BANNER_HINT_RE =
  /limit|error|login|unauthorized|overloaded|connection lost|disconnected|credit balance|\b40[13]\b|\b429\b/i;

// The CLI is still retrying on its own; only the final failure is a banner.
const RETRY_NOTICE_RE = /\bretrying\b|\bretry in\b|\battempt \d+\s*\/\s*\d+/i;

// Glyphs the TUIs draw in front of an error: Claude's ⎿/●/⏺, Codex's ■/⚠.
// Prompt markers (> ›) are left out so echoed user input never counts.
const LEADING_DECORATION_RE = /^(?:[\s⎿●⏺■⚠✗✘×│└╰▌]|\u{FE0F})+/u;

const ESC = "\u001b";
const BEL = "\u0007";
const OSC_RE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");
// Cursor moves to another row (or column 1) start a new visual line; TUIs that
// paint by cursor address never print a newline between rows.
const LINE_BREAK_SOURCE = `\\r\\n?|\\n|${ESC}\\[[0-9;?]*[ABEFGHdf]|${ESC}[DEM]`;
const LINE_BREAK_RE = new RegExp(LINE_BREAK_SOURCE, "g");
const FIRST_LINE_BREAK_RE = new RegExp(LINE_BREAK_SOURCE);
const CURSOR_FORWARD_RE = new RegExp(`${ESC}\\[\\d*C`, "g");
// Controls left once sequences are stripped (a bell, a backspace) would sit
// in front of a banner and hide its line start.
const charRange = (from: number, to: number) =>
  `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
const STRAY_CONTROL_RE = new RegExp(
  `[${charRange(0x00, 0x08)}${charRange(0x0b, 0x1f)}${String.fromCharCode(0x7f)}]`,
  "g",
);

const toPlainLines = (raw: string): string[] =>
  stripVTControlCharacters(
    raw.replace(OSC_RE, "").replace(CURSOR_FORWARD_RE, " ").replace(LINE_BREAK_RE, "\n"),
  )
    .replace(STRAY_CONTROL_RE, "")
    .split("\n");

const matchBannerLine = (line: string): ProviderErrorMatch | null => {
  const text = line.replace(LEADING_DECORATION_RE, "").replace(/\s+/g, " ").trim();
  if (text.length === 0 || RETRY_NOTICE_RE.test(text)) {
    return null;
  }
  const rule = BANNER_RULES.find(({ pattern }) => pattern.test(text));
  return rule ? { kind: rule.kind, message: text.slice(0, MAX_MESSAGE_LENGTH) } : null;
};

const matchFirstLine = (lines: string[]): ProviderErrorMatch | null => {
  for (const line of lines) {
    const match = matchBannerLine(line);
    if (match) return match;
  }
  return null;
};

/** End offset of the last line break in raw PTY text, or -1 when there is none. */
const lastLineBreakEnd = (raw: string): number => {
  let end = -1;
  for (const match of raw.matchAll(LINE_BREAK_RE)) {
    end = match.index + match[0].length;
  }
  return end;
};

const firstLineBreakEnd = (raw: string): number => {
  const match = FIRST_LINE_BREAK_RE.exec(raw);
  return match ? match.index + match[0].length : -1;
};

export type ProviderErrorScanner = {
  /** Feeds one PTY chunk; returns the first banner on a line this chunk completed. */
  push: (chunk: string) => ProviderErrorMatch | null;
  /** Judges the unfinished last line as if it had ended. */
  flush: () => ProviderErrorMatch | null;
};

/**
 * Per-session scanner. Only the unfinished last line is carried between
 * chunks — raw, so an escape sequence split across chunks still strips — and
 * a line is judged once it ends, which keeps a banner split mid-word whole.
 */
export const createProviderErrorScanner = (): ProviderErrorScanner => {
  let pending = "";
  // The text up to the next line break continues a line already judged.
  let isMidLine = false;

  const push = (chunk: string): ProviderErrorMatch | null => {
    let text = pending + chunk;
    pending = "";
    if (isMidLine) {
      const breakEnd = firstLineBreakEnd(text);
      if (breakEnd === -1) return null;
      text = text.slice(breakEnd);
      isMidLine = false;
    }

    const breakEnd = lastLineBreakEnd(text);
    let complete = breakEnd === -1 ? "" : text.slice(0, breakEnd);
    pending = breakEnd === -1 ? text : text.slice(breakEnd);
    if (pending.length > MAX_PENDING_LENGTH) {
      complete += pending.slice(0, MAX_PENDING_LENGTH);
      pending = "";
      isMidLine = true;
    }

    if (complete.length === 0 || !BANNER_HINT_RE.test(complete)) {
      return null;
    }
    const lines = toPlainLines(complete);
    // `complete` normally ends on a break, leaving an empty last element;
    // after an overflow the last element is the truncated head, judged too.
    return matchFirstLine(isMidLine ? lines : lines.slice(0, -1));
  };

  const flush = (): ProviderErrorMatch | null => {
    const text = isMidLine ? "" : pending;
    pending = "";
    isMidLine = false;
    return BANNER_HINT_RE.test(text) ? matchFirstLine(toPlainLines(text)) : null;
  };

  return { push, flush };
};

/** Stateless check of a whole block of PTY text. */
export const detectProviderError = (text: string): ProviderErrorMatch | null => {
  const scanner = createProviderErrorScanner();
  return scanner.push(text) ?? scanner.flush();
};

export const providerErrorReason = (error: { message: string }): string =>
  `provider error: ${error.message}`;

/**
 * Stamps a detected banner onto the terminal record; returns whether anything
 * changed. The same banner repainting keeps its first time, so the registry is
 * not rewritten each frame and `at` measures how long the wall has stood.
 */
export const recordProviderError = (
  terminal: PersistedTerminal,
  match: ProviderErrorMatch,
  at: string,
): boolean => {
  const current = terminal.providerError;
  if (current && current.kind === match.kind && current.message === match.message) {
    return false;
  }
  terminal.providerError = { kind: match.kind, message: match.message, at };
  // Lifecycle stays as it is: the process is alive and may recover, and a
  // settled verdict keeps its own reason.
  if (terminal.lifecycleState === "running" || terminal.lifecycleState === "stalled") {
    terminal.lifecycleReason = providerErrorReason(match);
    terminal.lifecycleUpdatedAt = at;
  }
  return true;
};

/** Drops the error once the agent makes real progress; returns whether anything changed. */
export const clearProviderError = (terminal: PersistedTerminal): boolean => {
  const current = terminal.providerError;
  if (!current) {
    return false;
  }
  if (terminal.lifecycleReason === providerErrorReason(current)) {
    terminal.lifecycleReason = undefined;
  }
  terminal.providerError = undefined;
  return true;
};
