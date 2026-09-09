import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// Octogent is often launched from inside a Claude Code session, and these
// markers would make every spawned agent present itself as a child session —
// Claude then turns transcript saving off, which starves the Stop-hook
// pipeline that state detection and completion reporting depend on. Only the
// known-harmful markers are scrubbed; deliberate CLAUDE_CODE_* overrides the
// operator exports stay intact.
const INHERITED_SESSION_MARKERS = new Set(["CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE"]);

export const createShellEnvironment = (options?: {
  octogentSessionId?: string;
  apiBaseUrl?: string;
}) => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !INHERITED_SESSION_MARKERS.has(key)) {
      env[key] = value;
    }
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  if (options?.octogentSessionId) {
    env.OCTOGENT_SESSION_ID = options.octogentSessionId;
  }
  if (options?.apiBaseUrl) {
    // The shared user-level Codex hooks match on this so that with several
    // Octogent instances on one machine, each event only reaches the instance
    // that owns the session (terminal ids repeat across instances).
    env.OCTOGENT_API_BASE = options.apiBaseUrl;
  }
  return env;
};

export const ensureNodePtySpawnHelperExecutable = () => {
  if (process.platform === "win32") {
    return;
  }

  try {
    const packageJsonPath = require.resolve("node-pty/package.json");
    const packageDir = dirname(packageJsonPath);
    const helperCandidates = [
      join(packageDir, "build", "Release", "spawn-helper"),
      join(packageDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    ];

    for (const helperPath of helperCandidates) {
      if (!existsSync(helperPath)) {
        continue;
      }

      const currentMode = statSync(helperPath).mode;
      if ((currentMode & 0o111) !== 0) {
        continue;
      }

      chmodSync(helperPath, currentMode | 0o755);
    }
  } catch {
    // Let node-pty throw the actionable error if helper lookup/setup fails.
  }
};
