import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";

import { type Locale, t } from "@octogent/core";

import { HubCliError } from "./cliHub";
import { readLiveHubMetadata } from "./hubMetadata";
import {
  type CommandResult,
  type CommandRunner,
  HUB_UNIT_NAME,
  describeCommandFailure,
  isCommandSuccess,
  renderHubUnit,
  resolveHubUnitPath,
  runCommand,
  withDirectoryOnPath,
} from "./hubServiceUnit";
import { resolveGlobalOctogentDir } from "./projectPersistence";

export type HubServiceOptions = {
  locale: Locale;
  /** The `octogent` launcher the unit runs. */
  binaryPath: string;
  /** The bundle the launcher loads; missing means nothing was built yet. */
  bundlePath?: string | undefined;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** The node running this CLI; the launcher's `#!/usr/bin/env node` must find it. */
  nodePath?: string;
  username?: string;
  platform?: NodeJS.Platform;
  runner?: CommandRunner;
  print?: (line: string) => void;
  /** How long to wait for the unit's hub to answer before returning; 0 skips the wait. */
  waitForHubMs?: number;
};

// Matches `hub start`: systemd returns from `enable --now` before the hub
// listens, and a `hub status` typed right after would otherwise say "no hub".
const SERVICE_START_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 150;

const waitForHub = async (timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const metadata = await readLiveHubMetadata();
    if (metadata) {
      return metadata;
    }
    await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, POLL_INTERVAL_MS));
  }
  return null;
};

const resolveOptions = (options: HubServiceOptions) => ({
  env: options.env ?? process.env,
  home: options.home ?? homedir(),
  runner: options.runner ?? runCommand,
  print: options.print ?? ((line: string) => console.log(line)),
});

/** systemd is Linux-only, and a container usually has none; say which before touching files. */
const assertSystemdUserManager = (
  locale: Locale,
  platform: NodeJS.Platform,
  runner: CommandRunner,
) => {
  if (platform !== "linux") {
    throw new HubCliError(t(locale, "cli.service.linuxOnly"));
  }
  const probe = runner("systemctl", ["--user", "show-environment"]);
  if (probe.error?.code === "ENOENT") {
    throw new HubCliError(t(locale, "cli.service.noSystemctl"));
  }
  if (!isCommandSuccess(probe)) {
    throw new HubCliError(
      t(locale, "cli.service.noUserManager", { reason: describeCommandFailure(probe) }),
    );
  }
};

const runOrThrow = (locale: Locale, runner: CommandRunner, args: string[]): CommandResult => {
  const result = runner("systemctl", args);
  if (!isCommandSuccess(result)) {
    throw new HubCliError(
      t(locale, "cli.service.commandFailed", {
        command: `systemctl ${args.join(" ")}`,
        reason: describeCommandFailure(result),
      }),
    );
  }
  return result;
};

/** `octogent hub install-service`: writes, enables, and starts the hub's user unit. */
export const runHubInstallService = async (options: HubServiceOptions): Promise<number> => {
  const { locale } = options;
  const { env, home, runner, print } = resolveOptions(options);
  assertSystemdUserManager(locale, options.platform ?? process.platform, runner);
  for (const required of [options.binaryPath, options.bundlePath]) {
    if (required && !existsSync(required)) {
      throw new HubCliError(t(locale, "cli.service.missingBuild", { path: required }));
    }
  }

  const stateRoot = resolveGlobalOctogentDir();
  const envFile = join(stateRoot, "hub.env");
  const envFileExists = existsSync(envFile);
  const unitPath = resolveHubUnitPath(env, home);
  const unit = renderHubUnit({
    binaryPath: options.binaryPath,
    home,
    envFileExists,
    path: withDirectoryOnPath(env.PATH, dirname(options.nodePath ?? process.execPath)),
    octogentHome: stateRoot,
  });
  const runningBefore = await readLiveHubMetadata();

  mkdirSync(dirname(unitPath), { recursive: true });
  writeFileSync(unitPath, unit, "utf8");
  runOrThrow(locale, runner, ["--user", "daemon-reload"]);
  runOrThrow(locale, runner, ["--user", "enable", "--now", HUB_UNIT_NAME]);

  print(t(locale, "cli.service.installed", { path: unitPath }));
  print(
    envFileExists
      ? `  ${t(locale, "cli.service.envFile", { path: envFile })}`
      : `  ${t(locale, "cli.service.noEnvFile", { path: envFile })}`,
  );
  // An already running hub keeps the port, so the unit's own hub stepped aside.
  if (runningBefore) {
    print(`  ${t(locale, "cli.service.hubAlreadyRunning", { pid: runningBefore.pid })}`);
  } else {
    const waitMs = options.waitForHubMs ?? SERVICE_START_TIMEOUT_MS;
    const started = waitMs > 0 ? await waitForHub(waitMs) : undefined;
    if (started) {
      print(`  ${t(locale, "cli.hub.started", { url: started.apiBaseUrl, pid: started.pid })}`);
    } else if (started === null) {
      print(`  ${t(locale, "cli.service.startPending")}`);
    }
  }

  const username = options.username ?? userInfo().username;
  const linger = runner("loginctl", ["show-user", username, "--property=Linger", "--value"]);
  if (!isCommandSuccess(linger) || linger.stdout.trim() !== "yes") {
    print(`  ${t(locale, "cli.service.lingerOff", { user: username })}`);
  }
  return 0;
};

/**
 * `octogent hub install-service --remove`. Disables without stopping: a
 * running hub may have live workers, and `octogent hub stop` is the way to
 * end it on purpose.
 */
export const runHubRemoveService = (options: HubServiceOptions): number => {
  const { locale } = options;
  const { env, home, runner, print } = resolveOptions(options);
  assertSystemdUserManager(locale, options.platform ?? process.platform, runner);

  const unitPath = resolveHubUnitPath(env, home);
  if (!existsSync(unitPath)) {
    print(t(locale, "cli.service.notInstalled", { path: unitPath }));
    return 0;
  }
  const disabled = runner("systemctl", ["--user", "disable", HUB_UNIT_NAME]);
  if (!isCommandSuccess(disabled)) {
    print(t(locale, "cli.service.disableFailed", { reason: describeCommandFailure(disabled) }));
  }
  rmSync(unitPath, { force: true });
  runOrThrow(locale, runner, ["--user", "daemon-reload"]);
  print(t(locale, "cli.service.removed", { path: unitPath }));
  return 0;
};
