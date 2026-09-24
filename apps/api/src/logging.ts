import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { format } from "node:util";

export const SERVER_LOG_MAX_BYTES = 5 * 1024 * 1024;
const SERVER_LOG_GENERATIONS = 3;

let serverLogPath: string | null = null;
let hasWarnedAboutFileLogging = false;
let hasInstalledUncaughtErrorLogging = false;

// The hub serves every project from one process and one log file. Carrying
// the project's tag in async context (rather than threading a logger through
// every runtime module) tags whatever a project's request, timer, or PTY
// callback logs, without touching the modules that log.
const logPrefixScope = new AsyncLocalStorage<string>();

export const runWithLogPrefix = <T>(prefix: string, run: () => T): T =>
  logPrefixScope.run(prefix, run);

const isEnabled = (value: string | undefined): boolean => value === "1";

export const isVerboseLoggingEnabled = (): boolean => isEnabled(process.env.OCTOGENT_VERBOSE_LOGS);

const warnOnce = (error: unknown): void => {
  if (hasWarnedAboutFileLogging) {
    return;
  }
  hasWarnedAboutFileLogging = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[server-log] Unable to write ${serverLogPath ?? "server log"}: ${message}`);
};

const rotateServerLog = (logPath: string): void => {
  for (let generation = SERVER_LOG_GENERATIONS; generation >= 1; generation -= 1) {
    const source = generation === 1 ? logPath : `${logPath}.${generation - 1}`;
    const destination = `${logPath}.${generation}`;
    if (!existsSync(source)) {
      continue;
    }
    rmSync(destination, { force: true });
    renameSync(source, destination);
  }
};

const rotateIfNeeded = (incomingBytes = 0): void => {
  if (!serverLogPath || !existsSync(serverLogPath)) {
    return;
  }
  if (statSync(serverLogPath).size + incomingBytes > SERVER_LOG_MAX_BYTES) {
    rotateServerLog(serverLogPath);
  }
};

const maskSecrets = (line: string): string =>
  line.replace(/([?&]token=)([^&\s]+)/gu, (_match, prefix: string, token: string) => {
    return `${prefix}${token.slice(0, 4)}…`;
  });

const appendToServerLog = (args: Parameters<typeof console.log>): void => {
  if (!serverLogPath) {
    return;
  }
  try {
    // Every line is stamped: a post-mortem is mostly "what happened around
    // 10:33?", and the console copy has no clock at all. Multi-line messages
    // (the startup banner) keep one stamp per line so grep by time works.
    const stamp = new Date().toISOString();
    const prefix = logPrefixScope.getStore();
    const lead = prefix ? `${stamp} ${prefix}` : stamp;
    const line = `${maskSecrets(format(...args))
      .split("\n")
      .map((part) => `${lead} ${part}`)
      .join("\n")}\n`;
    rotateIfNeeded(Buffer.byteLength(line));
    appendFileSync(serverLogPath, line, "utf8");
  } catch (error) {
    // Logging must never turn an otherwise healthy request into a failure.
    warnOnce(error);
  }
};

type ConfigureServerLoggingOptions = { env?: NodeJS.ProcessEnv } & (
  | { projectStateDir: string; hubStateDir?: undefined }
  // The hub has no single project to own its log, so it lives in the hub's own state dir.
  | { hubStateDir: string; projectStateDir?: undefined }
);

export const configureServerLogging = ({
  projectStateDir,
  hubStateDir,
  env = process.env,
}: ConfigureServerLoggingOptions): string | null => {
  hasWarnedAboutFileLogging = false;
  const configuredPath = env.OCTOGENT_SERVER_LOG?.trim();
  if (configuredPath?.toLowerCase() === "off") {
    serverLogPath = null;
    return null;
  }

  serverLogPath = configuredPath
    ? isAbsolute(configuredPath)
      ? configuredPath
      : resolve(configuredPath)
    : join(hubStateDir ?? projectStateDir ?? "", "logs", "server.log");

  try {
    mkdirSync(dirname(serverLogPath), { recursive: true });
    rotateIfNeeded();
    appendFileSync(serverLogPath, "", "utf8");
  } catch (error) {
    warnOnce(error);
  }
  return serverLogPath;
};

// Prepending the prefix as a separate argument would demote a format string
// to a plain value, so a scoped line is formatted first.
const toConsoleArgs = (args: Parameters<typeof console.log>): Parameters<typeof console.log> => {
  const prefix = logPrefixScope.getStore();
  return prefix ? [`${prefix} ${format(...args)}`] : args;
};

export const log = (...args: Parameters<typeof console.log>): void => {
  console.log(...toConsoleArgs(args));
  appendToServerLog(args);
};

export const logWarn = (...args: Parameters<typeof console.warn>): void => {
  console.warn(...toConsoleArgs(args));
  appendToServerLog(args);
};

export const logError = (...args: Parameters<typeof console.error>): void => {
  console.error(...toConsoleArgs(args));
  appendToServerLog(args);
};

export const logVerbose = (...args: Parameters<typeof console.log>): void => {
  if (isVerboseLoggingEnabled()) {
    console.log(...toConsoleArgs(args));
  }
  appendToServerLog(args);
};

export const installUncaughtErrorLogging = (): void => {
  if (hasInstalledUncaughtErrorLogging) {
    return;
  }
  hasInstalledUncaughtErrorLogging = true;
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    appendToServerLog([`Uncaught error (${origin}):`, error]);
  });
};
