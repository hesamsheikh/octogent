import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { TerminalAgentProvider } from "@octogent/core";

import { resolveCodexConfigPath } from "../codexTrust";

/**
 * Difficulty tiers for dispatching a task without naming a model. The mapping
 * encodes the metering reality: within Claude the weekly pool is shared but
 * burn rates differ widely per model, and Fable additionally has its own
 * scarce weekly cap, so tiers exist to spend the pool where it matters.
 */
export type EffortTier = "light" | "standard" | "heavy" | "max";

const EFFORT_TIERS: readonly EffortTier[] = ["light", "standard", "heavy", "max"];

export const isEffortTier = (value: unknown): value is EffortTier =>
  typeof value === "string" && (EFFORT_TIERS as readonly string[]).includes(value);

/**
 * Codex entries pack the reasoning effort as `model@effort`. A list means
 * candidates in preference order: the first one the local Codex account can
 * actually see (per its models cache) wins.
 */
type EffortModelEntry = string | string[];
type EffortModelMap = Partial<
  Record<EffortTier, Partial<Record<TerminalAgentProvider, EffortModelEntry>>>
>;

// Claude entries are family aliases so they track each new generation without
// a code change (as of 2026-09-23: haiku → Haiku 4.5, sonnet → Sonnet 5,
// opus → Opus 5.5, fable → Fable 5.1). Anthropic now positions Opus 5.5 as the
// everyday execution model and Fable as the one for planning and for work whose
// result matters more than its price, which is how the heavy / max tiers were
// already split. Codex has no aliases, so its entries follow the models_cache
// of 2026-09-23, when the GPT-6 generation filled in below Astra: Luna is the
// cheap tier (run at its default reasoning level — at `low` the small models
// start making factual mistakes), Sol is the execution workhorse (OpenAI's own
// guidance: execute on Sol xhigh or Astra high, plan on Astra), Astra stays the
// strongest and the most quota-hungry, so only the two upper tiers touch it.
// The 5.6 generation remains as fallback for accounts the rollout has not
// reached yet: each Codex tier is a preference list and the first slug the
// account's models cache lists wins. gpt-5.5 (previous generation) and the
// hidden gpt-reserve are not used. Codex's `max` / `ultra` levels are left
// out of the defaults — `ultra` spawns its own sub-agents, which fights
// Octogent's orchestration; both remain reachable via OCTOGENT_EFFORT_MODELS.
const DEFAULT_EFFORT_MODELS: EffortModelMap = {
  light: { "claude-code": "haiku", codex: ["gpt-6-luna@medium", "gpt-5.6-luna@medium"] },
  standard: {
    "claude-code": "sonnet",
    codex: ["gpt-6-sol@high", "gpt-5.6-sol@medium", "gpt-5.6-terra@medium"],
  },
  heavy: {
    "claude-code": "opus",
    codex: ["gpt-6-astra@high", "gpt-6-sol@xhigh", "gpt-5.6-sol@high"],
  },
  max: {
    "claude-code": "fable",
    codex: ["gpt-6-astra@xhigh", "gpt-6-sol@xhigh", "gpt-5.6-sol@xhigh"],
  },
};

/**
 * The default mapping as one line per tier (`light = haiku / gpt-6-luna@medium
 * (fallback gpt-5.6-luna@medium)`), for `octogent guide` and the docs, so the
 * text people read never drifts from what terminal create does.
 */
export const describeEffortTierDefaults = (): string[] =>
  EFFORT_TIERS.map((tier) => {
    const claude = DEFAULT_EFFORT_MODELS[tier]?.["claude-code"];
    const codex = DEFAULT_EFFORT_MODELS[tier]?.codex;
    const codexList = typeof codex === "string" ? [codex] : (codex ?? []);
    const [first, ...rest] = codexList;
    const codexText = rest.length > 0 ? `${first} (fallback ${rest.join(", ")})` : (first ?? "-");
    return `${tier} = ${typeof claude === "string" ? claude : "-"} / ${codexText}`;
  });

// These strings end up inside the PTY bootstrap command line, so only accept
// plain identifier-shaped values.
const MODEL_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const isValidModelToken = (value: unknown): value is string =>
  typeof value === "string" && MODEL_TOKEN_RE.test(value);

export type ResolvedAgentModel = {
  model: string;
  codexReasoningEffort?: string;
  effortTier?: EffortTier;
};

type ModelSelectionEnv = {
  OCTOGENT_EFFORT_MODELS?: string;
  OCTOGENT_CODEX_CONFIG?: string;
  CODEX_HOME?: string;
};

/**
 * Model slugs the local Codex account can use, from the cache the Codex CLI
 * keeps next to its config. `null` when there is no readable cache — then the
 * first candidate is taken on faith.
 */
export const readCodexListedModels = (env: ModelSelectionEnv): Set<string> | null => {
  const cachePath = join(
    dirname(resolveCodexConfigPath(env as NodeJS.ProcessEnv)),
    "models_cache.json",
  );
  if (!existsSync(cachePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as { models?: unknown };
    if (!Array.isArray(parsed.models)) {
      return null;
    }
    const slugs = new Set<string>();
    for (const model of parsed.models) {
      const slug = (model as { slug?: unknown }).slug;
      if (typeof slug === "string") slugs.add(slug);
    }
    return slugs;
  } catch {
    return null;
  }
};

const pickCandidate = (
  entry: EffortModelEntry,
  provider: TerminalAgentProvider,
  env: ModelSelectionEnv,
): string | undefined => {
  if (typeof entry === "string") {
    return entry;
  }
  const candidates = entry.filter((value) => typeof value === "string");
  if (candidates.length === 0) {
    return undefined;
  }
  if (provider !== "codex") {
    return candidates[0];
  }
  const listed = readCodexListedModels(env);
  if (!listed) {
    return candidates[0];
  }
  return (
    candidates.find((candidate) => listed.has(candidate.split("@", 1)[0] ?? "")) ?? candidates[0]
  );
};

const readEffortModelOverrides = (env: ModelSelectionEnv): EffortModelMap => {
  const raw = env.OCTOGENT_EFFORT_MODELS?.trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as EffortModelMap;
  } catch {
    // A broken override must not block terminal creation.
    return {};
  }
};

const unpackModelEntry = (
  entry: string,
  provider: TerminalAgentProvider,
): Omit<ResolvedAgentModel, "effortTier"> | null => {
  const [model, packedEffort] = provider === "codex" ? entry.split("@", 2) : [entry, undefined];
  if (!model || !MODEL_TOKEN_RE.test(model)) {
    return null;
  }
  if (packedEffort !== undefined && !MODEL_TOKEN_RE.test(packedEffort)) {
    return null;
  }
  return { model, ...(packedEffort ? { codexReasoningEffort: packedEffort } : {}) };
};

/**
 * Resolves what the terminal should run with: an explicit model wins, an
 * effort tier falls back to the (env-overridable) mapping, and neither means
 * the provider keeps its own default. Returns null for "nothing requested" and
 * also for values that fail validation — creation then proceeds without a
 * model rather than launching a broken or unsafe command.
 */
export const resolveAgentModelSelection = (
  input: { provider: TerminalAgentProvider; model?: string; effort?: EffortTier },
  env: ModelSelectionEnv = process.env,
): ResolvedAgentModel | null => {
  if (input.model !== undefined) {
    if (!MODEL_TOKEN_RE.test(input.model)) {
      return null;
    }
    return { model: input.model, ...(input.effort ? { effortTier: input.effort } : {}) };
  }

  if (!input.effort) {
    return null;
  }

  const overrides = readEffortModelOverrides(env);
  const configured =
    overrides[input.effort]?.[input.provider] ??
    DEFAULT_EFFORT_MODELS[input.effort]?.[input.provider];
  const entry = configured ? pickCandidate(configured, input.provider, env) : undefined;
  if (!entry) {
    return null;
  }
  const unpacked = unpackModelEntry(entry, input.provider);
  return unpacked ? { ...unpacked, effortTier: input.effort } : null;
};
