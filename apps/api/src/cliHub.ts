import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";

import { type Locale, t } from "@octogent/core";

import { findCurrentProject, findProjectConfigRoot } from "./cliApiTarget";
import { assertSecureRemoteBinding, resolveAccessToken } from "./createApiServer/remoteAuth";
import { resolveHubLockPath, tryAcquireHubLock } from "./hubLock";
import {
  type HubMetadata,
  clearHubMetadata,
  isHubMetadataLive,
  isProcessAlive,
  probeHubHealth,
  readHubMetadata,
  readLiveHubMetadata,
  writeHubMetadata,
} from "./hubMetadata";
import {
  type CommandRunner,
  HUB_UNIT_NAME,
  describeCommandFailure,
  isCommandSuccess,
  isHubServiceInstalled,
  runCommand,
} from "./hubServiceUnit";
import { type BuildIdentity, describeBuildDrift, formatBuildLabel } from "./hubVersionDrift";
import {
  canListenOnPort,
  isWildcardHost,
  listLanAddresses,
  resolveListenHost,
  toConnectableHost,
} from "./listenHost";
import { configureServerLogging, installUncaughtErrorLogging, log, logError } from "./logging";
import {
  loadProjectsRegistry,
  resolveGlobalOctogentDir,
  resolveHubStateDir,
} from "./projectPersistence";
import { readRuntimeMetadata } from "./runtimeMetadata";
import { logStartupPrerequisites } from "./startupPrerequisites";

const DEFAULT_HUB_PORT = 8787;
const HUB_START_TIMEOUT_MS = 15_000;
const HUB_STOP_TIMEOUT_MS = 10_000;
const HUB_KILL_TIMEOUT_MS = 2_000;
// Longer than one start: a CLI waiting on another CLI's start must outlast it.
const HUB_LOCK_WAIT_MS = HUB_START_TIMEOUT_MS + 10_000;
const POLL_INTERVAL_MS = 150;
const BUSY_LIFECYCLES = new Set(["running", "awaiting-review"]);

export type HubCliContext = {
  locale: Locale;
  build: BuildIdentity;
  webDistDir: string;
  promptsDir: string;
  env?: NodeJS.ProcessEnv;
  /** For systemctl; tests substitute one that never runs it. */
  runCommand?: CommandRunner;
};

/** A failure already worded for the operator. */
export class HubCliError extends Error {}

const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * The hub's port is fixed rather than probed upward: every CLI and hook has
 * to find the one hub without asking anyone.
 */
export const readHubPort = (env: Record<string, string | undefined>): number => {
  const parsed = Number(env.OCTOGENT_HUB_PORT?.trim());
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : DEFAULT_HUB_PORT;
};

const resolveHubLogPath = () => join(resolveHubStateDir(), "logs", "server.log");
// The daemon's own stderr: whatever it prints before (or instead of) logging
// to server.log, such as a crash while loading.
const resolveDaemonStderrPath = () => join(resolveHubStateDir(), "logs", "daemon-stderr.log");

export type PortOccupant =
  | { kind: "free" }
  | { kind: "hub"; pid: number | null }
  | { kind: "other"; pid: number | null; workspaceCwd: string | null };

/** Single-project servers record their port in runtime.json; find one on this port. */
const findRuntimeOnPort = (port: number): { pid: number; workspaceCwd: string } | null => {
  const projectsDir = join(resolveGlobalOctogentDir(), "projects");
  let projectIds: string[];
  try {
    projectIds = readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const projectId of projectIds) {
    const runtime = readRuntimeMetadata(join(projectsDir, projectId));
    if (runtime && runtime.port === port && isProcessAlive(runtime.pid)) {
      return { pid: runtime.pid, workspaceCwd: runtime.workspaceCwd };
    }
  }
  return null;
};

export const inspectHubPort = async (port: number, host: string): Promise<PortOccupant> => {
  if (await canListenOnPort(port, host)) {
    return { kind: "free" };
  }
  const health = await probeHubHealth(`http://${toConnectableHost(host)}:${port}`);
  if (health) {
    return { kind: "hub", pid: health.pid };
  }
  const runtime = findRuntimeOnPort(port);
  return { kind: "other", pid: runtime?.pid ?? null, workspaceCwd: runtime?.workspaceCwd ?? null };
};

/** Why the hub cannot take its port from this occupant; null when the port is free. */
export const describePortOccupant = (
  locale: Locale,
  port: number,
  occupant: PortOccupant,
): string | null => {
  if (occupant.kind === "hub") {
    return t(locale, "cli.hub.portHeldByOrphanHub", { port, pid: occupant.pid ?? "?" });
  }
  if (occupant.kind === "other") {
    return occupant.pid === null
      ? t(locale, "cli.hub.portTakenUnknown", { port })
      : t(locale, "cli.hub.portTaken", {
          port,
          pid: occupant.pid,
          workspace: occupant.workspaceCwd ?? "?",
        });
  }
  return null;
};

/** Throws a worded error unless the hub may bind here. */
const assertHubCanStart = async (
  locale: Locale,
  env: NodeJS.ProcessEnv,
): Promise<{ port: number; host: string; accessToken: string | null }> => {
  const port = readHubPort(env);
  const host = resolveListenHost(env);
  const accessToken = resolveAccessToken(env);
  // Unlike a lone server, the hub never mints a token: a daemon's token
  // would change on every restart and be printed where nobody reads it.
  try {
    assertSecureRemoteBinding(host, accessToken);
  } catch (error) {
    throw new HubCliError(error instanceof Error ? error.message : String(error));
  }

  const occupant = await inspectHubPort(port, host);
  const blocked = describePortOccupant(locale, port, occupant);
  if (blocked) {
    throw new HubCliError(blocked);
  }
  return { port, host, accessToken };
};

const printAlreadyRunning = (locale: Locale, metadata: HubMetadata) => {
  console.log(t(locale, "cli.hub.alreadyRunning", { url: metadata.apiBaseUrl, pid: metadata.pid }));
};

/** `octogent hub start --foreground`: this process becomes the hub. */
export const runHubForeground = async (context: HubCliContext): Promise<void> => {
  const { locale, build, webDistDir, promptsDir, env = process.env } = context;
  const existing = await readLiveHubMetadata();
  if (existing) {
    printAlreadyRunning(locale, existing);
    return;
  }
  const { port, host, accessToken } = await assertHubCanStart(locale, env);

  const logPath = configureServerLogging({ hubStateDir: resolveHubStateDir(), env });
  installUncaughtErrorLogging();
  log(`  Server log: ${logPath ?? "off"}`);
  if (!logStartupPrerequisites(locale)) {
    throw new HubCliError(t(locale, "cli.hub.prerequisitesFailed"));
  }

  // Loaded lazily so the lightweight commands never pull in PTY support.
  const { createHubServer } = await import("./createHubServer");
  const hub = createHubServer({
    webDistDir: existsSync(webDistDir) ? webDistDir : undefined,
    promptsDir,
    accessToken,
    build,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearHubMetadata(undefined, { pid: process.pid });
    await hub.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  let bound: { host: string; port: number };
  try {
    bound = await hub.start(port, host);
  } catch (error) {
    // Lost a race for the port after the check above (another hub, most likely).
    throw new HubCliError(
      t(locale, "cli.hub.bindFailed", {
        port,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const apiBaseUrl = hub.hubBaseUrl();
  writeHubMetadata({
    apiBaseUrl,
    host: bound.host,
    port: bound.port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ...build,
  });

  log();
  log(`  Octogent hub version=${formatBuildLabel(build)} port=${bound.port} pid=${process.pid}`);
  log(`  ${t(locale, "cli.hub.running")}`);
  log(`  ${t(locale, "cli.server.api")} ${apiBaseUrl}`);
  if (isWildcardHost(bound.host)) {
    for (const address of listLanAddresses(networkInterfaces())) {
      log(`  ${t(locale, "cli.server.lan")} http://${address}:${bound.port}`);
    }
  }
  log();
};

const readTail = (path: string, maxLines = 20): string => {
  try {
    return readFileSync(path, "utf8").trimEnd().split("\n").slice(-maxLines).join("\n");
  } catch {
    return "";
  }
};

/**
 * With the hub's systemd unit installed, starting it anywhere else would
 * leave a hub systemd neither restarts nor knows about. Null when there is
 * no unit for this state root or systemctl refuses; the caller spawns one.
 */
const startHubService = async (context: HubCliContext): Promise<HubMetadata | null> => {
  const { locale, env = process.env } = context;
  if (!isHubServiceInstalled(env, homedir(), resolveGlobalOctogentDir())) {
    return null;
  }
  const started = (context.runCommand ?? runCommand)("systemctl", [
    "--user",
    "start",
    HUB_UNIT_NAME,
  ]);
  if (!isCommandSuccess(started)) {
    console.error(
      t(locale, "cli.hub.serviceStartFailed", { reason: describeCommandFailure(started) }),
    );
    return null;
  }
  const deadline = Date.now() + HUB_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const metadata = await readLiveHubMetadata();
    if (metadata) {
      return metadata;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new HubCliError(
    t(locale, "cli.hub.serviceStartTimeout", { seconds: HUB_START_TIMEOUT_MS / 1000 }),
  );
};

/**
 * Starts the hub, through its systemd unit when installed, else as a
 * detached `hub start --foreground`, and waits until its hub.json is written
 * and its health answers. Callers hold the hub lock.
 */
const startHubDaemon = async (context: HubCliContext): Promise<HubMetadata> => {
  const { locale, env = process.env } = context;
  await assertHubCanStart(locale, env);
  const viaService = await startHubService(context);
  if (viaService) {
    return viaService;
  }

  const stderrPath = resolveDaemonStderrPath();
  mkdirSync(join(resolveHubStateDir(), "logs"), { recursive: true });
  const stderrFd = openSync(stderrPath, "w");
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    closeSync(stderrFd);
    throw new HubCliError(t(locale, "cli.hub.startFailed", { log: stderrPath }));
  }
  // stdout is dropped: everything the hub logs is already in server.log, and
  // a second copy there would be unstamped and never rotated.
  const child = spawn(
    process.execPath,
    [...process.execArgv, scriptPath, "hub", "start", "--foreground"],
    {
      // Out of any project directory, so the long-lived hub pins none of them.
      cwd: resolveGlobalOctogentDir(),
      detached: true,
      env: { ...env, OCTOGENT_NO_OPEN: "1" },
      stdio: ["ignore", "ignore", stderrFd],
    },
  );
  closeSync(stderrFd);
  child.unref();

  const outcome: { exitCode?: number | null } = {};
  child.once("exit", (code) => {
    outcome.exitCode = code;
  });
  child.once("error", () => {
    outcome.exitCode = null;
  });

  const deadline = Date.now() + HUB_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const metadata = readHubMetadata();
    if (metadata && metadata.pid === child.pid && (await isHubMetadataLive(metadata))) {
      return metadata;
    }
    if ("exitCode" in outcome) {
      const tail = readTail(stderrPath);
      const message = t(locale, "cli.hub.startExited", {
        code: outcome.exitCode ?? "?",
        log: resolveHubLogPath(),
      });
      throw new HubCliError(tail ? `${message}\n${tail}` : message);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new HubCliError(
    t(locale, "cli.hub.startTimeout", {
      seconds: HUB_START_TIMEOUT_MS / 1000,
      log: resolveHubLogPath(),
    }),
  );
};

/**
 * The live hub, starting one if none answers. The lock makes concurrent CLIs
 * start a single hub; the others wait for it.
 */
export const ensureHubRunning = async (
  context: HubCliContext,
  options: { announce?: boolean } = {},
): Promise<HubMetadata> => {
  const { locale, env = process.env } = context;
  const lockPath = resolveHubLockPath();
  const deadline = Date.now() + HUB_LOCK_WAIT_MS;
  let announcedWait = false;

  while (true) {
    const live = await readLiveHubMetadata();
    if (live) {
      return live;
    }
    const lock = tryAcquireHubLock(lockPath);
    if (lock) {
      try {
        // Another CLI may have finished starting it between the read and the lock.
        const started = await readLiveHubMetadata();
        if (started) {
          return started;
        }
        if (options.announce) {
          console.error(t(locale, "cli.hub.autostarting", { port: readHubPort(env) }));
        }
        return await startHubDaemon(context);
      } finally {
        lock.release();
      }
    }
    if (Date.now() >= deadline) {
      throw new HubCliError(t(locale, "cli.hub.lockTimeout", { lock: lockPath }));
    }
    if (!announcedWait && options.announce) {
      announcedWait = true;
      console.error(t(locale, "cli.hub.waitingForStart"));
    }
    await sleep(POLL_INTERVAL_MS);
  }
};

/** `octogent hub start` without `--foreground`. */
export const runHubStart = async (context: HubCliContext): Promise<number> => {
  const existing = await readLiveHubMetadata();
  if (existing) {
    printAlreadyRunning(context.locale, existing);
    return 0;
  }
  const metadata = await ensureHubRunning(context);
  console.log(
    t(context.locale, "cli.hub.started", { url: metadata.apiBaseUrl, pid: metadata.pid }),
  );
  return 0;
};

// Signalling a pid from a file is only safe when it is still the hub: pids
// are reused, and hub.json survives crashes and reboots.
const looksLikeHubProcess = (pid: number): boolean => {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    return cmdline.includes("hub") && cmdline.includes("--foreground");
  } catch {
    return false;
  }
};

const waitForExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(100);
  }
  return !isProcessAlive(pid);
};

/** `octogent hub stop`: SIGTERM, then SIGKILL after 10 s. */
export const runHubStop = async (context: HubCliContext): Promise<number> => {
  const { locale } = context;
  const metadata = readHubMetadata();
  if (!metadata) {
    console.log(t(locale, "cli.hub.notRunning"));
    return 0;
  }
  if (!isProcessAlive(metadata.pid)) {
    clearHubMetadata(undefined, { pid: metadata.pid });
    console.log(t(locale, "cli.hub.staleRemoved"));
    return 0;
  }
  if (!(await isHubMetadataLive(metadata)) && !looksLikeHubProcess(metadata.pid)) {
    console.error(t(locale, "cli.hub.unknownProcess", { pid: metadata.pid }));
    return 1;
  }

  console.log(t(locale, "cli.hub.stopping", { pid: metadata.pid }));
  try {
    process.kill(metadata.pid, "SIGTERM");
  } catch {
    // Exited on its own since the check; the wait below sees that.
  }
  if (!(await waitForExit(metadata.pid, HUB_STOP_TIMEOUT_MS))) {
    console.error(t(locale, "cli.hub.killed", { seconds: HUB_STOP_TIMEOUT_MS / 1000 }));
    try {
      process.kill(metadata.pid, "SIGKILL");
    } catch {
      // Exited between the check and the signal.
    }
    await waitForExit(metadata.pid, HUB_KILL_TIMEOUT_MS);
  }
  // A killed hub never got to remove its own file.
  clearHubMetadata(undefined, { pid: metadata.pid });
  console.log(t(locale, "cli.hub.stopped"));
  return 0;
};

type ProjectListing = {
  id: string;
  name: string;
  slug: string;
  path: string;
  loaded: boolean;
  summary?: { runningTerminals?: number; awaitingReviewTerminals?: number };
};

const fetchProjects = async (apiBaseUrl: string): Promise<ProjectListing[] | null> => {
  try {
    const response = await fetch(`${apiBaseUrl}/api/projects`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { projects?: ProjectListing[] };
    return Array.isArray(payload.projects) ? payload.projects : null;
  } catch {
    return null;
  }
};

export type BusyTerminal = { slug: string; terminalId: string; lifecycleState: string };

/** Terminals a hub restart would kill: live ones that are not archived. */
export const collectBusyTerminals = (
  projects: Array<{ slug: string; snapshots: Array<Record<string, unknown>> }>,
): BusyTerminal[] =>
  projects.flatMap(({ slug, snapshots }) =>
    snapshots
      .filter(
        (snapshot) =>
          typeof snapshot.lifecycleState === "string" &&
          BUSY_LIFECYCLES.has(snapshot.lifecycleState) &&
          typeof snapshot.archivedAt !== "string",
      )
      .map((snapshot) => ({
        slug,
        terminalId: String(snapshot.terminalId),
        lifecycleState: String(snapshot.lifecycleState),
      })),
  );

const fetchBusyTerminals = async (apiBaseUrl: string): Promise<BusyTerminal[] | null> => {
  const projects = await fetchProjects(apiBaseUrl);
  if (!projects) {
    return null;
  }
  // Only a loaded project has sessions; the summary says which are worth a look.
  const candidates = projects.filter(
    (project) =>
      project.loaded &&
      (project.summary?.runningTerminals ?? 0) + (project.summary?.awaitingReviewTerminals ?? 0) >
        0,
  );
  try {
    const withSnapshots = await Promise.all(
      candidates.map(async (project) => {
        const response = await fetch(
          `${apiBaseUrl}/api/p/${encodeURIComponent(project.id)}/api/terminal-snapshots`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000) },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return {
          slug: project.slug,
          snapshots: (await response.json()) as Array<Record<string, unknown>>,
        };
      }),
    );
    return collectBusyTerminals(withSnapshots);
  } catch {
    // Unknown is not idle: the caller refuses without --force.
    return null;
  }
};

/** `octogent hub restart [--force]`. */
export const runHubRestart = async (context: HubCliContext, force: boolean): Promise<number> => {
  const { locale } = context;
  const live = await readLiveHubMetadata();
  if (live) {
    const busy = await fetchBusyTerminals(live.apiBaseUrl);
    if (busy === null && !force) {
      console.error(t(locale, "cli.hub.restartUnknownBusy"));
      return 1;
    }
    if (busy && busy.length > 0) {
      console.error(t(locale, force ? "cli.hub.restartForced" : "cli.hub.restartBusy"));
      for (const terminal of busy) {
        console.error(`  ${terminal.slug}  ${terminal.terminalId}  ${terminal.lifecycleState}`);
      }
      if (!force) {
        return 1;
      }
    }
  }
  if (readHubMetadata()) {
    const stopped = await runHubStop(context);
    if (stopped !== 0) {
      return stopped;
    }
  }
  return runHubStart(context);
};

/** `octogent hub status`: exits 1 unless a hub answers. */
export const runHubStatus = async (context: HubCliContext): Promise<number> => {
  const { locale, build } = context;
  const metadata = readHubMetadata();
  if (!metadata) {
    console.log(t(locale, "cli.hub.notRunning"));
    return 1;
  }

  const answering = await isHubMetadataLive(metadata);
  const label = (key: string) => t(locale, key).padEnd(10);
  console.log(
    `${label("cli.hub.status.hub")}${metadata.apiBaseUrl}  (${t(locale, answering ? "cli.hub.status.answering" : "cli.hub.status.notAnswering")})`,
  );
  console.log(`${label("cli.hub.status.pid")}${metadata.pid}`);
  console.log(`${label("cli.hub.status.started")}${metadata.startedAt}`);
  console.log(
    `${label("cli.hub.status.build")}${t(locale, "cli.hub.status.buildLine", { hub: formatBuildLabel(metadata), cli: formatBuildLabel(build) })}`,
  );
  const drift = describeBuildDrift(metadata, build);
  if (drift) {
    console.log(
      `${"".padEnd(10)}${t(locale, drift === "older" ? "cli.hub.driftOlder" : "cli.hub.driftDifferent", { hub: formatBuildLabel(metadata), cli: formatBuildLabel(build) })}`,
    );
  }
  console.log(`${label("cli.hub.status.log")}${resolveHubLogPath()}`);
  if (!answering) {
    return 1;
  }

  const projects = await fetchProjects(metadata.apiBaseUrl);
  console.log(t(locale, "cli.hub.status.projects"));
  if (!projects || projects.length === 0) {
    console.log(`  ${t(locale, "cli.hub.status.noProjects")}`);
    return 0;
  }
  const current = findCurrentProject(
    loadProjectsRegistry(),
    process.cwd(),
    findProjectConfigRoot(process.cwd()),
  );
  const slugWidth = Math.max(...projects.map((project) => project.slug.length));
  for (const project of projects) {
    const marker = project.id === current?.id ? "*" : " ";
    const state = project.loaded
      ? t(locale, "cli.hub.status.loaded", {
          running: project.summary?.runningTerminals ?? 0,
          review: project.summary?.awaitingReviewTerminals ?? 0,
        })
      : t(locale, "cli.hub.status.notLoaded");
    console.log(`${marker} ${project.slug.padEnd(slugWidth)}  ${state}  ${project.path}`);
  }
  return 0;
};

/** Reports a worded hub failure and exits; anything else is a real bug and rethrows. */
export const exitOnHubCliError = (error: unknown): never => {
  if (error instanceof HubCliError) {
    logError(error.message);
    process.exit(1);
  }
  throw error;
};
