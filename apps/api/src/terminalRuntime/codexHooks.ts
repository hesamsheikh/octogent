import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveCodexConfigPath } from "../codexTrust";
import {
  type InstalledCodexHookHandler,
  OCTOGENT_CODEX_HOOK_DEFINITIONS,
} from "./codexHookContract";
import { mergeHookEntries, parseSettingsObject } from "./hookSettingsMerge";

export type { InstalledCodexHookHandler } from "./codexHookContract";

/**
 * Codex feeds hook stdout back to the model as developer context, so unlike
 * the Claude hooks the API's JSON reply must be discarded with -o /dev/null.
 * Codex command hooks run through a shell, which is what makes the guard, the
 * env var expansion, and the stdin piping here work. The leading guards make
 * the hook a no-op in Codex sessions that Octogent did not launch, and — with
 * several Octogent instances sharing this user-level file — in sessions owned
 * by a different instance (terminal ids repeat across instances, so a
 * cross-instance post could hit a colliding session).
 */
const codexHookCommand = (apiBaseUrl: string, hookPath: string): string =>
  `[ -n "$OCTOGENT_SESSION_ID" ] && [ "$OCTOGENT_API_BASE" = "${apiBaseUrl}" ] && curl -s -o /dev/null -X POST "${apiBaseUrl}/api/hooks/${hookPath}?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`;

const codexHookEntry = (command: string, timeoutSeconds: number) => ({
  hooks: [
    {
      type: "command",
      command,
      timeout: timeoutSeconds,
    },
  ],
});

/** Where the runtime hooks live: next to the Codex config, in the user layer. */
export const resolveCodexHooksPath = (env: NodeJS.ProcessEnv = process.env): string =>
  join(dirname(resolveCodexConfigPath(env)), "hooks.json");

/**
 * Writes the Octogent runtime hooks into `$CODEX_HOME/hooks.json`.
 *
 * The user layer is deliberate: Codex resolves a git worktree's project to the
 * primary repo, and (verified live) its TUI does not load project-layer
 * .codex/hooks.json from worktree sessions at all — the user layer is the only
 * layer that fires everywhere. The event set mirrors the Claude install where
 * Codex offers an equivalent; PermissionRequest replaces Claude's
 * Notification-based permission detection. Codex only runs a hook definition
 * after its hash is trusted — see codexTrust, which must run after this.
 */
export const installCodexHooks = (
  apiBaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): InstalledCodexHookHandler[] => {
  const targetHooksPath = resolveCodexHooksPath(env);

  const hooksConfig: Record<string, unknown[]> = {};
  const installedHandlers: InstalledCodexHookHandler[] = [];
  for (const { eventName, hookPath, timeoutSeconds } of OCTOGENT_CODEX_HOOK_DEFINITIONS) {
    const command = codexHookCommand(apiBaseUrl, hookPath);
    hooksConfig[eventName] = [codexHookEntry(command, timeoutSeconds)];
    installedHandlers.push({ eventName, command });
  }

  try {
    mkdirSync(dirname(targetHooksPath), { recursive: true });
    const existingSettings = existsSync(targetHooksPath)
      ? parseSettingsObject(readFileSync(targetHooksPath, "utf8"))
      : null;
    const mergedSettings = existingSettings ? { ...existingSettings } : {};

    let mergedHooks =
      mergedSettings.hooks &&
      typeof mergedSettings.hooks === "object" &&
      !Array.isArray(mergedSettings.hooks)
        ? { ...(mergedSettings.hooks as Record<string, unknown>) }
        : {};

    for (const [eventName, eventEntries] of Object.entries(hooksConfig)) {
      mergedHooks = mergeHookEntries(mergedHooks, eventName, eventEntries);
    }

    mergedSettings.hooks = mergedHooks;
    writeFileSync(targetHooksPath, `${JSON.stringify(mergedSettings, null, 2)}\n`, "utf8");
    return installedHandlers;
  } catch {
    // Best-effort: hook installation should not block terminal creation.
    return [];
  }
};
