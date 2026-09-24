import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

export const HUB_UNIT_NAME = "octogent-hub.service";

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the command could not run at all (ENOENT for a missing binary). */
  error?: NodeJS.ErrnoException;
};

/** Runs a command to completion; injectable so tests never touch systemctl. */
export type CommandRunner = (file: string, args: string[]) => CommandResult;

export const runCommand: CommandRunner = (file, args) => {
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 30_000 });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error as NodeJS.ErrnoException } : {}),
  };
};

export const isCommandSuccess = (result: CommandResult): boolean =>
  !result.error && result.status === 0;

export const describeCommandFailure = (result: CommandResult): string =>
  result.error?.message ??
  (result.stderr.trim() || result.stdout.trim() || `exit code ${result.status ?? "?"}`);

/** `~/.config/systemd/user`, honoring XDG_CONFIG_HOME the way systemd does. */
export const resolveUserUnitDir = (env: Record<string, string | undefined>, home: string) =>
  join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "systemd", "user");

export const resolveHubUnitPath = (env: Record<string, string | undefined>, home: string) =>
  join(resolveUserUnitDir(env, home), HUB_UNIT_NAME);

// Unit files expand `%` specifiers everywhere and `$` variables in ExecStart,
// and C-unquote double-quoted words.
const escapeSpecifiers = (value: string) => value.replace(/%/g, "%%");
const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const execWord = (value: string) => {
  const escaped = escapeSpecifiers(value).replace(/\$/g, () => "$$");
  return /[\s"'\\;]/.test(value) ? quote(escaped) : escaped;
};
const environmentLine = (key: string, value: string) =>
  `Environment=${quote(`${key}=${escapeSpecifiers(value)}`)}`;

export type HubUnitInput = {
  /** The `octogent` launcher the service runs. */
  binaryPath: string;
  home: string;
  envFileExists: boolean;
  /** PATH for the hub and its agents; systemd never reads the shell profile. */
  path?: string | undefined;
  /** The state root the hub serves; defaults to `<home>/.octogent`. */
  octogentHome?: string | undefined;
};

const resolveStateRoot = (home: string, octogentHome?: string) =>
  octogentHome?.trim() || join(home, ".octogent");

/**
 * The hub's systemd user unit. It names its state root explicitly, which is
 * also how a CLI tells the unit serves its own hub (see isHubServiceInstalled).
 */
export const renderHubUnit = ({
  binaryPath,
  home,
  envFileExists,
  path,
  octogentHome,
}: HubUnitInput): string => {
  const stateRoot = resolveStateRoot(home, octogentHome);
  const envFile = join(stateRoot, "hub.env");
  const lines = [
    "# Written by `octogent hub install-service`. Run it again after moving the",
    "# Octogent checkout or switching Node versions; `--remove` uninstalls it.",
    "[Unit]",
    "Description=Octogent hub",
    // A hub that cannot start (its port taken, say) stops retrying after five tries.
    "StartLimitIntervalSec=120",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${execWord(binaryPath)} hub start --foreground`,
    `WorkingDirectory=${escapeSpecifiers(home)}`,
    ...(path
      ? [
          "# The installing shell's PATH: the launcher's node and the agents' CLIs live there.",
          environmentLine("PATH", path),
        ]
      : []),
    environmentLine("OCTOGENT_HOME", stateRoot),
    // Always referenced (`-` tolerates a missing file): the operator can add
    // hub.env later and only restart the hub, without installing again.
    ...(envFileExists
      ? []
      : [`# For more variables, write KEY=value lines to ${envFile} and restart the hub.`]),
    `EnvironmentFile=-${escapeSpecifiers(envFile)}`,
    "Restart=on-failure",
    "RestartSec=3",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ];
  return lines.join("\n");
};

/**
 * True when this user's hub unit serves `stateRoot`. A unit for another
 * state root (a test's, or a second installation's) is not this CLI's hub.
 */
export const isHubServiceInstalled = (
  env: Record<string, string | undefined>,
  home: string,
  stateRoot: string,
): boolean => {
  try {
    const unit = readFileSync(resolveHubUnitPath(env, home), "utf8");
    return unit.split("\n").includes(environmentLine("OCTOGENT_HOME", stateRoot));
  } catch {
    return false;
  }
};

/** PATH with `directory` in front unless already on it. */
export const withDirectoryOnPath = (pathValue: string | undefined, directory: string): string => {
  const entries = (pathValue ?? "").split(delimiter).filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    return [directory, "/usr/local/bin", "/usr/bin", "/bin"].join(delimiter);
  }
  return entries.includes(directory)
    ? entries.join(delimiter)
    : [directory, ...entries].join(delimiter);
};
