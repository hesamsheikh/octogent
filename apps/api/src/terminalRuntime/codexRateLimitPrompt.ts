import { stripVTControlCharacters } from "node:util";

/**
 * Codex's "Approaching rate limits — Switch to <cheaper model>?" prompt.
 *
 * It appears after a turn ends once the account nears its usage limit, no hook
 * reports it, and its default choice is "switch". Whatever Octogent pastes next
 * — a channel follow-up, a retried prompt — lands in the prompt instead of the
 * agent: on 2026-09-21 a review message was swallowed this way and the worker
 * was silently moved from gpt-6-astra to gpt-5.6-luna. An unattended worker
 * should keep the model its operator chose; the real limit, when it comes, is
 * reported through provider-error detection.
 */

export type CodexRateLimitPromptPolicy = "keep" | "switch" | "ask";

export const resolveCodexRateLimitPromptPolicy = (
  rawValue: string | undefined,
): CodexRateLimitPromptPolicy => {
  const value = rawValue?.trim().toLowerCase();
  return value === "switch" || value === "ask" ? value : "keep";
};

// Down moves from "1. Switch" to "2. Keep current model"; Enter confirms.
// Option 3 ("never show again") would edit the operator's Codex config.
export const CODEX_RATE_LIMIT_PROMPT_ANSWERS: Readonly<
  Record<Exclude<CodexRateLimitPromptPolicy, "ask">, string>
> = {
  keep: "\u001b[B\r",
  switch: "\r",
};

const ESC = "\u001b";
// The TUI paints each row by cursor address, never with a newline.
const ROW_MOVE_RE = new RegExp(`${ESC}\\[[0-9;]*[Hf]`, "g");
const HEADLINE_RE = /Approaching rate limits/;
const QUESTION_RE = /Switch to (\S+) for lower credit usage\?/;
const KEEP_OPTION_RE = /2\. Keep current model/;
// Enough to hold the whole prompt when it arrives split across chunks.
const MAX_TAIL_LENGTH = 4_096;

export type CodexRateLimitPrompt = { suggestedModel: string };

export type CodexRateLimitPromptScanner = {
  /** Feeds raw PTY output; returns the prompt the first time it is fully on screen. */
  push: (chunk: string) => CodexRateLimitPrompt | null;
  /** Call after answering so the same paint is not answered twice. */
  reset: () => void;
};

export const createCodexRateLimitPromptScanner = (): CodexRateLimitPromptScanner => {
  let tail = "";
  let reported = false;
  return {
    push(chunk) {
      tail = `${tail}${chunk}`.slice(-MAX_TAIL_LENGTH);
      if (reported) {
        return null;
      }
      const plain = stripVTControlCharacters(tail.replace(ROW_MOVE_RE, "\n"));
      const question = plain.match(QUESTION_RE);
      // All three parts must be there: answering a half-painted prompt would
      // send the keys to whatever is on screen instead.
      if (!question || !HEADLINE_RE.test(plain) || !KEEP_OPTION_RE.test(plain)) {
        return null;
      }
      reported = true;
      return { suggestedModel: question[1] ?? "" };
    },
    reset() {
      tail = "";
      reported = false;
    },
  };
};
