import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { basename, join, resolve } from "node:path";

import { DEFAULT_LOCALE, type Locale, t } from "@octogent/core";
import { parseTerminalCreateArgs } from "./cliTerminalCreate";
import {
  type TerminalResult,
  buildTerminalResult,
  isSettledLifecycle,
  parseTerminalWaitArgs,
} from "./cliTerminalResult";
import { generateAccessToken, resolveAccessToken } from "./createApiServer/remoteAuth";
import {
  isRemoteAccessEnabled,
  isWildcardHost,
  listLanAddresses,
  resolveListenHost,
  toConnectableHost,
} from "./listenHost";
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
import { clearRuntimeMetadata, readRuntimeMetadata, writeRuntimeMetadata } from "./runtimeMetadata";
import {
  collectStartupPrerequisiteReport,
  formatStartupPrerequisiteReport,
} from "./startupPrerequisites";

const locale: Locale = (process.env.OCTOGENT_LOCALE as Locale) ?? DEFAULT_LOCALE;

const args = process.argv.slice(2);
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
  console.log(t(locale, "cli.init.ready"));
};

const canListenOnPort = (port: number, host: string): Promise<boolean> =>
  new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, host);
  });

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

const resolveRuntimeApiBase = () => {
  const explicitBase =
    process.env.OCTOGENT_API_ORIGIN?.trim() || process.env.OCTOGENT_API_BASE?.trim();
  if (explicitBase) {
    return explicitBase;
  }

  const projectConfig = loadProjectConfig(process.cwd());
  if (projectConfig) {
    const projectStateDir = resolveProjectStateDir(process.cwd(), projectConfig.displayName);
    const runtimeMetadata = readRuntimeMetadata(projectStateDir);
    if (runtimeMetadata) {
      return runtimeMetadata.apiBaseUrl;
    }
  }

  return `http://127.0.0.1:${readPreferredStartPort()}`;
};

const apiError = () => {
  console.error(t(locale, "cli.error.apiUnreachable", { url: resolveRuntimeApiBase() }));
  process.exit(1);
};

const maybeOpenBrowser = (url: string) => {
  if (process.env.OCTOGENT_NO_OPEN === "1" || process.env.CI === "1") {
    return;
  }

  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd", args: ["/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };

  try {
    const child = spawn(command.file, command.args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  } catch {
    // Best-effort browser open.
  }
};

const startServer = async () => {
  const startupPrerequisiteReport = collectStartupPrerequisiteReport();
  const startupPrerequisiteLines = formatStartupPrerequisiteReport(
    startupPrerequisiteReport,
    locale,
  );
  if (startupPrerequisiteLines.length > 0) {
    for (const line of startupPrerequisiteLines) {
      if (startupPrerequisiteReport.errors.length > 0) {
        console.error(line);
      } else {
        console.warn(line);
      }
    }
    if (startupPrerequisiteReport.errors.length > 0) {
      process.exit(1);
    }
    console.warn("");
  }

  const workspaceCwd = process.cwd();
  const { isInitialized, projectDisplayName, projectStateDir } =
    resolveStartupProjectContext(workspaceCwd);
  const promptsDir = resolveRuntimeAssetPath(["dist", "prompts"], ["prompts"]);
  const webDistDir = resolveRuntimeAssetPath(["dist", "web"], ["apps", "web", "dist"]);
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

  console.log();
  console.log(`  ${t(locale, "cli.server.running")}`);
  console.log(`  ${t(locale, "cli.server.project")} ${workspaceCwd}`);
  console.log(`  ${t(locale, "cli.server.api")} ${apiBaseUrl}`);
  if (isWildcardHost(host)) {
    for (const address of listLanAddresses(networkInterfaces())) {
      const suffix = accessToken ? `/?token=${accessToken}` : "";
      console.log(`  ${t(locale, "cli.server.lan")} http://${address}:${activePort}${suffix}`);
    }
    if (accessToken) {
      console.log(`  ${t(locale, "cli.server.token")} ${accessToken}`);
      console.log(`  ${t(locale, "cli.server.tokenHint")}`);
    }
  }
  console.log();
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
  const apiBase = resolveRuntimeApiBase();

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
  const apiBase = resolveRuntimeApiBase();

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
  const apiBase = resolveRuntimeApiBase();

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
  } catch {
    apiError();
  }
};

const terminalList = async () => {
  const isArchivedOnly = args.includes("--archived");
  const apiBase = resolveRuntimeApiBase();

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
      const terminalId = String(terminal.terminalId ?? "");
      const name = String(terminal.tentacleName ?? terminal.label ?? terminalId);
      const lifecycle = String(terminal.lifecycleState ?? terminal.state ?? "unknown");
      const pid =
        typeof terminal.processId === "number" && Number.isFinite(terminal.processId)
          ? ` pid=${terminal.processId}`
          : "";
      const reason =
        typeof terminal.lifecycleReason === "string" ? ` reason=${terminal.lifecycleReason}` : "";
      const modelValue =
        typeof terminal.agentModel === "string"
          ? terminal.agentModel
          : typeof terminal.agentModelObserved === "string"
            ? terminal.agentModelObserved
            : null;
      const provider =
        typeof terminal.agentProvider === "string" ? ` agent=${terminal.agentProvider}` : "";
      const model = modelValue ? ` model=${modelValue}` : "";
      console.log(`  ${terminalId}  ${lifecycle}${pid}${provider}${model}${reason}  ${name}`);
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
  const apiBase = resolveRuntimeApiBase();
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
    printTerminalResult(await resolveTerminalResult(apiBase, snapshot), json);
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
  const { terminalIds, timeoutMs, intervalMs, json } = parsed;
  const apiBase = resolveRuntimeApiBase();
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

  const apiBase = resolveRuntimeApiBase();
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
  const apiBase = resolveRuntimeApiBase();

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
  const apiBase = resolveRuntimeApiBase();

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
  const apiBase = resolveRuntimeApiBase();

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
  const apiBase = resolveRuntimeApiBase();

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

  const apiBase = resolveRuntimeApiBase();
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

  const apiBase = resolveRuntimeApiBase();
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
      const status = message.delivered ? "delivered" : "pending";
      console.log(
        `  [${message.messageId}] from=${message.fromTerminalId || "(unknown)"} status=${status}: ${message.content}`,
      );
    }
  } catch {
    apiError();
  }
};

const main = async () => {
  if (!command || command === "start") {
    return startServer();
  }

  if (command === "init") {
    return initProject(args[1]);
  }

  if (command === "projects" || command === "project") {
    const projects = loadProjectsRegistry().projects;
    if (projects.length === 0) {
      console.log(t(locale, "cli.empty.projects"));
      return;
    }

    for (const project of projects) {
      console.log(`  ${project.name}  ${project.id}  ${project.path}`);
    }
    return;
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
  octogent                             Start the dashboard in the current project
  octogent init [project-name]         Initialize the current directory explicitly
  octogent projects                    List registered projects

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
    --json                             One JSON object per terminal
  octogent terminal result <id>        Print a terminal's state, summary, and final answer
    --json                             JSON instead of text
  octogent worktree gc                 Reclaim worktrees and branches of merged, archived terminals
    --dry-run                          List reclaimable worktrees without removing them
  octogent channel send <id> <msg>     Send a channel message
  octogent channel list <id>           List channel messages`);
  process.exit(1);
};

main();
