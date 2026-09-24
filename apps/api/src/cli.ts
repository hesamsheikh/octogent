import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { basename, join, resolve } from "node:path";

import { DEFAULT_LOCALE, type Locale, t } from "@octogent/core";
import { createCliApiBaseResolver } from "./cliApiBase";
import { extractGlobalFlags, findCurrentProject, findProjectConfigRoot } from "./cliApiTarget";
import { formatChannelMessageLine } from "./cliChannel";
import { renderGuide, resolveAgentSkillTargets, setupAgentSkills } from "./cliGuide";
import {
  type HubCliContext,
  exitOnHubCliError,
  runHubForeground,
  runHubRestart,
  runHubStart,
  runHubStatus,
  runHubStop,
} from "./cliHub";
import { runHubInstallService, runHubRemoveService } from "./cliHubService";
import { runBareStart } from "./cliStart";
import { formatUsageWarning, parseTerminalCreateArgs } from "./cliTerminalCreate";
import {
  type TerminalResult,
  buildTerminalResult,
  formatProviderErrorLine,
  formatTerminalListLine,
  isSettledLifecycle,
  needsAttention,
  parseTerminalWaitArgs,
} from "./cliTerminalResult";
import {
  fetchTerminalScreen,
  formatScreen,
  runTerminalInput,
  runTerminalScreen,
} from "./cliTerminalScreen";
import { generateAccessToken, resolveAccessToken } from "./createApiServer/remoteAuth";
import { resolveRootVersion } from "./healthSnapshot";
import { resolveBuildIdentity } from "./hubVersionDrift";
import {
  canListenOnPort,
  isRemoteAccessEnabled,
  isWildcardHost,
  listLanAddresses,
  resolveListenHost,
  toConnectableHost,
} from "./listenHost";
import { configureServerLogging, installUncaughtErrorLogging, log } from "./logging";
import { maybeOpenBrowser } from "./openBrowser";
import {
  ensureOctogentGitignoreEntry,
  ensureProjectScaffold,
  loadProjectConfig,
  loadProjectsRegistry,
  migrateStateToGlobal,
  registerProject,
  resolveEphemeralProjectStateDir,
  resolveProjectStateDir,
} from "./projectPersistence";
import { toProjectSlug } from "./projectSlug";
import { clearRuntimeMetadata, writeRuntimeMetadata } from "./runtimeMetadata";
import {
  followServerLog,
  parseServerLogsArgs,
  readServerLogTail,
  resolveServerLogPath,
} from "./serverLogs";
import { logStartupPrerequisites } from "./startupPrerequisites";
import { ensureProjectEnvTemplate } from "./terminalRuntime/ptyEnvironment";

const locale: Locale = (process.env.OCTOGENT_LOCALE as Locale) ?? DEFAULT_LOCALE;

// --project and --standalone apply to every command, so no per-command parser
// (or a channel message's free text) ever sees them.
const { args, projectFlag } = extractGlobalFlags(process.argv.slice(2));
const command = args[0];

const resolvePackageRoot = () => {
  const envRoot = process.env.OCTOGENT_PACKAGE_ROOT?.trim();
  if (envRoot) {
    return resolve(envRoot);
  }

  const candidates = [
    resolve(import.meta.dirname ?? ".", "../.."),
    resolve(import.meta.dirname ?? ".", "../../.."),
    process.cwd(),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
  }

  return candidates[0] ?? process.cwd();
};

const PACKAGE_ROOT = resolvePackageRoot();

const resolveRuntimeAssetPath = (...relativePathCandidates: [string[], ...string[][]]) => {
  for (const relativePath of relativePathCandidates) {
    const candidate = join(PACKAGE_ROOT, ...relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return join(PACKAGE_ROOT, ...relativePathCandidates[0]);
};

const hubContext: HubCliContext = {
  locale,
  build: resolveBuildIdentity(PACKAGE_ROOT),
  webDistDir: resolveRuntimeAssetPath(["dist", "web"], ["apps", "web", "dist"]),
  promptsDir: resolveRuntimeAssetPath(["dist", "prompts"], ["prompts"]),
};

const DEFAULT_START_PORT = 8787;
const MAX_PORT_ATTEMPTS = 200;

const initializeProject = (workspaceCwd: string, preferredName?: string) => {
  const projectName = preferredName?.trim() || basename(workspaceCwd) || "octogent-project";
  const hadConfig = loadProjectConfig(workspaceCwd) !== null;
  const projectConfig = ensureProjectScaffold(workspaceCwd, projectName);
  ensureOctogentGitignoreEntry(workspaceCwd);
  registerProject(workspaceCwd, projectConfig.displayName);
  const projectStateDir = resolveProjectStateDir(workspaceCwd, projectConfig.displayName);
  migrateStateToGlobal(workspaceCwd, projectStateDir);
  return {
    created: !hadConfig,
    projectConfig,
    projectStateDir,
  };
};

const resolveStartupProjectContext = (workspaceCwd: string) => {
  const existingConfig = loadProjectConfig(workspaceCwd);
  if (existingConfig) {
    registerProject(workspaceCwd, existingConfig.displayName);
    const projectStateDir = resolveProjectStateDir(workspaceCwd, existingConfig.displayName);
    migrateStateToGlobal(workspaceCwd, projectStateDir);
    return {
      isInitialized: true,
      projectDisplayName: existingConfig.displayName,
      projectStateDir,
    };
  }

  const projectDisplayName = basename(workspaceCwd) || "octogent-project";
  const projectStateDir = resolveEphemeralProjectStateDir(workspaceCwd);
  return {
    isInitialized: false,
    projectDisplayName,
    projectStateDir,
  };
};

const initProject = (name?: string) => {
  const projectPath = process.cwd();
  const { created, projectConfig, projectStateDir } = initializeProject(projectPath, name);

  console.log(
    t(locale, "cli.init.initialized", {
      displayName: projectConfig.displayName,
      path: projectPath,
    }),
  );
  // Workers start from a clean baseline, so a Python project's virtualenv has
  // to be named explicitly; offer the file where that happens.
  const envTemplate = ensureProjectEnvTemplate(projectPath);
  if (envTemplate.written) {
    console.log(
      envTemplate.venvDirectory
        ? t(locale, "cli.init.envWrittenVenv", { venv: envTemplate.venvDirectory })
        : t(locale, "cli.init.envWritten"),
    );
  }
  console.log(t(locale, "cli.init.ready"));
};

const findOpenPort = async (startPort: number, host: string): Promise<number> => {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset;
    if (port > 65535) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    if (await canListenOnPort(port, host)) {
      return port;
    }
  }

  throw new Error(`Unable to find an open port starting from ${startPort}`);
};

const readPreferredStartPort = () => {
  const rawPort = process.env.OCTOGENT_API_PORT ?? process.env.PORT;
  if (!rawPort) {
    return DEFAULT_START_PORT;
  }

  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_START_PORT;
  }

  return parsed;
};

const apiBaseResolver = createCliApiBaseResolver(hubContext, projectFlag);

const resolveApiBase = (): Promise<string> =>
  apiBaseResolver.resolveApiBase().catch(exitOnHubCliError);

const apiError = () => {
  console.error(
    t(locale, "cli.error.apiUnreachable", { url: apiBaseResolver.lastApiBase() ?? "?" }),
  );
  process.exit(1);
};

const startServer = async () => {
  const workspaceCwd = process.cwd();
  const { isInitialized, projectDisplayName, projectStateDir } =
    resolveStartupProjectContext(workspaceCwd);
  const serverLogPath = configureServerLogging({ projectStateDir });
  installUncaughtErrorLogging();
  log(`  Server log: ${serverLogPath ?? "off"}`);

  if (!logStartupPrerequisites(locale)) {
    process.exit(1);
  }

  const { promptsDir, webDistDir } = hubContext;
  const listenHost = resolveListenHost(process.env);
  // Remote access without a token would leave every agent and the codebase
  // open to the whole LAN; generate one for the session when none is set.
  let accessToken = resolveAccessToken(process.env);
  if (isRemoteAccessEnabled(process.env) && !accessToken) {
    accessToken = generateAccessToken();
  }
  const port = await findOpenPort(readPreferredStartPort(), listenHost);
  const { createApiServer } = await import("./createApiServer");

  const apiServer = createApiServer({
    workspaceCwd,
    projectStateDir,
    promptsDir,
    webDistDir: existsSync(webDistDir) ? webDistDir : undefined,
    accessToken,
  });

  const shutdown = async () => {
    clearRuntimeMetadata(projectStateDir);
    await apiServer.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  const { host, port: activePort } = await apiServer.start(port, listenHost);
  // A wildcard bind is not a destination: the browser, the CLI client, and the
  // runtime metadata all need an address they can actually dial.
  const apiBaseUrl = `http://${toConnectableHost(host)}:${activePort}`;
  writeRuntimeMetadata(projectStateDir, {
    apiBaseUrl,
    host,
    port: activePort,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    workspaceCwd,
  });

  const hasWebDist = existsSync(webDistDir);
  if (hasWebDist) {
    maybeOpenBrowser(apiBaseUrl);
  }

  const commit = process.env.OCTOGENT_BUILD_COMMIT ?? process.env.GIT_COMMIT;
  log();
  log(
    `  Octogent version=${resolveRootVersion(PACKAGE_ROOT)}${commit ? ` commit=${commit}` : ""} workspace=${workspaceCwd} port=${activePort} pid=${process.pid}`,
  );
  log(`  ${t(locale, "cli.server.running")}`);
  log(`  ${t(locale, "cli.server.project")} ${workspaceCwd}`);
  log(`  ${t(locale, "cli.server.api")} ${apiBaseUrl}`);
  if (isWildcardHost(host)) {
    for (const address of listLanAddresses(networkInterfaces())) {
      const suffix = accessToken ? `/?token=${accessToken}` : "";
      log(`  ${t(locale, "cli.server.lan")} http://${address}:${activePort}${suffix}`);
    }
    if (accessToken) {
      console.log(`  ${t(locale, "cli.server.token")} ${accessToken}`);
      console.log(`  ${t(locale, "cli.server.tokenHint")}`);
    }
  }
  log();
};

const printServerLogs = () => {
  const { projectStateDir } = resolveStartupProjectContext(process.cwd());
  const logPath = resolveServerLogPath(projectStateDir);
  let options: ReturnType<typeof parseServerLogsArgs>;
  try {
    options = parseServerLogsArgs(args.slice(1));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  if (!existsSync(logPath)) {
    console.error(`Server log not found: ${logPath}`);
    process.exit(1);
  }
  process.stdout.write(readServerLogTail(logPath, options.lines));
  if (options.follow) {
    followServerLog(logPath, (chunk) => process.stdout.write(chunk));
  }
};

const COLORS = [
  "#ff6b2b",
  "#ff2d6b",
  "#00ffaa",
  "#bf5fff",
  "#00c8ff",
  "#ffee00",
  "#39ff14",
  "#ff4df0",
  "#00fff7",
  "#ff9500",
];
const ANIMATIONS = ["sway", "walk", "jog", "bounce", "float", "swim-up"];
const EXPRESSIONS = ["normal", "happy", "angry", "surprised"];
const ACCESSORIES = ["none", "none", "long", "mohawk", "side-sweep", "curly"];
const HAIR_COLORS = [
  "#4a2c0a",
  "#1a1a1a",
  "#c8a04a",
  "#e04020",
  "#f5f5f5",
  "#6b3fa0",
  "#2a6e3f",
  "#1e90ff",
];

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)] as T;

const randomAppearance = () => ({
  color: pick(COLORS),
  octopus: {
    animation: pick(ANIMATIONS),
    expression: pick(EXPRESSIONS),
    accessory: pick(ACCESSORIES),
    hairColor: pick(HAIR_COLORS),
  },
});

const parseFlag = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
};

const tentacleCreate = async () => {
  const name = args[2];
  if (!name || name.startsWith("-")) {
    console.error(t(locale, "cli.error.tentacleNameRequired"));
    process.exit(1);
  }

  const description = parseFlag("--description") ?? parseFlag("-d") ?? "";
  const { color, octopus } = randomAppearance();
  const apiBase = await resolveApiBase();

  try {
    const response = await fetch(`${apiBase}/api/deck/tentacles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, color, octopus }),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      console.error(`Error: ${data.error ?? "Failed"}`);
      process.exit(1);
    }
    console.log(t(locale, "cli.created.tentacle", { id: String(data.tentacleId ?? "") }));
  } catch {
    apiError();
  }
};

const tentacleList = async () => {
  const apiBase = await resolveApiBase();

  try {
    const response = await fetch(`${apiBase}/api/deck/tentacles`);
    if (!response.ok) {
      console.error(t(locale, "cli.error.fetchTentacles"));
      process.exit(1);
    }

    const tentacles = (await response.json()) as Array<Record<string, unknown>>;
    if (tentacles.length === 0) {
      console.log(t(locale, "cli.empty.tentacles"));
      return;
    }

    for (const tentacle of tentacles) {
      const description = tentacle.description ? ` — ${tentacle.description}` : "";
      console.log(`  ${tentacle.tentacleId}${description}`);
    }
  } catch {
    apiError();
  }
};

const terminalCreate = async () => {
  const parsed = parseTerminalCreateArgs(args);
  if (!parsed.ok) {
    console.error(t(locale, parsed.errorKey, parsed.params));
    process.exit(1);
  }
  const { body } = parsed;
  const tentacleId = typeof body.tentacleId === "string" ? body.tentacleId : undefined;
  const apiBase = await resolveApiBase();

  try {
    const response = await fetch(`${apiBase}/api/terminals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      console.error(`Error: ${data.error ?? "Failed"}`);
      process.exit(1);
    }
    console.log(
      t(locale, "cli.created.terminal", {
        id: String(data.terminalId ?? ""),
        tentacleId: String(data.tentacleId ?? tentacleId ?? ""),
      }),
    );
    if (!tentacleId) {
      // Orchestrators keep creating a tentacle and then forgetting to attach
      // terminals to it; say where the terminal actually landed.
      console.log(t(locale, "cli.created.terminalOctobossHint"));
    }
    const usageWarning = formatUsageWarning(data, locale);
    if (usageWarning) {
      console.warn(usageWarning);
    }
  } catch {
    apiError();
  }
};

const terminalList = async () => {
  const isArchivedOnly = args.includes("--archived");
  const apiBase = await resolveApiBase();

  try {
    const query = isArchivedOnly ? "?includeArchived=1" : "";
    const response = await fetch(`${apiBase}/api/terminal-snapshots${query}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      console.error(t(locale, "cli.error.fetchTerminals"));
      process.exit(1);
    }

    const snapshots = (await response.json()) as Array<Record<string, unknown>>;
    const terminals = isArchivedOnly
      ? snapshots.filter((snapshot) => typeof snapshot.archivedAt === "string")
      : snapshots;
    if (terminals.length === 0) {
      console.log(t(locale, isArchivedOnly ? "cli.empty.archived" : "cli.empty.terminals"));
      return;
    }

    for (const terminal of terminals) {
      console.log(formatTerminalListLine(terminal, Date.now()));
    }
  } catch {
    apiError();
  }
};

type SnapshotRecord = Record<string, unknown>;

const fetchTerminalSnapshots = async (apiBase: string): Promise<SnapshotRecord[] | null> => {
  const response = await fetch(`${apiBase}/api/terminal-snapshots?includeArchived=1`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as SnapshotRecord[];
};

// The agent's answer lives in the conversation store (written on its Stop
// hook), not on the terminal record; a missing conversation just means no
// turn has ended yet.
const fetchConversationTurns = async (apiBase: string, terminalId: string): Promise<unknown> => {
  const response = await fetch(`${apiBase}/api/conversations/${encodeURIComponent(terminalId)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as { turns?: unknown };
  return data.turns ?? null;
};

const printTerminalResult = (result: TerminalResult, json: boolean) => {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  const agent = [result.agentProvider, result.model].filter(Boolean).join(" · ");
  console.log(`== ${result.terminalId}${agent ? `  (${agent})` : ""}`);
  console.log(
    `  ${t(locale, "cli.result.state")}: ${result.lifecycleState}${result.lifecycleReason ? ` (${result.lifecycleReason})` : ""}`,
  );
  if (result.attentionKind && result.attentionSince) {
    console.log(
      `  ${t(locale, "cli.result.attention")}: ${t(locale, result.attentionKind === "permission" ? "cli.result.attentionPermission" : "cli.result.attentionUser")}${result.attentionToolName ? `: ${result.attentionToolName}` : ""} (${t(locale, "cli.result.attentionSince", { since: result.attentionSince })})`,
    );
  }
  if (result.providerError) {
    console.log(`  ${formatProviderErrorLine(result.providerError, locale)}`);
  }
  // Shared-mode workers never commit, so their summary is all zeros; printing
  // it read as "no output" in a real review (2026-09-09).
  const hasSummary =
    result.completionSummary !== null &&
    (result.completionSummary.commits.length > 0 || result.completionSummary.branch !== null);
  if (hasSummary && result.completionSummary) {
    const s = result.completionSummary;
    console.log(
      `  ${t(locale, "cli.result.summary")}: ${t(locale, "cli.result.summaryLine", {
        commits: s.commits.length,
        files: s.filesChanged,
        ins: s.insertions,
        del: s.deletions,
        branch: s.branch ?? "-",
        merged: s.merged ? "✓" : "✗",
      })}`,
    );
  }
  console.log(`  ${t(locale, "cli.result.answer")}:`);
  if (result.lastAssistantMessage) {
    for (const line of result.lastAssistantMessage.split("\n")) {
      console.log(`    ${line}`);
    }
  } else {
    console.log(`    ${t(locale, "cli.result.noAnswer")}`);
  }
  if (result.screen !== undefined) {
    console.log(`  ${t(locale, "cli.screen.heading")}:`);
    console.log(formatScreen(result.screen, locale));
  }
};

const resolveTerminalResult = async (
  apiBase: string,
  snapshot: SnapshotRecord,
): Promise<TerminalResult> =>
  buildTerminalResult(snapshot, await fetchConversationTurns(apiBase, String(snapshot.terminalId)));

const terminalResult = async () => {
  const terminalId = args[2];
  if (!terminalId || terminalId.startsWith("-")) {
    console.error(t(locale, "cli.error.terminalIdRequired"));
    process.exit(1);
  }
  const json = args.includes("--json");
  const apiBase = await resolveApiBase();
  try {
    const snapshots = await fetchTerminalSnapshots(apiBase);
    if (!snapshots) {
      console.error(t(locale, "cli.error.fetchTerminals"));
      process.exit(1);
    }
    const snapshot = snapshots.find((entry) => entry.terminalId === terminalId);
    if (!snapshot) {
      console.error(t(locale, "cli.error.terminalNotFound", { id: terminalId }));
      process.exit(1);
    }
    const result = await resolveTerminalResult(apiBase, snapshot);
    if (args.includes("--screen"))
      result.screen = await fetchTerminalScreen(apiBase, terminalId, 20);
    printTerminalResult(result, json);
  } catch {
    apiError();
  }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const terminalWait = async () => {
  const parsed = parseTerminalWaitArgs(args.slice(2));
  if (!parsed.ok) {
    console.error(t(locale, parsed.errorKey, parsed.flag ? { flag: parsed.flag } : undefined));
    process.exit(1);
  }
  const { terminalIds, timeoutMs, attentionAfterMs, intervalMs, json } = parsed;
  const apiBase = await resolveApiBase();
  const startedAt = Date.now();
  const lastSeen = new Map<string, string>();
  try {
    while (true) {
      const snapshots = await fetchTerminalSnapshots(apiBase);
      if (!snapshots) {
        console.error(t(locale, "cli.error.fetchTerminals"));
        process.exit(1);
      }
      const byId = new Map(snapshots.map((entry) => [String(entry.terminalId), entry] as const));
      for (const terminalId of terminalIds) {
        if (!byId.has(terminalId)) {
          console.error(t(locale, "cli.error.terminalNotFound", { id: terminalId }));
          process.exit(1);
        }
      }
      const pending: string[] = [];
      for (const terminalId of terminalIds) {
        const snapshot = byId.get(terminalId) as SnapshotRecord;
        const state = String(snapshot.lifecycleState ?? snapshot.state ?? "unknown");
        if (!json && lastSeen.get(terminalId) !== state) {
          console.log(`  ${terminalId}  ${state}`);
          lastSeen.set(terminalId, state);
        }
        if (!isSettledLifecycle(state)) {
          pending.push(terminalId);
        }
      }
      const attention = terminalIds
        .map((id) => byId.get(id) as SnapshotRecord)
        .filter((snapshot) => needsAttention(snapshot, Date.now(), attentionAfterMs));
      if (attention.length > 0) {
        for (const snapshot of attention) {
          printTerminalResult(await resolveTerminalResult(apiBase, snapshot), json);
        }
        process.exit(3);
      }
      if (pending.length === 0) {
        let allWell = true;
        for (const terminalId of terminalIds) {
          const result = await resolveTerminalResult(
            apiBase,
            byId.get(terminalId) as SnapshotRecord,
          );
          allWell = allWell && result.finishedWell;
          printTerminalResult(result, json);
        }
        process.exit(allWell ? 0 : 1);
      }
      if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
        console.error(t(locale, "cli.wait.timeout", { ids: pending.join(", ") }));
        process.exit(2);
      }
      await sleep(intervalMs);
    }
  } catch {
    apiError();
  }
};

const terminalAction = async (action: "stop" | "kill") => {
  const terminalId = args[2];
  if (!terminalId || terminalId.startsWith("-")) {
    console.error(t(locale, "cli.error.terminalIdRequired"));
    process.exit(1);
  }

  const apiBase = await resolveApiBase();
  try {
    const response = await fetch(
      `${apiBase}/api/terminals/${encodeURIComponent(terminalId)}/${action}`,
      {
        method: "POST",
        headers: { Accept: "application/json" },
      },
    );
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      console.error(`Error: ${data.error ?? "Failed"}`);
      process.exit(1);
    }
    console.log(
      t(locale, action === "kill" ? "cli.killed.terminal" : "cli.stopped.terminal", {
        id: String(data.terminalId ?? ""),
      }),
    );
  } catch {
    apiError();
  }
};

const terminalArchive = async () => {
  const apiBase = await resolveApiBase();

  if (args.includes("--all-completed")) {
    try {
      const response = await fetch(`${apiBase}/api/terminals/archive-completed`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json()) as { archivedTerminalIds?: string[]; error?: unknown };
      if (!response.ok) {
        console.error(`Error: ${data.error ?? "Failed"}`);
        process.exit(1);
      }

      const archivedTerminalIds = data.archivedTerminalIds ?? [];
      if (archivedTerminalIds.length === 0) {
        console.log(t(locale, "cli.empty.completed"));
        return;
      }
      console.log(t(locale, "cli.archived.terminals", { count: archivedTerminalIds.length }));
    } catch {
      apiError();
    }
    return;
  }

  const terminalId = args[2];
  if (!terminalId || terminalId.startsWith("-")) {
    console.error(t(locale, "cli.error.terminalIdRequired"));
    process.exit(1);
  }

  try {
    const response = await fetch(
      `${apiBase}/api/terminals/${encodeURIComponent(terminalId)}/archive`,
      {
        method: "POST",
        headers: { Accept: "application/json" },
      },
    );
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      console.error(`Error: ${data.error ?? "Failed"}`);
      process.exit(1);
    }
    console.log(t(locale, "cli.archived.terminal", { id: String(data.terminalId ?? "") }));
  } catch {
    apiError();
  }
};

const terminalDelete = async () => {
  const terminalId = args[2];
  if (!terminalId || terminalId.startsWith("-")) {
    console.error(t(locale, "cli.error.terminalIdRequired"));
    process.exit(1);
  }
  const withWorktree = args.includes("--with-worktree");
  const force = args.includes("--force");
  const apiBase = await resolveApiBase();

  try {
    if (withWorktree) {
      // Removing a worktree can destroy unmerged work, so confirm the cost
      // first and refuse without --force when there are unmerged commits.
      const previewResponse = await fetch(
        `${apiBase}/api/terminals/${encodeURIComponent(terminalId)}/delete-preview`,
        { headers: { Accept: "application/json" } },
      );
      const preview = (await previewResponse.json()) as {
        error?: unknown;
        sharedWithTerminalIds?: string[];
        unmergedCommitCount?: number;
        branch?: string | null;
      };
      if (!previewResponse.ok) {
        console.error(`Error: ${preview.error ?? "Failed"}`);
        process.exit(1);
      }
      const shared = preview.sharedWithTerminalIds ?? [];
      if (shared.length > 0) {
        console.error(t(locale, "cli.delete.sharedWorktree", { ids: shared.join(", ") }));
        process.exit(1);
      }
      const unmerged = preview.unmergedCommitCount ?? 0;
      if (unmerged > 0 && !force) {
        console.error(
          t(locale, "cli.delete.unmergedWarning", {
            count: unmerged,
            branch: preview.branch ?? "?",
          }),
        );
        process.exit(1);
      }
    }

    const response = await fetch(
      `${apiBase}/api/terminals/${encodeURIComponent(terminalId)}${withWorktree ? "?removeWorktree=true" : ""}`,
      { method: "DELETE", headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      console.error(`Error: ${data.error ?? "Failed"}`);
      process.exit(1);
    }
    console.log(
      t(locale, withWorktree ? "cli.deleted.terminalWithWorktree" : "cli.deleted.terminal", {
        id: terminalId,
      }),
    );
  } catch {
    apiError();
  }
};

const terminalPrune = async () => {
  const apiBase = await resolveApiBase();

  try {
    const response = await fetch(`${apiBase}/api/terminals/prune`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const data = (await response.json()) as { prunedTerminalIds?: string[]; error?: unknown };
    if (!response.ok) {
      console.error(`Error: ${data.error ?? "Failed"}`);
      process.exit(1);
    }

    const prunedTerminalIds = data.prunedTerminalIds ?? [];
    if (prunedTerminalIds.length === 0) {
      console.log(t(locale, "cli.empty.stale"));
      return;
    }
    console.log(t(locale, "cli.pruned", { count: prunedTerminalIds.length }));
  } catch {
    apiError();
  }
};

const worktreeGc = async () => {
  const isDryRun = args.includes("--dry-run");
  const apiBase = await resolveApiBase();

  try {
    const response = await fetch(`${apiBase}/api/worktrees/gc${isDryRun ? "?dryRun=1" : ""}`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const data = (await response.json()) as {
      candidates?: Array<{ worktreeId: string; terminalIds: string[] }>;
      reclaimedWorktreeIds?: string[];
      failedWorktreeIds?: string[];
      error?: unknown;
    };
    if (!response.ok) {
      console.error(`Error: ${data.error ?? "Failed"}`);
      process.exit(1);
    }

    const candidates = data.candidates ?? [];
    if (candidates.length === 0) {
      console.log(t(locale, "cli.empty.reclaimableWorktrees"));
      return;
    }

    if (isDryRun) {
      console.log(t(locale, "cli.worktreeGc.dryRun", { count: candidates.length }));
      for (const candidate of candidates) {
        console.log(`  ${candidate.worktreeId}  (${candidate.terminalIds.join(", ")})`);
      }
      return;
    }

    const reclaimedWorktreeIds = data.reclaimedWorktreeIds ?? [];
    const failedWorktreeIds = data.failedWorktreeIds ?? [];
    for (const worktreeId of reclaimedWorktreeIds) {
      console.log(`  ${worktreeId}  ok`);
    }
    for (const worktreeId of failedWorktreeIds) {
      console.log(`  ${worktreeId}  failed`);
    }
    console.log(t(locale, "cli.worktreeGc.reclaimed", { count: reclaimedWorktreeIds.length }));
    if (failedWorktreeIds.length > 0) {
      console.error(t(locale, "cli.worktreeGc.failed", { count: failedWorktreeIds.length }));
      process.exit(1);
    }
  } catch {
    apiError();
  }
};

const channelSend = async () => {
  const terminalId = args[2];
  if (!terminalId || terminalId.startsWith("-")) {
    console.error(t(locale, "cli.error.terminalIdRequired"));
    process.exit(1);
  }

  const fromTerminalId = parseFlag("--from") ?? process.env.OCTOGENT_SESSION_ID ?? "";
  const fromIndex = args.indexOf("--from");
  const message =
    fromIndex !== -1
      ? args
          .slice(3)
          .filter((_, index) => {
            const absoluteIndex = index + 3;
            return absoluteIndex !== fromIndex && absoluteIndex !== fromIndex + 1;
          })
          .join(" ")
          .trim()
      : args
          .slice(3)
          .filter((value) => !value.startsWith("--from"))
          .join(" ")
          .trim();

  if (!message) {
    console.error(t(locale, "cli.error.messageContentRequired"));
    process.exit(1);
  }

  const apiBase = await resolveApiBase();
  try {
    const response = await fetch(
      `${apiBase}/api/channels/${encodeURIComponent(terminalId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromTerminalId, content: message }),
      },
    );
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      console.error(`Error: ${data.error ?? "Failed"}`);
      process.exit(1);
    }
    console.log(
      t(locale, data.delivered === true ? "cli.sent.messageDelivered" : "cli.sent.messageQueued", {
        to: terminalId,
      }),
    );
    console.log(t(locale, "cli.sent.messageConfirmHint", { to: terminalId }));
  } catch {
    apiError();
  }
};

const channelList = async () => {
  const terminalId = args[2];
  if (!terminalId || terminalId.startsWith("-")) {
    console.error(t(locale, "cli.error.terminalIdRequired"));
    process.exit(1);
  }

  const apiBase = await resolveApiBase();
  try {
    const response = await fetch(
      `${apiBase}/api/channels/${encodeURIComponent(terminalId)}/messages`,
    );
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      console.error(`Error: ${data.error ?? "Failed"}`);
      process.exit(1);
    }

    const messages = (data.messages ?? []) as Array<Record<string, unknown>>;
    if (messages.length === 0) {
      console.log(t(locale, "cli.empty.messages", { id: terminalId }));
      return;
    }

    for (const message of messages) {
      console.log(formatChannelMessageLine(message));
    }
  } catch {
    apiError();
  }
};

const runHubCommand = async (subcommand: string | undefined): Promise<boolean> => {
  try {
    if (subcommand === "start") {
      if (args.includes("--foreground")) {
        await runHubForeground(hubContext);
        return true;
      }
      process.exit(await runHubStart(hubContext));
    }
    if (subcommand === "status") {
      process.exit(await runHubStatus(hubContext));
    }
    if (subcommand === "stop") {
      process.exit(await runHubStop(hubContext));
    }
    if (subcommand === "restart") {
      process.exit(await runHubRestart(hubContext, args.includes("--force")));
    }
    if (subcommand === "install-service") {
      const serviceOptions = {
        locale,
        binaryPath: join(PACKAGE_ROOT, "bin", "octogent"),
        bundlePath: join(PACKAGE_ROOT, "dist", "api", "cli.js"),
      };
      process.exit(
        args.includes("--remove")
          ? runHubRemoveService(serviceOptions)
          : await runHubInstallService(serviceOptions),
      );
    }
  } catch (error) {
    exitOnHubCliError(error);
  }
  return false;
};

const listProjects = () => {
  const registry = loadProjectsRegistry();
  const { projects } = registry;
  if (projects.length === 0) {
    console.log(t(locale, "cli.empty.projects"));
    return;
  }

  const cwd = process.cwd();
  const current = findCurrentProject(registry, cwd, findProjectConfigRoot(cwd));
  const slugOf = (project: (typeof projects)[number]) =>
    project.slug ?? toProjectSlug(project.name);
  const slugWidth = Math.max(...projects.map((project) => slugOf(project).length));
  const nameWidth = Math.max(...projects.map((project) => project.name.length));
  for (const project of projects) {
    const marker = project.id === current?.id ? "*" : " ";
    console.log(
      `${marker} ${slugOf(project).padEnd(slugWidth)}  ${project.name.padEnd(nameWidth)}  ${project.id}  ${project.path}`,
    );
  }
};

const main = async () => {
  if (!command || command === "start") {
    const handled = await runBareStart(hubContext, {
      argv: process.argv.slice(2),
      projectFlag,
      openBrowser: maybeOpenBrowser,
    }).catch(exitOnHubCliError);
    if (!handled) {
      return startServer();
    }
    return;
  }

  if (command === "hub" && (await runHubCommand(args[1]))) {
    return;
  }

  if (command === "init") {
    return initProject(args[1]);
  }

  if (command === "guide") {
    process.stdout.write(renderGuide(locale));
    return;
  }

  if (command === "setup-agents") {
    const remove = args.includes("--remove");
    const sourceDir = resolveRuntimeAssetPath(
      ["dist", "agents", "octogent"],
      ["agents", "octogent"],
    );
    if (!remove && !existsSync(join(sourceDir, "SKILL.md"))) {
      console.error(t(locale, "cli.setupAgents.missingSource", { path: sourceDir }));
      process.exit(1);
    }
    for (const result of setupAgentSkills(sourceDir, resolveAgentSkillTargets(), { remove })) {
      console.log(
        `  ${result.target.name.padEnd(12)} ${t(locale, `cli.setupAgents.${result.action}`)}  ${result.target.directory}`,
      );
    }
    if (!remove) {
      console.log(t(locale, "cli.setupAgents.done"));
    }
    return;
  }

  if (command === "projects" || command === "project") {
    return listProjects();
  }

  if (command === "logs") {
    return printServerLogs();
  }

  if (command === "tentacle" || command === "tentacles") {
    if (args[1] === "create") {
      return tentacleCreate();
    }
    if (args[1] === "list" || args[1] === "ls") {
      return tentacleList();
    }
  }

  if (command === "terminal" || command === "terminals") {
    if (args[1] === "create") {
      return terminalCreate();
    }
    if (args[1] === "list" || args[1] === "ls") {
      return terminalList();
    }
    if (args[1] === "stop") {
      return terminalAction("stop");
    }
    if (args[1] === "kill") {
      return terminalAction("kill");
    }
    if (args[1] === "archive") {
      return terminalArchive();
    }
    if (args[1] === "prune") {
      return terminalPrune();
    }
    if (args[1] === "delete" || args[1] === "rm") {
      return terminalDelete();
    }
    if (args[1] === "wait") {
      return terminalWait();
    }
    if (args[1] === "screen" || args[1] === "input") {
      try {
        await (args[1] === "screen" ? runTerminalScreen : runTerminalInput)(
          args.slice(2),
          await resolveApiBase(),
          locale,
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
      return;
    }
    if (args[1] === "result") {
      return terminalResult();
    }
  }

  if (command === "worktree" || command === "worktrees") {
    if (args[1] === "gc") {
      return worktreeGc();
    }
  }

  if (command === "channel") {
    if (args[1] === "send") {
      return channelSend();
    }
    if (args[1] === "list" || args[1] === "ls") {
      return channelList();
    }
  }

  console.log(`Usage:
  ${t(locale, "cli.help.start")}
  ${t(locale, "cli.help.standalone")}
  octogent init [project-name]         Initialize the current directory explicitly
  octogent projects                    List registered projects (* marks the current one)
  ${t(locale, "cli.help.hub")}
  octogent logs [--lines N] [--follow] Tail the current project's server log
  octogent guide                       Print the coordinator's routine and the current command surface
  octogent setup-agents [--remove]     Install the Octogent skill for Claude Code and Codex (user level)

  ${t(locale, "cli.help.project")}
  octogent tentacle create <name>      Create a tentacle (Octogent must be running)
  octogent tentacle list               List tentacles
  octogent terminal create [options]   Create a terminal
    --name, -n                         Terminal display name
    --workspace-mode, -w               shared | worktree
    --initial-prompt, -p               Raw initial prompt text
    --terminal-id                      Explicit terminal ID
    --tentacle-id                      Existing tentacle ID to attach to
    --worktree-id                      Explicit worktree ID
    --parent-terminal-id               Parent terminal ID for child terminals
    --prompt-template                  Prompt template name
    --prompt-variables                 JSON object of prompt template variables
    --inherit-env                      ${t(locale, "cli.help.inheritEnv")}
  octogent terminal list               List terminal lifecycle state
    --archived                         List only archived terminal records
  octogent terminal stop <id>          Stop a terminal session
  octogent terminal kill <id>          Kill a terminal session or recorded process
  octogent terminal archive <id>       Archive a non-running terminal record
  octogent terminal archive --all-completed  Archive every completed terminal record
  octogent terminal prune              Remove stale, stopped, and exited terminal records
  octogent terminal wait <id> [<id>...] Wait until the terminals settle, then print their answers
    --timeout <seconds>                Give up after this long (default 0 = wait forever)
    --interval <seconds>               Poll interval (default 5)
    --attention-after <seconds>        Exit when a dialog needs attention (default 60; 0 disables)
    Exit codes: 0 = all finished well; 1 = other ending or error; 2 = timeout; 3 = needs attention
    --json                             One JSON object per terminal
  ${t(locale, "cli.help.screenInput")}
  octogent terminal result <id>        Print a terminal's state, summary, and final answer
    --json                             JSON instead of text
    --screen                           ${t(locale, "cli.help.resultScreen")}
  octogent worktree gc                 Reclaim worktrees and branches of merged, archived terminals
    --dry-run                          List reclaimable worktrees without removing them
  octogent channel send <id> <msg>     Send a channel message
  octogent channel list <id>           List channel messages`);
  process.exit(1);
};

main();
