import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { logVerbose } from "../logging";
import { type ParsedEnvFile, parseEnvFile, renderProjectEnvTemplate } from "./projectEnv";

const require = createRequire(import.meta.url);

// Octogent is often launched from inside a Claude Code session, and these
// markers would make every spawned agent present itself as a child session —
// Claude then turns transcript saving off, which starves the Stop-hook
// pipeline that state detection and completion reporting depend on. Only the
// known-harmful markers are scrubbed; deliberate CLAUDE_CODE_* overrides the
// operator exports stay intact.
const INHERITED_SESSION_MARKERS = new Set(["CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE"]);
// A worker's CLI and hooks must address the server that spawned it, which sets
// OCTOGENT_API_BASE explicitly below. A server started from inside a hub
// worker (or a dev shell exporting OCTOGENT_API_ORIGIN) would otherwise hand
// its own project id or the hub root to its agents instead.
const SERVER_OWNED_VARIABLES = new Set(["OCTOGENT_PROJECT_ID", "OCTOGENT_API_ORIGIN"]);

// Workers used to inherit whatever shell started the server — its virtualenv,
// its secrets, its session markers. With one server serving many projects that
// leaks one project's setup into another's workers, so only what a login shell
// and the agent CLIs need is carried over; projects add the rest through
// `.octogent/env` and callers through `--inherit-env`.
const BASELINE_NAMES = new Set([
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TZ",
  "PATH",
  "TMPDIR",
  "SSH_AUTH_SOCK",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "DBUS_SESSION_BUS_ADDRESS",
  // Claude Code reads its credentials and settings from here when set.
  "CLAUDE_CONFIG_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  // Behind a TLS-inspecting proxy the agents need its CA as much as its address.
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);
const BASELINE_PREFIXES = [
  "LC_",
  "XDG_",
  "ANTHROPIC_",
  "CLAUDE_CODE_",
  "CODEX_",
  "OPENAI_",
  "OCTOGENT_",
  "NODE_",
  "NVM_",
];

const PROJECT_ENV_FILE_SEGMENTS = [".octogent", "env"] as const;
const VENV_DIRECTORY_CANDIDATES = [".venv", "venv"] as const;

const isBaselineName = (key: string) =>
  BASELINE_NAMES.has(key) || BASELINE_PREFIXES.some((prefix) => key.startsWith(prefix));

/**
 * The environment every worker starts from: the baseline subset of `source`,
 * or all of it with `OCTOGENT_PTY_ENV_MODE=inherit` (the pre-baseline
 * behavior, kept as an escape hatch). Session markers are never included.
 */
export const createBaseEnvironment = (source: NodeJS.ProcessEnv = process.env) => {
  const inheritAll = source.OCTOGENT_PTY_ENV_MODE?.trim() === "inherit";
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value === "string" &&
      !INHERITED_SESSION_MARKERS.has(key) &&
      (inheritAll || isBaselineName(key))
    ) {
      env[key] = value;
    }
  }
  // Dropping VIRTUAL_ENV is not enough: an activated virtualenv also puts its
  // bin directory first on PATH, and that is what actually routes `python` to
  // project A's interpreter inside project B's workers. Projects opt back in
  // through `.octogent/env`.
  if (!inheritAll && typeof source.VIRTUAL_ENV === "string" && env.PATH) {
    const venvBin = join(source.VIRTUAL_ENV, "bin");
    env.PATH = env.PATH.split(":")
      .filter((entry) => entry !== venvBin && entry !== `${venvBin}/`)
      .join(":");
  }
  return env;
};

/**
 * Reads `<workspaceCwd>/.octogent/env`, expanding against `base` with `PWD`
 * set to the workspace (worktree terminals run elsewhere, but the project's
 * virtualenv lives in the main checkout). A missing file is not an issue; an
 * unreadable one is reported as line 0 so session start never fails on it.
 */
export const loadProjectEnvironment = (
  workspaceCwd: string,
  base: Record<string, string> = createBaseEnvironment(),
): ParsedEnvFile => {
  const path = join(workspaceCwd, ...PROJECT_ENV_FILE_SEGMENTS);
  if (!existsSync(path)) {
    return { env: {}, issues: [] };
  }

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { env: {}, issues: [{ line: 0, reason: `cannot read ${path}: ${reason}` }] };
  }
  return parseEnvFile(text, { ...base, PWD: workspaceCwd });
};

/** Writes the starter `.octogent/env` unless the project already has one. */
export const ensureProjectEnvTemplate = (workspaceCwd: string) => {
  const venvDirectory =
    VENV_DIRECTORY_CANDIDATES.find((candidate) =>
      existsSync(join(workspaceCwd, candidate, "bin", "activate")),
    ) ?? null;
  const path = join(workspaceCwd, ...PROJECT_ENV_FILE_SEGMENTS);
  if (existsSync(path)) {
    return { written: false, venvDirectory };
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    // `wx` keeps a file created between the check and the write intact.
    writeFileSync(path, renderProjectEnvTemplate(venvDirectory), { flag: "wx" });
  } catch {
    return { written: false, venvDirectory };
  }
  return { written: true, venvDirectory };
};

/**
 * Applies, in order: the base environment, the project's `.octogent/env`
 * (re-read on every call, so edits reach the next session without a restart),
 * the variables the creating caller passed along, then Octogent's own
 * settings — so neither a project file nor a caller can point a worker's hooks
 * at a different server or session.
 */
export const createShellEnvironment = (options?: {
  octogentSessionId?: string;
  apiBaseUrl?: string;
  projectId?: string;
  workspaceCwd?: string;
  inheritedEnv?: Record<string, string>;
  sourceEnv?: NodeJS.ProcessEnv;
}) => {
  const base = createBaseEnvironment(options?.sourceEnv);
  const project = options?.workspaceCwd
    ? loadProjectEnvironment(options.workspaceCwd, base)
    : { env: {}, issues: [] };
  if (project.issues.length > 0) {
    const details = project.issues
      .map((issue) => (issue.line > 0 ? `line ${issue.line}: ${issue.reason}` : issue.reason))
      .join("; ");
    logVerbose(
      `[Session] .octogent/env skipped ${project.issues.length} line(s) session=${options?.octogentSessionId ?? "-"}: ${details}`,
    );
  }

  const env: Record<string, string> = {
    ...base,
    ...project.env,
    ...options?.inheritedEnv,
  };
  for (const marker of [...INHERITED_SESSION_MARKERS, ...SERVER_OWNED_VARIABLES]) {
    delete env[marker];
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
  if (options?.projectId) {
    // Under the hub the base already names the project; the id is spelled out
    // so a CLI in the worker can say which project it acts on.
    env.OCTOGENT_PROJECT_ID = options.projectId;
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
