import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureHubRunning } from "../src/cliHub";
import { runHubInstallService, runHubRemoveService } from "../src/cliHubService";
import { clearHubMetadata, writeHubMetadata } from "../src/hubMetadata";
import {
  type CommandResult,
  type CommandRunner,
  isHubServiceInstalled,
  renderHubUnit,
  withDirectoryOnPath,
} from "../src/hubServiceUnit";
import { resolveGlobalOctogentDir } from "../src/projectPersistence";

describe("renderHubUnit", () => {
  it("runs the launcher's hub in the foreground from the home directory", () => {
    expect(
      renderHubUnit({
        binaryPath: "/opt/octogent/bin/octogent",
        home: "/home/ada",
        envFileExists: true,
        path: "/home/ada/.nvm/versions/node/v22.9.0/bin:/usr/bin:/bin",
      }),
    ).toBe(
      [
        "# Written by `octogent hub install-service`. Run it again after moving the",
        "# Octogent checkout or switching Node versions; `--remove` uninstalls it.",
        "[Unit]",
        "Description=Octogent hub",
        "StartLimitIntervalSec=120",
        "StartLimitBurst=5",
        "",
        "[Service]",
        "Type=simple",
        "ExecStart=/opt/octogent/bin/octogent hub start --foreground",
        "WorkingDirectory=/home/ada",
        "# The installing shell's PATH: the launcher's node and the agents' CLIs live there.",
        'Environment="PATH=/home/ada/.nvm/versions/node/v22.9.0/bin:/usr/bin:/bin"',
        'Environment="OCTOGENT_HOME=/home/ada/.octogent"',
        "EnvironmentFile=-/home/ada/.octogent/hub.env",
        "Restart=on-failure",
        "RestartSec=3",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
    );
  });

  it("references hub.env even before it exists, and says how to add one", () => {
    const unit = renderHubUnit({
      binaryPath: "/opt/octogent/bin/octogent",
      home: "/home/ada",
      envFileExists: false,
    });
    // `-` makes a missing file fine, so adding one later needs no reinstall.
    expect(unit).toContain("EnvironmentFile=-/home/ada/.octogent/hub.env");
    expect(unit).toContain(
      "# For more variables, write KEY=value lines to /home/ada/.octogent/hub.env and restart the hub.",
    );
    expect(unit).not.toContain("PATH=");
  });

  it("serves a relocated state root", () => {
    const unit = renderHubUnit({
      binaryPath: "/opt/octogent/bin/octogent",
      home: "/home/ada",
      envFileExists: true,
      octogentHome: "/srv/octogent-state",
    });
    expect(unit).toContain('Environment="OCTOGENT_HOME=/srv/octogent-state"');
    expect(unit).toContain("EnvironmentFile=-/srv/octogent-state/hub.env");
  });

  it("escapes what systemd would otherwise expand or split", () => {
    const unit = renderHubUnit({
      binaryPath: '/home/ada/My Tools/100%$HOME/"o"/octogent',
      home: "/home/ada%",
      envFileExists: false,
      path: '/a b:/c"d:/e%f',
    });
    expect(unit).toContain(
      'ExecStart="/home/ada/My Tools/100%%$$HOME/\\"o\\"/octogent" hub start --foreground',
    );
    expect(unit).toContain("WorkingDirectory=/home/ada%%");
    expect(unit).toContain('Environment="PATH=/a b:/c\\"d:/e%%f"');
  });
});

describe("withDirectoryOnPath", () => {
  it("puts node's directory first unless PATH already has it", () => {
    expect(withDirectoryOnPath("/usr/bin:/bin", "/opt/node/bin")).toBe(
      "/opt/node/bin:/usr/bin:/bin",
    );
    expect(withDirectoryOnPath("/usr/bin:/opt/node/bin", "/opt/node/bin")).toBe(
      "/usr/bin:/opt/node/bin",
    );
    expect(withDirectoryOnPath(undefined, "/opt/node/bin")).toBe(
      "/opt/node/bin:/usr/local/bin:/usr/bin:/bin",
    );
  });
});

type Call = { file: string; args: string[] };

const ok = (stdout = ""): CommandResult => ({ status: 0, stdout, stderr: "" });

const fakeRunner = (
  respond: (call: Call) => CommandResult | undefined = () => undefined,
): { runner: CommandRunner; calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    runner: (file, args) => {
      const call = { file, args };
      calls.push(call);
      return respond(call) ?? ok();
    },
  };
};

describe("octogent hub install-service", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
    rmSync(join(resolveGlobalOctogentDir(), "hub.env"), { force: true });
  });

  const makeSetup = () => {
    const root = mkdtempSync(join(tmpdir(), "octogent-service-"));
    temporaryDirectories.push(root);
    const binaryPath = join(root, "checkout", "bin", "octogent");
    const bundlePath = join(root, "checkout", "dist", "api", "cli.js");
    for (const file of [binaryPath, bundlePath]) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "");
    }
    const home = join(root, "home");
    const env = { XDG_CONFIG_HOME: join(home, ".config"), PATH: "/usr/bin:/bin" };
    const lines: string[] = [];
    return {
      home,
      unitPath: join(home, ".config", "systemd", "user", "octogent-hub.service"),
      lines,
      options: {
        locale: "en" as const,
        binaryPath,
        bundlePath,
        env,
        home,
        nodePath: "/opt/node/bin/node",
        username: "ada",
        platform: "linux" as const,
        print: (line: string) => lines.push(line),
        // The fake systemctl starts no hub; the wait is covered by its own test.
        waitForHubMs: 0,
      },
    };
  };

  it("writes the unit, reloads systemd, and enables it now", async () => {
    const { unitPath, lines, options } = makeSetup();
    writeFileSync(join(resolveGlobalOctogentDir(), "hub.env"), "OCTOGENT_HUB_PORT=9100\n");
    const { runner, calls } = fakeRunner(({ file }) =>
      file === "loginctl" ? ok("yes\n") : undefined,
    );

    expect(await runHubInstallService({ ...options, runner })).toBe(0);

    const unit = readFileSync(unitPath, "utf8");
    expect(unit).toContain(`ExecStart=${options.binaryPath} hub start --foreground`);
    expect(unit).toContain(`WorkingDirectory=${options.home}`);
    expect(unit).toContain('Environment="PATH=/opt/node/bin:/usr/bin:/bin"');
    expect(unit).toContain(`EnvironmentFile=-${join(resolveGlobalOctogentDir(), "hub.env")}`);
    expect(calls.map(({ file, args }) => [file, ...args].join(" "))).toEqual([
      "systemctl --user show-environment",
      "systemctl --user daemon-reload",
      "systemctl --user enable --now octogent-hub.service",
      "loginctl show-user ada --property=Linger --value",
    ]);
    expect(lines.join("\n")).toContain(unitPath);
    expect(lines.join("\n")).not.toContain("enable-linger");
    // What a CLI checks before starting the hub through this unit.
    expect(isHubServiceInstalled(options.env, options.home, resolveGlobalOctogentDir())).toBe(true);
    expect(isHubServiceInstalled(options.env, options.home, "/elsewhere/.octogent")).toBe(false);
  });

  it("waits for the unit's hub and prints its address", async () => {
    const { lines, options } = makeSetup();
    // Stands in for the hub systemd starts: it answers health as this process.
    const fakeHub = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", pid: process.pid, version: "0.0.0" }));
    });
    const fakeHubPort = await new Promise<number>((resolvePort) => {
      fakeHub.listen(0, "127.0.0.1", () => {
        const address = fakeHub.address();
        resolvePort(typeof address === "object" && address ? address.port : 0);
      });
    });
    try {
      const { runner } = fakeRunner(({ args }) => {
        if (args.join(" ") === `--user enable --now ${"octogent-hub.service"}`) {
          writeHubMetadata({
            apiBaseUrl: `http://127.0.0.1:${fakeHubPort}`,
            host: "127.0.0.1",
            port: fakeHubPort,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            version: "0.0.0",
          });
        }
        return undefined;
      });

      expect(await runHubInstallService({ ...options, runner, waitForHubMs: 5_000 })).toBe(0);
      expect(lines.join("\n")).toContain(`Hub running at http://127.0.0.1:${fakeHubPort}`);
    } finally {
      clearHubMetadata();
      await new Promise<void>((resolveClose) => fakeHub.close(() => resolveClose()));
    }
  });

  it("says when the unit's hub has not answered in time", async () => {
    const { lines, options } = makeSetup();
    const { runner } = fakeRunner();

    expect(await runHubInstallService({ ...options, runner, waitForHubMs: 200 })).toBe(0);
    expect(lines.join("\n")).toContain("The hub has not answered yet");
  });

  it("advises lingering when it is off", async () => {
    const { lines, options } = makeSetup();
    const { runner } = fakeRunner(({ file }) => (file === "loginctl" ? ok("no\n") : undefined));

    await runHubInstallService({ ...options, runner });

    expect(lines.join("\n")).toContain("loginctl enable-linger ada");
    expect(lines.join("\n")).toContain("hub.env");
  });

  it("fails clearly without systemd, before writing anything", async () => {
    const { unitPath, options } = makeSetup();
    const { runner, calls } = fakeRunner();
    await expect(runHubInstallService({ ...options, platform: "darwin", runner })).rejects.toThrow(
      /only on Linux/,
    );
    expect(calls).toEqual([]);

    const missing = fakeRunner(() => ({
      status: null,
      stdout: "",
      stderr: "",
      error: Object.assign(new Error("spawnSync systemctl ENOENT"), { code: "ENOENT" }),
    }));
    await expect(runHubInstallService({ ...options, runner: missing.runner })).rejects.toThrow(
      /systemctl was not found/,
    );

    const noBus = fakeRunner(() => ({
      status: 1,
      stdout: "",
      stderr: "Failed to connect to bus: No medium found\n",
    }));
    await expect(runHubInstallService({ ...options, runner: noBus.runner })).rejects.toThrow(
      /user manager is not reachable \(Failed to connect to bus: No medium found\)/,
    );
    expect(existsSync(unitPath)).toBe(false);
  });

  it("refuses an unbuilt checkout", async () => {
    const { unitPath, options } = makeSetup();
    rmSync(options.bundlePath);
    await expect(runHubInstallService({ ...options, runner: fakeRunner().runner })).rejects.toThrow(
      /pnpm build/,
    );
    expect(existsSync(unitPath)).toBe(false);
  });

  it("reports a failing systemctl step", async () => {
    const { options } = makeSetup();
    const { runner } = fakeRunner(({ args }) =>
      args.includes("enable")
        ? { status: 1, stdout: "", stderr: "Unit octogent-hub.service is masked." }
        : undefined,
    );
    await expect(runHubInstallService({ ...options, runner })).rejects.toThrow(
      "`systemctl --user enable --now octogent-hub.service` failed: Unit octogent-hub.service is masked.",
    );
  });

  it("--remove disables without stopping, deletes the unit, and reloads", async () => {
    const { unitPath, lines, options } = makeSetup();
    await runHubInstallService({ ...options, runner: fakeRunner().runner });
    const { runner, calls } = fakeRunner();

    expect(runHubRemoveService({ ...options, runner })).toBe(0);

    expect(existsSync(unitPath)).toBe(false);
    expect(calls.map(({ args }) => args.join(" "))).toEqual([
      "--user show-environment",
      "--user disable octogent-hub.service",
      "--user daemon-reload",
    ]);
    expect(lines.at(-1)).toContain("octogent hub stop");

    const again = fakeRunner();
    expect(runHubRemoveService({ ...options, runner: again.runner })).toBe(0);
    expect(again.calls.map(({ args }) => args.join(" "))).toEqual(["--user show-environment"]);
    expect(lines.at(-1)).toContain("not installed");
  });
});

describe("starting the hub with its service installed", () => {
  const cleanups: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  const listen = async (server: Server): Promise<number> => {
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    cleanups.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const address = server.address();
    return typeof address === "object" && address ? address.port : 0;
  };

  it("asks systemd to start it rather than spawning one systemd would not know", async () => {
    const root = mkdtempSync(join(tmpdir(), "octogent-service-start-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const env = { XDG_CONFIG_HOME: join(root, "config") };
    const unitDir = join(root, "config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(
      join(unitDir, "octogent-hub.service"),
      renderHubUnit({
        binaryPath: "/opt/octogent/bin/octogent",
        home: root,
        envFileExists: false,
        octogentHome: resolveGlobalOctogentDir(),
      }),
    );

    // Stands in for the hub systemd starts: it answers health as this process.
    const fakeHub = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", pid: process.pid, version: "0.0.0" }));
    });
    const fakeHubPort = await listen(fakeHub);
    const hubPort = await listen(createServer());
    // Freed again: the start checks the hub's own port is free first.
    await cleanups.pop()?.();
    cleanups.push(() => clearHubMetadata());

    const { runner, calls } = fakeRunner(({ args }) => {
      if (args.join(" ") === "--user start octogent-hub.service") {
        writeHubMetadata({
          apiBaseUrl: `http://127.0.0.1:${fakeHubPort}`,
          host: "127.0.0.1",
          port: fakeHubPort,
          pid: process.pid,
          startedAt: new Date().toISOString(),
          version: "0.0.0",
        });
      }
      return undefined;
    });

    const metadata = await ensureHubRunning({
      locale: "en",
      build: { version: "0.0.0" },
      webDistDir: join(root, "no-web"),
      promptsDir: join(root, "no-prompts"),
      env: { ...env, OCTOGENT_HUB_PORT: String(hubPort) },
      runCommand: runner,
    });

    expect(calls.map(({ file, args }) => [file, ...args].join(" "))).toEqual([
      "systemctl --user start octogent-hub.service",
    ]);
    expect(metadata.apiBaseUrl).toBe(`http://127.0.0.1:${fakeHubPort}`);
  });
});
