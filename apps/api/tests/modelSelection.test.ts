import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isEffortTier, resolveAgentModelSelection } from "../src/terminalRuntime/modelSelection";

describe("resolveAgentModelSelection", () => {
  it("maps effort tiers to per-provider defaults", () => {
    expect(resolveAgentModelSelection({ provider: "claude-code", effort: "light" }, {})).toEqual({
      model: "haiku",
      effortTier: "light",
    });
    expect(resolveAgentModelSelection({ provider: "claude-code", effort: "max" }, {})).toEqual({
      model: "fable",
      effortTier: "max",
    });
    expect(resolveAgentModelSelection({ provider: "codex", effort: "standard" }, {})).toEqual({
      model: "gpt-5.6-sol",
      codexReasoningEffort: "medium",
      effortTier: "standard",
    });
    // Top two Codex tiers share the strongest current model (GPT-6 Astra);
    // reasoning level separates them.
    expect(resolveAgentModelSelection({ provider: "codex", effort: "heavy" }, {})).toEqual({
      model: "gpt-6-astra",
      codexReasoningEffort: "medium",
      effortTier: "heavy",
    });
    expect(resolveAgentModelSelection({ provider: "codex", effort: "max" }, {})).toEqual({
      model: "gpt-6-astra",
      codexReasoningEffort: "xhigh",
      effortTier: "max",
    });
  });

  it("lets an explicit model win over the effort tier", () => {
    expect(
      resolveAgentModelSelection({ provider: "claude-code", model: "opus", effort: "light" }, {}),
    ).toEqual({ model: "opus", effortTier: "light" });
  });

  it("returns null when neither model nor effort is requested", () => {
    expect(resolveAgentModelSelection({ provider: "claude-code" }, {})).toBeNull();
  });

  it("honors the OCTOGENT_EFFORT_MODELS env override", () => {
    const env = {
      OCTOGENT_EFFORT_MODELS: JSON.stringify({
        light: { "claude-code": "haiku-4-5", codex: "gpt-5.3-codex-spark@low" },
      }),
    };
    expect(resolveAgentModelSelection({ provider: "claude-code", effort: "light" }, env)).toEqual({
      model: "haiku-4-5",
      effortTier: "light",
    });
    expect(resolveAgentModelSelection({ provider: "codex", effort: "light" }, env)).toEqual({
      model: "gpt-5.3-codex-spark",
      codexReasoningEffort: "low",
      effortTier: "light",
    });
    // Tiers absent from the override keep their defaults.
    expect(
      resolveAgentModelSelection({ provider: "claude-code", effort: "standard" }, env),
    ).toEqual({ model: "sonnet", effortTier: "standard" });
  });

  it("ignores an unparseable override instead of failing terminal creation", () => {
    expect(
      resolveAgentModelSelection(
        { provider: "claude-code", effort: "light" },
        { OCTOGENT_EFFORT_MODELS: "{not json" },
      ),
    ).toEqual({ model: "haiku", effortTier: "light" });
  });

  it("rejects model names that could not be shell-safe", () => {
    expect(
      resolveAgentModelSelection({ provider: "claude-code", model: 'x"; rm -rf /' }, {}),
    ).toBeNull();
    expect(
      resolveAgentModelSelection(
        { provider: "codex", effort: "light" },
        { OCTOGENT_EFFORT_MODELS: JSON.stringify({ light: { codex: "bad model@$(boom)" } }) },
      ),
    ).toBeNull();
  });
});

describe("codex tier fallback by account model list", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // Points OCTOGENT_CODEX_CONFIG at a throwaway Codex home whose models cache
  // lists exactly these slugs.
  const codexHomeListing = (slugs: string[]) => {
    const home = mkdtempSync(join(tmpdir(), "octogent-codex-home-"));
    tempDirs.push(home);
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "models_cache.json"),
      JSON.stringify({ models: slugs.map((slug) => ({ slug, visibility: "list" })) }),
    );
    return { OCTOGENT_CODEX_CONFIG: join(home, "config.toml") };
  };

  it("uses GPT-6 Astra when the account lists it", () => {
    const env = codexHomeListing(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-luna"]);
    expect(resolveAgentModelSelection({ provider: "codex", effort: "heavy" }, env)).toMatchObject({
      model: "gpt-6-astra",
      codexReasoningEffort: "medium",
    });
    expect(resolveAgentModelSelection({ provider: "codex", effort: "max" }, env)).toMatchObject({
      model: "gpt-6-astra",
      codexReasoningEffort: "xhigh",
    });
  });

  it("falls back to the 5.6 generation on an account that cannot see GPT-6 yet", () => {
    // Our second machine's cache on 2026-09-08 had no gpt-6-astra entry.
    const env = codexHomeListing(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]);
    expect(resolveAgentModelSelection({ provider: "codex", effort: "heavy" }, env)).toMatchObject({
      model: "gpt-5.6-sol",
      codexReasoningEffort: "high",
    });
    expect(resolveAgentModelSelection({ provider: "codex", effort: "max" }, env)).toMatchObject({
      model: "gpt-5.6-sol",
      codexReasoningEffort: "xhigh",
    });
    expect(
      resolveAgentModelSelection({ provider: "codex", effort: "standard" }, env),
    ).toMatchObject({ model: "gpt-5.6-sol", codexReasoningEffort: "medium" });
  });

  it("takes the first candidate on faith when there is no readable cache", () => {
    const env = { OCTOGENT_CODEX_CONFIG: "/nonexistent/codex/config.toml" };
    expect(resolveAgentModelSelection({ provider: "codex", effort: "heavy" }, env)).toMatchObject({
      model: "gpt-6-astra",
    });
  });

  it("lets an override list fall back the same way", () => {
    const env = {
      ...codexHomeListing(["gpt-5.6-luna"]),
      OCTOGENT_EFFORT_MODELS: JSON.stringify({
        heavy: { codex: ["gpt-6-astra@max", "gpt-5.6-luna@high"] },
      }),
    };
    expect(resolveAgentModelSelection({ provider: "codex", effort: "heavy" }, env)).toMatchObject({
      model: "gpt-5.6-luna",
      codexReasoningEffort: "high",
    });
  });
});

describe("isEffortTier", () => {
  it("accepts the four tiers and nothing else", () => {
    for (const tier of ["light", "standard", "heavy", "max"]) {
      expect(isEffortTier(tier), tier).toBe(true);
    }
    expect(isEffortTier("ultra")).toBe(false);
    expect(isEffortTier("")).toBe(false);
  });
});
