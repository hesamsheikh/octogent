import { existsSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";
import type { Duplex } from "node:stream";

import type { TerminalLifecycleState } from "@octogent/core";

import {
  assertSecureRemoteBinding,
  evaluateRemoteAuth,
  isLoopbackAddress,
  resolveAccessToken,
} from "./createApiServer/remoteAuth";
import { guardApiRequest } from "./createApiServer/requestHandler";
import {
  readJsonBodyOrWriteError,
  writeJson,
  writeMethodNotAllowed,
  writeNoContent,
} from "./createApiServer/routeHelpers";
import { getRequestCorsOrigin, readHeaderValue } from "./createApiServer/security";
import { serveWebApp } from "./createApiServer/staticFiles";
import { isUpgradeAllowed } from "./createApiServer/upgradeHandler";
import { type ProjectContext, createProjectContext } from "./createProjectContext";
import { type TerminalHealthCounts, createHealthSnapshotSource } from "./healthSnapshot";
import { type HubProjectRegistry, createFileProjectRegistry } from "./hubProjectRegistry";
import type { BuildIdentity } from "./hubVersionDrift";
import { toConnectableHost } from "./listenHost";
import { log, logError, logVerbose } from "./logging";
import type { ProjectRegistryEntry } from "./projectPersistence";
import { resolveProjectKey, toProjectSlug } from "./projectSlug";
import type { GitClient } from "./terminalRuntime";

/** Per project: lower than a lone server's default, since the hub cap is shared. */
const HUB_DEFAULT_SESSIONS_PER_PROJECT = 12;
const HUB_DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_PROJECT_IDLE_MS = 30 * 60_000;
// The sweep's granularity: an idle project goes at most this long past its period.
const MAX_IDLE_SWEEP_MS = 60_000;

const PROJECT_API_MOUNT = /^\/api\/p\/([^/]+)(\/.*)?$/;
const PROJECT_WEB_MOUNT = /^\/p\/[^/]+(\/.*)?$/;

export type CreateHubServerOptions = {
  registry?: HubProjectRegistry;
  webDistDir?: string | undefined;
  promptsDir?: string | undefined;
  accessToken?: string | null;
  /** The address agents dial; defaults to the bound address once start() listens. */
  hubBaseUrl?: string | undefined;
  gitClient?: GitClient;
  /** Hub-wide PTY session cap; defaults to OCTOGENT_HUB_MAX_TERMINAL_SESSIONS, then 32. */
  maxTotalSessions?: number;
  /** Per-project cap; defaults to OCTOGENT_MAX_TERMINAL_SESSIONS when set, else 12. */
  maxSessionsPerProject?: number;
  /**
   * How long a loaded project may go without sessions or requests before it
   * is unloaded; 0 keeps every project loaded. Defaults to
   * OCTOGENT_HUB_PROJECT_IDLE_MS, then 30 minutes.
   */
  projectIdleMs?: number;
  /** The build this hub runs, as hub.json records it; its health reports it too. */
  build?: BuildIdentity | undefined;
};

type LoadedProject = {
  context: ProjectContext;
  slug: string;
  /** Requests still being answered; a response's `close` ends one. */
  inFlight: number;
  /** Last time the project was seen busy or asked for anything (ms). */
  lastActiveAt: number;
};

class ProjectUnavailableError extends Error {}

const readPositiveInteger = (raw: string | undefined): number | undefined => {
  const parsed = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined;
};

/** OCTOGENT_HUB_PROJECT_IDLE_MS; 0 disables unloading, anything unparsable falls back. */
export const readProjectIdleMs = (raw: string | undefined): number => {
  const trimmed = raw?.trim();
  const parsed = Number(trimmed);
  return trimmed && Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_PROJECT_IDLE_MS;
};

const formatDuration = (ms: number): string =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;

const isExistingDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const matchProjectMount = (pathname: string): { key: string; rest: string } | null => {
  const match = PROJECT_API_MOUNT.exec(pathname);
  if (!match) {
    return null;
  }
  try {
    return { key: decodeURIComponent(match[1] ?? ""), rest: match[2] ?? "/" };
  } catch {
    // A malformed escape cannot name any project.
    return { key: "", rest: "/" };
  }
};

const sumHealthCounts = (counts: TerminalHealthCounts[]): TerminalHealthCounts => {
  const terminals: Record<TerminalLifecycleState, number> = {
    registered: 0,
    running: 0,
    stopped: 0,
    exited: 0,
    stale: 0,
    stalled: 0,
    "awaiting-review": 0,
    completed: 0,
  };
  let ptySessions = 0;
  let terminalEventClients = 0;
  for (const entry of counts) {
    ptySessions += entry.ptySessions;
    terminalEventClients += entry.terminalEventClients;
    for (const state of Object.keys(terminals) as TerminalLifecycleState[]) {
      terminals[state] += entry.terminals[state];
    }
  }
  return { ptySessions, terminals, terminalEventClients };
};

/**
 * One process serving every registered project. Projects load lazily on the
 * first request that names them (`/api/p/<slug-or-id>/…`) and unload again
 * once idle; each gets its own context and an API base scoped to its id, so
 * hooks and the in-worker CLI reach exactly that project.
 */
export const createHubServer = ({
  registry = createFileProjectRegistry(),
  webDistDir,
  promptsDir,
  accessToken: configuredAccessToken = resolveAccessToken(process.env),
  hubBaseUrl,
  gitClient,
  maxTotalSessions = readPositiveInteger(process.env.OCTOGENT_HUB_MAX_TERMINAL_SESSIONS) ??
    HUB_DEFAULT_MAX_SESSIONS,
  maxSessionsPerProject,
  projectIdleMs = readProjectIdleMs(process.env.OCTOGENT_HUB_PROJECT_IDLE_MS),
  build,
}: CreateHubServerOptions = {}) => {
  const accessToken = configuredAccessToken?.trim() || null;
  let remoteBinding = false;
  const isRemoteBinding = () => remoteBinding;
  const guardOptions = { isRemoteBinding, accessToken };
  let boundBaseUrl = "http://127.0.0.1:8787";
  const getHubBaseUrl = () => (hubBaseUrl ?? boundBaseUrl).replace(/\/+$/, "");
  // Leaving the runtime's option unset lets it honor OCTOGENT_MAX_TERMINAL_SESSIONS itself.
  const perProjectSessions =
    maxSessionsPerProject ??
    (process.env.OCTOGENT_MAX_TERMINAL_SESSIONS?.trim()
      ? undefined
      : HUB_DEFAULT_SESSIONS_PER_PROJECT);
  const resolvedWebDistDir = webDistDir && existsSync(webDistDir) ? webDistDir : null;
  const hubHealth = createHealthSnapshotSource();
  const loaded = new Map<string, LoadedProject>();
  // Contexts still flushing their state after an unload, by project id.
  const unloading = new Map<string, Promise<void>>();
  let idleSweep: NodeJS.Timeout | null = null;

  const readTotals = () =>
    sumHealthCounts([...loaded.values()].map(({ context }) => context.runtime.readHealthCounts()));

  const checkSessionAdmission = (): string | null =>
    readTotals().ptySessions >= maxTotalSessions
      ? `Hub terminal session limit reached (${maxTotalSessions}) across all projects. Close a terminal session in any project or increase OCTOGENT_HUB_MAX_TERMINAL_SESSIONS.`
      : null;

  const loadProject = (entry: ProjectRegistryEntry): LoadedProject => {
    const existing = loaded.get(entry.id);
    if (existing) {
      return existing;
    }
    // Loading scaffolds .octogent/ in the workspace, which would quietly
    // recreate a directory the operator deleted or moved.
    if (!isExistingDirectory(entry.path)) {
      throw new ProjectUnavailableError(`Project directory not found: ${entry.path}`);
    }

    const { projectId, projectStateDir } = registry.prepare(entry);
    const alreadyLoaded = loaded.get(projectId);
    if (alreadyLoaded) {
      return alreadyLoaded;
    }

    const slug = entry.slug ?? toProjectSlug(entry.name);
    const context = createProjectContext({
      workspaceCwd: entry.path,
      projectStateDir,
      promptsDir,
      projectId,
      projectName: entry.name,
      // The id, never the slug: this base is baked into hook files and PTY
      // environments that outlive a rename.
      apiBaseUrl: () => `${getHubBaseUrl()}/api/p/${encodeURIComponent(projectId)}`,
      isRemoteBinding,
      maxConcurrentSessions: perProjectSessions,
      checkSessionAdmission,
      logPrefix: `[${slug}]`,
      ...(gitClient ? { gitClient } : {}),
    });
    const project: LoadedProject = { context, slug, inFlight: 0, lastActiveAt: Date.now() };
    loaded.set(projectId, project);
    log(`[Hub] Loaded project ${slug} (${projectId}) at ${entry.path}`);
    return project;
  };

  const resolveProject = async (key: string): Promise<LoadedProject | null> => {
    // Hooks and worker CLIs address projects by id, so that path skips the registry read.
    const loadedById = loaded.get(key);
    if (loadedById) {
      return loadedById;
    }
    const entry = key.length > 0 ? resolveProjectKey(registry.load(), key) : null;
    if (!entry) {
      return null;
    }
    // A fresh context must not read the registry and transcripts while the
    // unloaded one is still writing them out.
    await unloading.get(entry.id);
    return loadProject(entry);
  };

  const isProjectBusy = ({ context, inFlight }: LoadedProject): boolean => {
    const counts = context.runtime.readHealthCounts();
    // A live PTY covers running and awaiting-review terminals alike. An open
    // dashboard holds the terminal-events socket; unloading under it would
    // only make the page reconnect and load the project straight back.
    return inFlight > 0 || counts.ptySessions > 0 || counts.terminalEventClients > 0;
  };

  const unloadProject = (projectId: string, project: LoadedProject) => {
    loaded.delete(projectId);
    const stopping = project.context
      .stop()
      .catch((error: unknown) => {
        logError(
          `[Hub] Failed to stop idle project ${project.slug} (${projectId})`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
      })
      .finally(() => {
        unloading.delete(projectId);
      });
    unloading.set(projectId, stopping);
    log(
      `[Hub] Unloaded project ${project.slug} (${projectId}): no sessions or requests for ${formatDuration(projectIdleMs)}`,
    );
  };

  const sweepIdleProjects = () => {
    const now = Date.now();
    for (const [projectId, project] of loaded) {
      if (isProjectBusy(project)) {
        // Idle time counts from the end of the last session, not from the
        // last request: a worker can run for hours without calling the API.
        project.lastActiveAt = now;
      } else if (now - project.lastActiveAt >= projectIdleMs) {
        unloadProject(projectId, project);
      }
    }
  };

  const toProjectListing = (entry: ProjectRegistryEntry) => {
    const project = loaded.get(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      slug: entry.slug ?? toProjectSlug(entry.name),
      path: entry.path,
      loaded: project !== undefined,
      ...(project ? { summary: project.context.describe() } : {}),
    };
  };

  const handleRegisterProject = async (
    request: IncomingMessage,
    response: ServerResponse,
    corsOrigin: string | null,
  ) => {
    // The guard already admits only loopback or token holders; registering a
    // path grants full-access agents that directory, so it re-checks rather
    // than rely on the guard never being loosened.
    const auth = evaluateRemoteAuth({
      remoteAddress: request.socket.remoteAddress,
      url: request.url ?? "/",
      headers: {
        "x-octogent-token": request.headers["x-octogent-token"],
        cookie: request.headers.cookie,
      },
      accessToken,
    });
    if (auth.kind === "deny") {
      writeJson(response, 401, { error: "Access token required." }, corsOrigin);
      return;
    }

    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) {
      return;
    }
    const payload = (body.payload ?? {}) as Record<string, unknown>;
    const rawPath = typeof payload.path === "string" ? payload.path.trim() : "";
    if (!rawPath || !isAbsolute(rawPath)) {
      writeJson(response, 400, { error: "path must be an absolute path." }, corsOrigin);
      return;
    }
    const workspaceCwd = resolve(rawPath);
    if (!isExistingDirectory(workspaceCwd)) {
      writeJson(response, 400, { error: `Not a directory: ${workspaceCwd}` }, corsOrigin);
      return;
    }
    const name =
      typeof payload.name === "string" && payload.name.trim().length > 0
        ? payload.name.trim()
        : undefined;

    const knownIds = new Set(registry.load().projects.map((project) => project.id));
    let entry: ProjectRegistryEntry;
    try {
      entry = registry.register(workspaceCwd, name);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      writeJson(response, 400, { error: `Cannot register ${workspaceCwd}: ${reason}` }, corsOrigin);
      return;
    }
    log(`[Hub] Registered project ${entry.slug ?? entry.name} (${entry.id}) at ${workspaceCwd}`);
    // By id, not path: a moved workspace keeps its project.json and so its entry.
    writeJson(response, knownIds.has(entry.id) ? 200 : 201, toProjectListing(entry), corsOrigin);
  };

  const handleHubRoute = async (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    corsOrigin: string | null,
  ): Promise<boolean> => {
    if (pathname === "/api/hub/health") {
      if (request.method !== "GET") {
        writeMethodNotAllowed(response, corsOrigin);
        return true;
      }
      writeJson(
        response,
        200,
        {
          ...hubHealth.readHealthSnapshot(readTotals()),
          // The same identity hub.json carries, for whoever only has the address.
          ...build,
          pid: process.pid,
          maxTerminalSessions: maxTotalSessions,
          projects: { registered: registry.load().projects.length, loaded: loaded.size },
          loadedProjects: [...loaded.values()].map(({ context, slug }) => ({
            id: context.projectId,
            slug,
            ptySessions: context.runtime.readHealthCounts().ptySessions,
          })),
        },
        corsOrigin,
      );
      return true;
    }

    if (pathname === "/api/projects") {
      if (request.method === "GET") {
        writeJson(
          response,
          200,
          { projects: registry.load().projects.map(toProjectListing) },
          corsOrigin,
        );
      } else if (request.method === "POST") {
        await handleRegisterProject(request, response, corsOrigin);
      } else {
        writeMethodNotAllowed(response, corsOrigin);
      }
      return true;
    }

    return false;
  };

  const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
    if (!guardApiRequest(request, response, guardOptions)) {
      return;
    }
    const startTime = Date.now();
    const method = request.method ?? "?";
    const corsOrigin = getRequestCorsOrigin(
      readHeaderValue(request.headers.origin),
      readHeaderValue(request.headers.host),
      remoteBinding,
    );

    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const { pathname } = requestUrl;

      if (method === "OPTIONS") {
        writeNoContent(response, 204, corsOrigin);
        return;
      }

      const mount = matchProjectMount(pathname);
      if (mount) {
        let project: LoadedProject | null;
        try {
          project = await resolveProject(mount.key);
        } catch (error) {
          if (!(error instanceof ProjectUnavailableError)) {
            throw error;
          }
          writeJson(response, 404, { error: error.message }, corsOrigin);
          return;
        }
        if (!project) {
          writeJson(response, 404, { error: `Unknown project: ${mount.key}` }, corsOrigin);
          return;
        }
        const active = project;
        active.inFlight += 1;
        active.lastActiveAt = Date.now();
        // `close` rather than the handler's promise: it also fires for a
        // response that streams on after the handler returns, or a client
        // that hangs up mid-request.
        response.once("close", () => {
          active.inFlight -= 1;
          active.lastActiveAt = Date.now();
        });
        // Mount semantics: the project's routes only ever see their own paths.
        request.url = `${mount.rest}${requestUrl.search}`;
        await active.context.handleRequest(request, response);
        return;
      }

      if (await handleHubRoute(request, response, pathname, corsOrigin)) {
        logVerbose(
          `[Hub] ${method} ${pathname} ${response.statusCode} ${Date.now() - startTime}ms`,
        );
        return;
      }

      if (resolvedWebDistDir && method === "GET" && !pathname.startsWith("/api/")) {
        // /p/<key>/… is a client-side route of the one SPA; built assets are
        // referenced absolutely, but a relative one resolves here too.
        const webMount = PROJECT_WEB_MOUNT.exec(pathname);
        const webPath = webMount ? (webMount[1] ?? "/") : pathname;
        if (await serveWebApp(response, resolvedWebDistDir, webPath)) {
          return;
        }
      }

      writeJson(response, 404, { error: "Not found" }, corsOrigin);
    } catch (error) {
      logError(
        `[Hub] Unhandled error: ${method} ${request.url ?? "/"}`,
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      if (!response.headersSent) {
        writeJson(response, 500, { error: "Internal server error" }, corsOrigin);
      }
    }
  };

  const upgradeToProject = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const mount = matchProjectMount(requestUrl.pathname);
      const project = mount ? await resolveProject(mount.key) : null;
      if (!mount || !project) {
        socket.destroy();
        return;
      }
      project.lastActiveAt = Date.now();
      request.url = `${mount.rest}${requestUrl.search}`;
      project.context.handleUpgrade(request, socket, head);
    } catch {
      socket.destroy();
    }
  };

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isUpgradeAllowed(request, guardOptions)) {
      socket.destroy();
      return;
    }
    void upgradeToProject(request, socket, head);
  };

  const server = createServer(handleRequest);
  server.on("upgrade", handleUpgrade);

  return {
    server,
    hubBaseUrl: getHubBaseUrl,
    async start(port = 8787, host = "127.0.0.1") {
      await new Promise<void>((resolveStart, rejectStart) => {
        const onError = (error: Error) => rejectStart(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          const boundAddress = typeof address === "object" && address ? address.address : host;
          remoteBinding = !isLoopbackAddress(boundAddress);

          try {
            assertSecureRemoteBinding(boundAddress, accessToken);
            resolveStart();
          } catch (error) {
            server.close(() => rejectStart(error));
          }
        });
      });

      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      // A wildcard bind is not a destination; hooks and worker CLIs must dial something real.
      boundBaseUrl = `http://${toConnectableHost(host)}:${resolvedPort}`;
      if (projectIdleMs > 0 && !idleSweep) {
        idleSweep = setInterval(sweepIdleProjects, Math.min(projectIdleMs, MAX_IDLE_SWEEP_MS));
        idleSweep.unref();
      }
      return { host, port: resolvedPort };
    },
    async stop() {
      if (idleSweep) {
        clearInterval(idleSweep);
        idleSweep = null;
      }
      hubHealth.close();
      const projects = [...loaded.values()];
      loaded.clear();
      await Promise.allSettled([
        ...projects.map(({ context }) => context.stop()),
        ...unloading.values(),
      ]);
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolveStop, rejectStop) => {
        server.close((error) => {
          if (error) {
            rejectStop(error);
            return;
          }
          resolveStop();
        });
        server.closeAllConnections();
      });
    },
  };
};
