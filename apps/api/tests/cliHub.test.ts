import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { collectBusyTerminals, readHubPort } from "../src/cliHub";
import { isProcessAlive, readHubMetadata } from "../src/hubMetadata";

describe("readHubPort", () => {
  it("defaults to 8787 and honors a valid OCTOGENT_HUB_PORT", () => {
    expect(readHubPort({})).toBe(8787);
    expect(readHubPort({ OCTOGENT_HUB_PORT: "9100" })).toBe(9100);
    expect(readHubPort({ OCTOGENT_HUB_PORT: "nope" })).toBe(8787);
    expect(readHubPort({ OCTOGENT_HUB_PORT: "70000" })).toBe(8787);
  });

  it("does not follow the single-project port variables", () => {
    // The hub's port is fixed so every CLI finds it; OCTOGENT_API_PORT is
    // the per-project server's starting point.
    expect(readHubPort({ OCTOGENT_API_PORT: "9200", PORT: "9300" })).toBe(8787);
  });
});

describe("collectBusyTerminals", () => {
  it("lists running and awaiting-review terminals per project", () => {
    const busy = collectBusyTerminals([
      {
        slug: "alpha",
        snapshots: [
          { terminalId: "t1", lifecycleState: "running" },
          { terminalId: "t2", lifecycleState: "completed" },
          { terminalId: "t3", lifecycleState: "awaiting-review" },
          { terminalId: "t4", lifecycleState: "running", archivedAt: "2026-09-01" },
        ],
      },
      { slug: "beta", snapshots: [{ terminalId: "t5", lifecycleState: "stopped" }] },
    ]);

    expect(busy).toEqual([
      { slug: "alpha", terminalId: "t1", lifecycleState: "running" },
      { slug: "alpha", terminalId: "t3", lifecycleState: "awaiting-review" },
    ]);
  });
});

const API_ROOT = resolve(import.meta.dirname, "..");
const CLI_ENTRY = join(API_ROOT, "src", "cli.ts");
// Absolute, because the daemonized hub inherits these flags but runs from the
// state root, where a bare `tsx` specifier does not resolve.
const TSX_LOADER = pathToFileURL(join(API_ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;

// The tests spawn the real CLI; nothing of the calling shell may steer it
// towards a real server (this suite also runs inside Octogent workers).
const SCRUBBED_VARIABLES = [
  "OCTOGENT_API_BASE",
  "OCTOGENT_API_ORIGIN",
  "OCTOGENT_API_PORT",
  "OCTOGENT_PROJECT_ID",
  "OCTOGENT_SESSION_ID",
  "OCTOGENT_ACCESS_TOKEN",
  "OCTOGENT_ALLOW_REMOTE_ACCESS",
  "OCTOGENT_SERVER_LOG",
  "OCTOGENT_VERBOSE_LOGS",
  "OCTOGENT_NO_AUTOSTART",
  "OCTOGENT_BUILD_COMMIT",
  "HOST",
  "PORT",
];

type CliResult = { code: number | null; stdout: string; stderr: string };

const reservePort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((resolveListen) => probe.listen(0, "127.0.0.1", resolveListen));
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
  return port;
};

const waitFor = async <T>(
  probe: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) {
      return value;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

describe("octogent hub (end to end)", () => {
  const temporaryDirectories: string[] = [];
  const children: ChildProcess[] = [];
  const servers: Server[] = [];
  const hubPids: number[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    // Daemonized hubs are not our children; never leave one running.
    for (const pid of hubPids.splice(0)) {
      if (isProcessAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolveClose) => server.close(() => resolveClose()))),
    );
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const makeDirectory = (prefix: string) => {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    temporaryDirectories.push(directory);
    return directory;
  };

  const makeEnvironment = async () => {
    const home = makeDirectory("octogent-hub-home-");
    // Startup refuses without an agent CLI; a stub keeps the test independent of the machine.
    const binDir = join(home, "bin");
    mkdirSync(binDir);
    writeFileSync(join(binDir, "claude"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(binDir, "claude"), 0o755);
    const port = await reservePort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OCTOGENT_HOME: home,
      OCTOGENT_HUB_PORT: String(port),
      OCTOGENT_NO_OPEN: "1",
      OCTOGENT_LOCALE: "en",
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    };
    for (const key of SCRUBBED_VARIABLES) {
      delete env[key];
    }
    return { home, port, env, apiBaseUrl: `http://127.0.0.1:${port}` };
  };

  const spawnCli = (args: string[], env: NodeJS.ProcessEnv, cwd = API_ROOT) =>
    spawn(process.execPath, ["--import", TSX_LOADER, CLI_ENTRY, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

  const runCli = (args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<CliResult> =>
    new Promise((resolveRun, rejectRun) => {
      const child = spawnCli(args, env, cwd);
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", rejectRun);
      child.on("close", (code) => resolveRun({ code, stdout, stderr }));
    });

  const waitForHub = (home: string, pid?: number) =>
    waitFor(
      () => {
        const metadata = readHubMetadata(home);
        return metadata && (pid === undefined || metadata.pid === pid) ? metadata : null;
      },
      20_000,
      "hub.json",
    );

  it("hub start --foreground serves, hub status sees it, hub stop ends it", async () => {
    const { home, port, env, apiBaseUrl } = await makeEnvironment();
    const hub = spawnCli(["hub", "start", "--foreground"], env);
    children.push(hub);

    const metadata = await waitForHub(home, hub.pid);
    expect(metadata).toMatchObject({ apiBaseUrl, host: "127.0.0.1", port, pid: hub.pid });
    expect(metadata.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isNaN(Date.parse(metadata.startedAt))).toBe(false);

    const health = await fetch(`${apiBaseUrl}/api/hub/health`);
    expect(health.status).toBe(200);
    const logPath = join(home, "hub", "logs", "server.log");
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf8")).toContain(`port=${port}`);

    const status = await runCli(["hub", "status"], env);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(apiBaseUrl);
    expect(status.stdout).toContain(String(hub.pid));

    const exited = new Promise<number | null>((resolveExit) =>
      hub.on("exit", (code) => resolveExit(code)),
    );
    const stop = await runCli(["hub", "stop"], env);
    expect(stop.code).toBe(0);
    expect(await exited).toBe(0);
    expect(existsSync(join(home, "hub.json"))).toBe(false);

    const statusAfter = await runCli(["hub", "status"], env);
    expect(statusAfter.code).toBe(1);
  }, 60_000);

  it("hub start daemonizes, prints the address, and restart replaces an idle hub", async () => {
    const { home, env, apiBaseUrl } = await makeEnvironment();

    const start = await runCli(["hub", "start"], env);
    expect(start.code, start.stderr).toBe(0);
    expect(start.stdout).toContain(apiBaseUrl);
    const first = readHubMetadata(home);
    expect(first).not.toBeNull();
    hubPids.push(first?.pid as number);
    expect(isProcessAlive(first?.pid as number)).toBe(true);

    const again = await runCli(["hub", "start"], env);
    expect(again.code).toBe(0);
    expect(readHubMetadata(home)?.pid).toBe(first?.pid);

    const restart = await runCli(["hub", "restart"], env);
    expect(restart.code, restart.stderr).toBe(0);
    const second = readHubMetadata(home);
    hubPids.push(second?.pid as number);
    expect(second?.pid).not.toBe(first?.pid);
    expect(isProcessAlive(first?.pid as number)).toBe(false);

    const stop = await runCli(["hub", "stop"], env);
    expect(stop.code).toBe(0);
    expect(isProcessAlive(second?.pid as number)).toBe(false);
  }, 90_000);

  it("refuses a port held by a single-project server and names its pid", async () => {
    const { home, port, env } = await makeEnvironment();
    const occupant = createServer((_request, response) => {
      response.writeHead(404).end();
    });
    servers.push(occupant);
    await new Promise<void>((resolveListen) => occupant.listen(port, "127.0.0.1", resolveListen));
    mkdirSync(join(home, "projects", "old", "state"), { recursive: true });
    writeFileSync(
      join(home, "projects", "old", "state", "runtime.json"),
      JSON.stringify({
        apiBaseUrl: `http://127.0.0.1:${port}`,
        host: "127.0.0.1",
        port,
        pid: process.pid,
        startedAt: "2026-09-22T00:00:00.000Z",
        workspaceCwd: "/work/old-project",
      }),
    );

    const start = await runCli(["hub", "start", "--foreground"], env);

    expect(start.code).toBe(1);
    expect(start.stderr).toContain(`pid ${process.pid}`);
    expect(start.stderr).toContain(String(port));
    expect(start.stderr).toContain("/work/old-project");
    expect(existsSync(join(home, "hub.json"))).toBe(false);

    // Bare `octogent` says the same and offers the single-project server.
    const bare = await runCli([], env, makeDirectory("octogent-no-repo-"));
    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain(`pid ${process.pid}`);
    expect(bare.stderr).toContain("--standalone");
    expect(existsSync(join(home, "hub.json"))).toBe(false);
  }, 60_000);

  it("bare octogent starts the hub, registers the repository, and prints its page", async () => {
    const { home, env, apiBaseUrl } = await makeEnvironment();
    const repo = join(makeDirectory("octogent-hub-repo-"), "Bare Repo");
    mkdirSync(repo);
    spawnSync("git", ["init", "-q"], { cwd: repo });

    const first = await runCli([], env, repo);
    const metadata = readHubMetadata(home);
    if (metadata) {
      hubPids.push(metadata.pid);
    }
    expect(first.code, first.stderr).toBe(0);
    expect(metadata?.apiBaseUrl).toBe(apiBaseUrl);
    expect(first.stdout).toContain(`${apiBaseUrl}/p/bare-repo/`);
    expect(first.stdout).toContain("octogent hub stop");
    expect(existsSync(join(repo, ".octogent", "project.json"))).toBe(true);

    // Outside any project it opens the overview of the hub already running.
    const outside = await runCli([], env, makeDirectory("octogent-no-repo-"));
    expect(outside.code, outside.stderr).toBe(0);
    expect(outside.stdout).toContain(`${apiBaseUrl}/`);
    expect(outside.stdout).not.toContain("/p/");
    expect(outside.stdout).not.toContain("octogent hub stop");

    const byFlag = await runCli(["--project", "bare-repo"], env, home);
    expect(byFlag.code, byFlag.stderr).toBe(0);
    expect(byFlag.stdout).toContain(`${apiBaseUrl}/p/bare-repo/`);
    expect((await runCli(["--project", "nope"], env, home)).code).toBe(1);

    expect(readHubMetadata(home)?.pid).toBe(metadata?.pid);
    expect((await runCli(["hub", "stop"], env)).code).toBe(0);
  }, 90_000);

  it("auto-starts the hub and registers a git repository on first use", async () => {
    const { home, env, apiBaseUrl } = await makeEnvironment();
    const repo = join(makeDirectory("octogent-hub-repo-"), "Sample Repo");
    mkdirSync(repo);
    spawnSync("git", ["init", "-q"], { cwd: repo });

    const disabled = await runCli(
      ["terminal", "list"],
      { ...env, OCTOGENT_NO_AUTOSTART: "1" },
      repo,
    );
    expect(disabled.code).toBe(1);
    expect(disabled.stderr).toContain("OCTOGENT_NO_AUTOSTART");
    expect(existsSync(join(home, "hub.json"))).toBe(false);

    const first = await runCli(["terminal", "list"], env, repo);
    const metadata = readHubMetadata(home);
    if (metadata) {
      hubPids.push(metadata.pid);
    }
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain("No terminals found.");
    expect(first.stderr).toContain("sample-repo");
    expect(metadata?.apiBaseUrl).toBe(apiBaseUrl);
    expect(existsSync(join(repo, ".octogent", "project.json"))).toBe(true);

    const second = await runCli(["terminal", "list"], env, join(repo, ".octogent"));
    expect(second.code).toBe(0);
    expect(second.stderr).not.toContain("sample-repo");

    const projects = await runCli(["projects"], env, repo);
    expect(projects.stdout).toMatch(/^\* +sample-repo +Sample Repo/m);

    // Bare `octogent` opens the project on the running hub.
    const bare = await runCli([], env, repo);
    expect(bare.code, bare.stderr).toBe(0);
    expect(bare.stdout).toContain(`${apiBaseUrl}/p/sample-repo/`);
    expect(readHubMetadata(home)?.pid).toBe(metadata?.pid);

    const outside = await runCli(["terminal", "list"], env, makeDirectory("octogent-no-repo-"));
    expect(outside.code).toBe(1);
    expect(outside.stderr).toContain("--project");

    const byFlag = await runCli(["terminal", "list", "--project", "sample-repo"], env, home);
    expect(byFlag.code, byFlag.stderr).toBe(0);

    expect((await runCli(["hub", "stop"], env)).code).toBe(0);
  }, 90_000);
});
