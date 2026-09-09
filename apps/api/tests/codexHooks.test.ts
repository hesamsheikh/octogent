import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installCodexHooks, resolveCodexHooksPath } from "../src/terminalRuntime/codexHooks";

const API_BASE_URL = "http://127.0.0.1:8787";

const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "Stop",
] as const;

describe("installCodexHooks", () => {
  let codexHomeDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    codexHomeDir = mkdtempSync(join(tmpdir(), "octogent-codex-hooks-"));
    env = { OCTOGENT_CODEX_CONFIG: join(codexHomeDir, "config.toml") };
  });

  afterEach(() => {
    rmSync(codexHomeDir, { recursive: true, force: true });
  });

  const hooksPath = () => join(codexHomeDir, "hooks.json");

  const readHooksFile = (): Record<string, unknown> =>
    JSON.parse(readFileSync(hooksPath(), "utf8")) as Record<string, unknown>;

  it("writes the user-layer hooks.json next to the Codex config", () => {
    expect(resolveCodexHooksPath(env)).toBe(hooksPath());
    const installedHandlers = installCodexHooks(API_BASE_URL, env);

    const parsed = readHooksFile();
    const hooks = parsed.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    for (const eventName of CODEX_HOOK_EVENTS) {
      expect(hooks[eventName], eventName).toHaveLength(1);
    }
    expect(installedHandlers).toEqual(
      CODEX_HOOK_EVENTS.map((eventName) => ({
        eventName,
        command: hooks[eventName]?.[0]?.hooks[0]?.command,
      })),
    );
  });

  it("posts the stdin payload to the API and identifies the session via query param", () => {
    installCodexHooks(API_BASE_URL, env);

    const contents = readFileSync(hooksPath(), "utf8");
    expect(contents).toContain(`${API_BASE_URL}/api/hooks/permission-request`);
    expect(contents).toContain("octogent_session=$OCTOGENT_SESSION_ID");
    expect(contents).toContain("-d @-");
  });

  it("guards every hook so non-Octogent Codex sessions are untouched", () => {
    // These hooks load for every session of the user's Codex, so they must be
    // inert unless Octogent's PTY set the session marker.
    installCodexHooks(API_BASE_URL, env);

    const parsed = readHooksFile();
    const hooks = parsed.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    for (const eventName of CODEX_HOOK_EVENTS) {
      for (const entry of hooks[eventName] ?? []) {
        for (const hook of entry.hooks) {
          expect(hook.command, eventName).toContain('[ -n "$OCTOGENT_SESSION_ID" ] &&');
          expect(hook.command, eventName).toContain("-o /dev/null");
        }
      }
    }
  });

  it("preserves hooks an operator added themselves and stays idempotent", () => {
    installCodexHooks(API_BASE_URL, env);

    const parsed = readHooksFile();
    const hooks = parsed.hooks as Record<string, unknown[]>;
    hooks.SessionEnd = [{ hooks: [{ type: "command", command: "echo bye", timeout: 3 }] }];
    writeFileSync(hooksPath(), JSON.stringify(parsed), "utf8");

    installCodexHooks(API_BASE_URL, env);

    const merged = readHooksFile();
    const mergedHooks = merged.hooks as Record<string, unknown[]>;
    expect(mergedHooks.SessionEnd).toHaveLength(1);
    expect(mergedHooks.Stop, "re-install must not duplicate entries").toHaveLength(1);
  });

  it("replaces an unparseable hooks.json instead of failing the install", () => {
    installCodexHooks(API_BASE_URL, env);
    writeFileSync(hooksPath(), "{not json", "utf8");

    installCodexHooks(API_BASE_URL, env);

    const parsed = readHooksFile();
    const hooks = parsed.hooks as Record<string, unknown[]>;
    expect(hooks.Stop).toHaveLength(1);
  });
});
