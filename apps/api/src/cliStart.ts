import { existsSync } from "node:fs";

import { t } from "@octogent/core";

import { readLiveRuntimeMetadata, registerWithHub } from "./cliApiBase";
import {
  extractGlobalFlags,
  findCurrentProject,
  findGitRoot,
  findProjectConfigRoot,
} from "./cliApiTarget";
import {
  type HubCliContext,
  HubCliError,
  type PortOccupant,
  describePortOccupant,
  ensureHubRunning,
  inspectHubPort,
  readHubPort,
} from "./cliHub";
import { readLiveHubMetadata } from "./hubMetadata";
import { createDriftWarner } from "./hubVersionDrift";
import { resolveListenHost } from "./listenHost";
import { type ProjectRegistryEntry, loadProjectsRegistry } from "./projectPersistence";
import { resolveProjectKey, toProjectSlug } from "./projectSlug";

export type StartModeInput = {
  /** Everything after `octogent`, global flags included. */
  args: string[];
  /** hub.json names a hub that answers. */
  hubAlive: boolean;
  /** Who holds the hub's port; only consulted while no hub answers. */
  portHolder: PortOccupant["kind"];
  /** The registered project `--project` names, else the one the working directory is in. */
  registered: { slug: string } | null;
  /** Where the working directory's project would register from (its project.json or git root). */
  registrablePath: string | null;
  /** That project's own single-project server, while one answers. */
  ownServerUrl: string | null;
  /** False under OCTOGENT_NO_AUTOSTART=1. */
  autostart: boolean;
};

export type HubPage =
  | { kind: "project"; slug: string }
  | { kind: "register"; path: string }
  | { kind: "overview" };

export type StartMode =
  | { kind: "standalone" }
  | { kind: "own-server"; url: string }
  | { kind: "port-blocked" }
  | { kind: "autostart-disabled" }
  /** Use the hub, starting it first when none answers. */
  | { kind: "hub"; page: HubPage };

/** What bare `octogent` (or `octogent start`) does. */
export const resolveStartMode = ({
  args,
  hubAlive,
  portHolder,
  registered,
  registrablePath,
  ownServerUrl,
  autostart,
}: StartModeInput): StartMode => {
  if (extractGlobalFlags(args).standalone) {
    return { kind: "standalone" };
  }
  // CLI commands already talk to that server; the hub loading the same
  // project too would put two runtimes over one set of state files.
  if (ownServerUrl) {
    return { kind: "own-server", url: ownServerUrl };
  }
  if (!hubAlive) {
    // A hub on another port would be one no CLI finds.
    if (portHolder !== "free") {
      return { kind: "port-blocked" };
    }
    if (!autostart) {
      return { kind: "autostart-disabled" };
    }
  }
  if (registered) {
    return { kind: "hub", page: { kind: "project", slug: registered.slug } };
  }
  if (registrablePath) {
    return { kind: "hub", page: { kind: "register", path: registrablePath } };
  }
  return { kind: "hub", page: { kind: "overview" } };
};

type StartFacts = Omit<StartModeInput, "args"> & { occupant: PortOccupant };

const gatherStartFacts = async (
  context: HubCliContext,
  projectFlag: string | undefined,
): Promise<StartFacts> => {
  const env = context.env ?? process.env;
  const cwd = process.cwd();
  const cwdProject = findProjectConfigRoot(cwd);
  const gitRoot = findGitRoot(cwd);
  const registry = loadProjectsRegistry();

  let project: ProjectRegistryEntry | null;
  if (projectFlag !== undefined) {
    const key = projectFlag.trim();
    if (!key) {
      throw new HubCliError(t(context.locale, "cli.hub.projectFlagEmpty"));
    }
    project = resolveProjectKey(registry, key);
    if (!project) {
      throw new HubCliError(t(context.locale, "cli.hub.unknownProject", { key }));
    }
  } else {
    project = findCurrentProject(registry, cwd, cwdProject);
  }

  // runtime.json describes cwd's project, so --project keeps it only for that same workspace.
  const runtime = await readLiveRuntimeMetadata(cwd, cwdProject, gitRoot);
  const ownServerUrl =
    runtime && (projectFlag === undefined || project?.path === runtime.workspaceCwd)
      ? runtime.apiBaseUrl
      : null;
  const hubAlive = (await readLiveHubMetadata()) !== null;
  const occupant: PortOccupant =
    hubAlive || ownServerUrl
      ? { kind: "free" }
      : await inspectHubPort(readHubPort(env), resolveListenHost(env));

  return {
    hubAlive,
    portHolder: occupant.kind,
    occupant,
    registered: project ? { slug: project.slug ?? toProjectSlug(project.name) } : null,
    registrablePath: project || projectFlag !== undefined ? null : (cwdProject?.root ?? gitRoot),
    ownServerUrl,
    autostart: env.OCTOGENT_NO_AUTOSTART !== "1",
  };
};

// --standalone needs none of the lookups, and a port probe can take seconds.
const STANDALONE_FACTS: StartFacts = {
  hubAlive: false,
  portHolder: "free",
  occupant: { kind: "free" },
  registered: null,
  registrablePath: null,
  ownServerUrl: null,
  autostart: true,
};

export type BareStartOptions = {
  /** The command line after `octogent`, global flags included. */
  argv: string[];
  projectFlag: string | undefined;
  openBrowser: (url: string) => void;
};

/**
 * Bare `octogent`: open the project's page on the hub, starting the hub and
 * registering the project as needed. False when a single-project server
 * should start instead (`--standalone`).
 */
export const runBareStart = async (
  context: HubCliContext,
  { argv, projectFlag, openBrowser }: BareStartOptions,
): Promise<boolean> => {
  const { locale } = context;
  const env = context.env ?? process.env;
  // A server without the web bundle answers only the API; there is no page to open.
  const openPage = (url: string) => {
    if (existsSync(context.webDistDir)) {
      openBrowser(url);
    }
  };
  const facts = extractGlobalFlags(argv).standalone
    ? STANDALONE_FACTS
    : await gatherStartFacts(context, projectFlag);
  const mode = resolveStartMode({ args: argv, ...facts });

  switch (mode.kind) {
    case "standalone":
      return false;
    case "own-server":
      console.log(t(locale, "cli.start.ownServer", { url: mode.url }));
      console.log(`  ${t(locale, "cli.start.ownServerHint")}`);
      openPage(mode.url);
      return true;
    case "port-blocked":
      throw new HubCliError(
        `${describePortOccupant(locale, readHubPort(env), facts.occupant)}\n${t(locale, "cli.start.blockedStandalone")}`,
      );
    case "autostart-disabled":
      throw new HubCliError(t(locale, "cli.hub.autostartDisabled"));
    case "hub":
      break;
  }

  const hub = await ensureHubRunning(context, { announce: true });
  createDriftWarner(context.build, locale, (line) => console.error(line))(hub);
  const hubBaseUrl = hub.apiBaseUrl.replace(/\/+$/, "");

  let url: string;
  switch (mode.page.kind) {
    case "project":
      url = `${hubBaseUrl}/p/${encodeURIComponent(mode.page.slug)}/`;
      console.log(t(locale, "cli.start.project", { slug: mode.page.slug, url }));
      break;
    case "register": {
      const registered = await registerWithHub(hubBaseUrl, mode.page.path, context);
      if (registered.created) {
        console.log(
          t(locale, "cli.hub.registered", { path: mode.page.path, slug: registered.slug }),
        );
      }
      url = `${hubBaseUrl}/p/${encodeURIComponent(registered.slug)}/`;
      console.log(t(locale, "cli.start.project", { slug: registered.slug, url }));
      break;
    }
    case "overview":
      url = `${hubBaseUrl}/`;
      console.log(t(locale, "cli.start.overview", { url }));
      break;
  }
  if (!facts.hubAlive) {
    console.log(`  ${t(locale, "cli.start.hubStarted")}`);
  }
  openPage(url);
  return true;
};
