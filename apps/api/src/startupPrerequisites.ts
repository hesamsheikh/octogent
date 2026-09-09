import { execFileSync } from "node:child_process";
import { DEFAULT_LOCALE, type Locale, t } from "@octogent/core";

export type StartupPrerequisiteSeverity = "error" | "warning";

export type StartupPrerequisiteIssue = {
  command: string;
  severity: StartupPrerequisiteSeverity;
  summary: string;
  guidance: string;
};

export type StartupPrerequisiteAvailability = Record<
  "claude" | "codex" | "git" | "gh" | "curl",
  boolean
>;

export type StartupPrerequisiteReport = {
  availability: StartupPrerequisiteAvailability;
  errors: StartupPrerequisiteIssue[];
  warnings: StartupPrerequisiteIssue[];
};

type CommandAvailabilityChecker = (command: string) => boolean;

type CommandAvailabilityOptions = {
  platform?: NodeJS.Platform;
  execFileSyncImpl?: typeof execFileSync;
};

const resolveLookupCommand = (platform: NodeJS.Platform) =>
  platform === "win32"
    ? { file: "where", args: [] as string[] }
    : { file: "which", args: [] as string[] };

export const isCommandAvailable = (
  command: string,
  options: CommandAvailabilityOptions = {},
): boolean => {
  const lookup = resolveLookupCommand(options.platform ?? process.platform);

  try {
    (options.execFileSyncImpl ?? execFileSync)(lookup.file, [...lookup.args, command], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

export const collectStartupPrerequisiteReport = (
  isAvailable: CommandAvailabilityChecker = (command) => isCommandAvailable(command),
): StartupPrerequisiteReport => {
  const availability: StartupPrerequisiteAvailability = {
    claude: isAvailable("claude"),
    codex: isAvailable("codex"),
    git: isAvailable("git"),
    gh: isAvailable("gh"),
    curl: isAvailable("curl"),
  };

  const errors: StartupPrerequisiteIssue[] = [];
  const warnings: StartupPrerequisiteIssue[] = [];

  if (!availability.claude && !availability.codex) {
    errors.push({
      command: "claude/codex",
      severity: "error",
      summary: "Neither `claude` nor `codex` is installed.",
      guidance:
        "Install at least one agent CLI before starting Octogent. Claude-backed terminals use `claude`; Codex-backed terminals use `codex`.",
    });
  } else {
    if (!availability.claude) {
      warnings.push({
        command: "claude",
        severity: "warning",
        summary: "`claude` is not installed.",
        guidance:
          "Claude-backed terminals are unavailable. Install Claude Code and run `claude login` if you want the default Claude provider.",
      });
    }

    if (!availability.codex) {
      warnings.push({
        command: "codex",
        severity: "warning",
        summary: "`codex` is not installed.",
        guidance:
          "Codex-backed terminals and Codex usage telemetry are unavailable. Install Codex CLI and run `codex login` if you want Codex terminals.",
      });
    }
  }

  if (!availability.git) {
    warnings.push({
      command: "git",
      severity: "warning",
      summary: "`git` is not installed.",
      guidance:
        "Worktree terminals and git lifecycle actions are unavailable. Install Git to enable branch/worktree flows.",
    });
  }

  if (!availability.gh) {
    warnings.push({
      command: "gh",
      severity: "warning",
      summary: "`gh` is not installed.",
      guidance:
        "GitHub pull request features are unavailable. Install GitHub CLI and run `gh auth login` to enable PR actions.",
    });
  }

  if (!availability.curl) {
    warnings.push({
      command: "curl",
      severity: "warning",
      summary: "`curl` is not installed.",
      guidance:
        "Claude hook command callbacks for SessionStart, UserPromptSubmit, and Stop are unavailable. Install curl to restore full Claude hook delivery.",
    });
  }

  return { availability, errors, warnings };
};

export const formatStartupPrerequisiteReport = (
  report: StartupPrerequisiteReport,
  locale: Locale = DEFAULT_LOCALE,
): string[] => {
  if (report.errors.length === 0 && report.warnings.length === 0) {
    return [];
  }

  const lines = [t(locale, "startup.preflight")];

  for (const issue of report.errors) {
    lines.push(t(locale, "startup.preflightError", { message: issue.summary }));
    lines.push(t(locale, "startup.preflightGuidance", { guidance: issue.guidance }));
  }

  for (const issue of report.warnings) {
    lines.push(t(locale, "startup.preflightWarning", { message: issue.summary }));
    lines.push(t(locale, "startup.preflightGuidance", { guidance: issue.guidance }));
  }

  return lines;
};
