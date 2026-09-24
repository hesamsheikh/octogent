import type { WorkspaceSetupStep } from "@octogent/core";

type Translate = (key: string, params?: Record<string, string | number>) => string;

const KEY_PREFIX = "web.deck.workspaceSetup.step";

// t() marks an absent key rather than throwing, so an unknown step still renders
// the server copy instead of leaking a raw key into the card.
const translateOrFallback = (t: Translate, key: string, fallback: string): string => {
  const translated = t(key);
  return translated.startsWith("MISSING:") ? fallback : translated;
};

/**
 * Display copy for a setup step.
 *
 * The API serves English step text for CLI and API consumers; the step id is the
 * stable contract, so the operator-facing wording is resolved here in the
 * presentation layer and follows the UI language switch without a server restart.
 */
export const resolveSetupStepCopy = (step: WorkspaceSetupStep, t: Translate) => ({
  title: translateOrFallback(t, `${KEY_PREFIX}.${step.id}.title`, step.title),
  description: translateOrFallback(t, `${KEY_PREFIX}.${step.id}.desc`, step.description),
  actionLabel:
    step.actionLabel === null
      ? null
      : translateOrFallback(t, `${KEY_PREFIX}.${step.id}.action`, step.actionLabel),
});
