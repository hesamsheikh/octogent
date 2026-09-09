export const TERMINAL_ID_PREFIX = "terminal-";
export const TERMINAL_REGISTRY_VERSION = 3;
export const TERMINAL_REGISTRY_RELATIVE_PATH = ".octogent/state/tentacles.json";
export const TERMINAL_TRANSCRIPT_RELATIVE_PATH = ".octogent/state/transcripts";
export const TENTACLE_WORKTREE_RELATIVE_PATH = ".octogent/worktrees";
export const TENTACLE_WORKTREE_BRANCH_PREFIX = "octogent/";
export const DEFAULT_AGENT_PROVIDER = "claude-code" as const;

export const TERMINAL_BOOTSTRAP_COMMANDS: Record<string, string> = {
  codex: "codex",
  "claude-code": "claude",
};
export const TERMINAL_SESSION_IDLE_GRACE_MS = 5 * 60 * 1000;
export const TERMINAL_SCROLLBACK_MAX_BYTES = 512 * 1024;
export const TERMINAL_MAX_CONCURRENT_SESSIONS = 32;
export const DEFAULT_TERMINAL_INACTIVITY_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

// Bracketed paste markers plus the delayed Enter used when injecting text into
// an agent TUI: pasting and submitting in one write can swallow the Enter, so
// injection writes the paste first and submits after this delay.
export const AGENT_PASTE_START = "\x1b[200~";
export const AGENT_PASTE_END = "\x1b[201~";
export const AGENT_INJECT_SUBMIT_DELAY_MS = 150;
