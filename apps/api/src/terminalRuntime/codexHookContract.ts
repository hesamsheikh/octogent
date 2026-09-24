export const OCTOGENT_CODEX_HOOK_DEFINITIONS = [
  { eventName: "SessionStart", hookPath: "session-start", timeoutSeconds: 5 },
  { eventName: "UserPromptSubmit", hookPath: "user-prompt-submit", timeoutSeconds: 5 },
  { eventName: "PreToolUse", hookPath: "pre-tool-use", timeoutSeconds: 5 },
  { eventName: "PermissionRequest", hookPath: "permission-request", timeoutSeconds: 5 },
  { eventName: "Stop", hookPath: "stop", timeoutSeconds: 15 },
] as const;

export type InstalledCodexHookHandler = {
  eventName: (typeof OCTOGENT_CODEX_HOOK_DEFINITIONS)[number]["eventName"];
  command: string;
};
