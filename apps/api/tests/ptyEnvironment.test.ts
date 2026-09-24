import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as logging from "../src/logging";
import {
  createBaseEnvironment,
  createShellEnvironment,
  ensureProjectEnvTemplate,
  loadProjectEnvironment,
} from "../src/terminalRuntime/ptyEnvironment";

const TOUCHED = ["CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE"] as const;
const saved = new Map<string, string | undefined>();
const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of TOUCHED) {
    const value = saved.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  saved.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const stub = (key: (typeof TOUCHED)[number], value: string) => {
  if (!saved.has(key)) {
    saved.set(key, process.env[key]);
  }
  process.env[key] = value;
};

const createWorkspace = () => {
  const directory = mkdtempSync(join(tmpdir(), "octogent-pty-env-test-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, ".octogent"), { recursive: true });
  return directory;
};

// What a server started from a developer's shell (inside a venv, inside a
// Claude Code session, with unrelated secrets exported) might carry.
const SERVER_ENV: NodeJS.ProcessEnv = {
  HOME: "/home/dev",
  USER: "dev",
  LOGNAME: "dev",
  SHELL: "/bin/zsh",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  LC_CTYPE: "UTF-8",
  TZ: "Asia/Shanghai",
  PATH: "/home/dev/other/.venv/bin:/usr/local/bin:/usr/bin",
  TMPDIR: "/tmp/dev",
  XDG_RUNTIME_DIR: "/run/user/1000",
  XDG_CONFIG_HOME: "/home/dev/.config",
  SSH_AUTH_SOCK: "/run/ssh.sock",
  DISPLAY: ":0",
  WAYLAND_DISPLAY: "wayland-0",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/bus",
  ANTHROPIC_API_KEY: "sk-ant",
  ANTHROPIC_BASE_URL: "https://proxy.example",
  CLAUDE_CODE_USE_BEDROCK: "1",
  CLAUDE_CONFIG_DIR: "/home/dev/.claude-work",
  CODEX_HOME: "/home/dev/.codex",
  OPENAI_API_KEY: "sk-openai",
  OCTOGENT_LOCALE: "zh-CN",
  NODE_OPTIONS: "--max-old-space-size=4096",
  NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
  NVM_DIR: "/home/dev/.nvm",
  HTTP_PROXY: "http://proxy:3128",
  HTTPS_PROXY: "http://proxy:3128",
  NO_PROXY: "localhost",
  ALL_PROXY: "socks5://proxy:1080",
  http_proxy: "http://proxy:3128",
  https_proxy: "http://proxy:3128",
  no_proxy: "localhost",
  all_proxy: "socks5://proxy:1080",
  SSL_CERT_FILE: "/etc/ca.pem",
  SSL_CERT_DIR: "/etc/ssl/certs",
  TERM: "screen",
  // Must not reach workers.
  AWS_SECRET_ACCESS_KEY: "aws-secret",
  DATABASE_URL: "postgres://prod",
  VIRTUAL_ENV: "/home/dev/other/.venv",
  PYTHONPATH: "/home/dev/other/src",
  GITHUB_TOKEN: "ghp_secret",
  CLAUDECODE: "1",
  CLAUDE_CODE_CHILD_SESSION: "1",
};

// SERVER_ENV.PATH starts with the server's activated venv; the baseline drops
// that entry so project A's interpreter cannot reach project B's workers.
const BASELINE_PATH = "/usr/local/bin:/usr/bin";

const KEPT = Object.keys(SERVER_ENV).filter(
  (key) =>
    ![
      "AWS_SECRET_ACCESS_KEY",
      "DATABASE_URL",
      "VIRTUAL_ENV",
      "PYTHONPATH",
      "GITHUB_TOKEN",
      "CLAUDECODE",
      "CLAUDE_CODE_CHILD_SESSION",
      "TERM",
    ].includes(key),
);

describe("createShellEnvironment", () => {
  it("does not pass the parent's Claude session markers to agents", () => {
    // Octogent itself is often launched from inside a Claude Code session.
    // Inheriting these markers makes every agent believe it is a child
    // session — Claude then disables transcript saving, which breaks the
    // Stop-hook driven transcript pipeline completion detection relies on.
    stub("CLAUDE_CODE_CHILD_SESSION", "1");
    stub("CLAUDECODE", "1");

    const env = createShellEnvironment();

    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
  });

  it("keeps PATH and the terminal defaults from the real process environment", () => {
    const env = createShellEnvironment({ octogentSessionId: "terminal-9" });

    expect(env.TERM).toBe("xterm-256color");
    expect(env.OCTOGENT_SESSION_ID).toBe("terminal-9");
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("keeps the baseline families and the agents' own variables", () => {
    const env = createShellEnvironment({ sourceEnv: SERVER_ENV });

    for (const key of KEPT) {
      if (key === "PATH") continue; // the server's own venv bin is stripped, see below
      expect(env[key], key).toBe(SERVER_ENV[key]);
    }
    expect(env.PATH).toBe(BASELINE_PATH);
    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
  });

  it("drops everything else the server's shell happened to export", () => {
    const env = createShellEnvironment({ sourceEnv: SERVER_ENV });

    for (const key of ["AWS_SECRET_ACCESS_KEY", "DATABASE_URL", "VIRTUAL_ENV", "PYTHONPATH"]) {
      expect(env[key], key).toBeUndefined();
    }
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
  });

  it("copies everything but the session markers in inherit mode", () => {
    const env = createShellEnvironment({
      sourceEnv: { ...SERVER_ENV, OCTOGENT_PTY_ENV_MODE: "inherit" },
    });

    expect(env.AWS_SECRET_ACCESS_KEY).toBe("aws-secret");
    expect(env.VIRTUAL_ENV).toBe("/home/dev/other/.venv");
    expect(env.DATABASE_URL).toBe("postgres://prod");
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
  });

  it("treats an unknown mode as the baseline", () => {
    const env = createShellEnvironment({
      sourceEnv: { ...SERVER_ENV, OCTOGENT_PTY_ENV_MODE: "everything" },
    });

    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("applies baseline, then the project env, then inherited, then Octogent's own", () => {
    const workspace = createWorkspace();
    writeFileSync(
      join(workspace, ".octogent", "env"),
      [
        "PATH=$PWD/.venv/bin:$PATH",
        "VIRTUAL_ENV=$PWD/.venv",
        "EDITOR=vim",
        "OCTOGENT_API_BASE=http://evil.example",
        "OCTOGENT_SESSION_ID=someone-else",
        "TERM=dumb",
      ].join("\n"),
    );

    const env = createShellEnvironment({
      sourceEnv: SERVER_ENV,
      workspaceCwd: workspace,
      octogentSessionId: "terminal-3",
      apiBaseUrl: "http://127.0.0.1:8787",
      inheritedEnv: { EDITOR: "nano", OCTOGENT_API_BASE: "http://also-evil.example" },
    });

    expect(env.PATH).toBe(`${workspace}/.venv/bin:${BASELINE_PATH}`);
    expect(env.VIRTUAL_ENV).toBe(`${workspace}/.venv`);
    expect(env.EDITOR).toBe("nano");
    expect(env.OCTOGENT_API_BASE).toBe("http://127.0.0.1:8787");
    expect(env.OCTOGENT_SESSION_ID).toBe("terminal-3");
    expect(env.TERM).toBe("xterm-256color");
  });

  it("re-reads .octogent/env on every call", () => {
    const workspace = createWorkspace();
    const envFile = join(workspace, ".octogent", "env");
    writeFileSync(envFile, "STAGE=one\n");
    expect(createShellEnvironment({ sourceEnv: {}, workspaceCwd: workspace }).STAGE).toBe("one");

    writeFileSync(envFile, "STAGE=two\n");
    expect(createShellEnvironment({ sourceEnv: {}, workspaceCwd: workspace }).STAGE).toBe("two");
  });

  it("logs skipped lines once and still builds the environment", () => {
    const logVerbose = vi.spyOn(logging, "logVerbose").mockImplementation(() => {});
    const workspace = createWorkspace();
    writeFileSync(join(workspace, ".octogent", "env"), "GOOD=1\nnot valid\n2BAD=x\n");

    const env = createShellEnvironment({
      sourceEnv: {},
      workspaceCwd: workspace,
      octogentSessionId: "terminal-5",
    });

    expect(env.GOOD).toBe("1");
    expect(logVerbose).toHaveBeenCalledTimes(1);
    expect(String(logVerbose.mock.calls[0]?.[0])).toMatch(/2 line\(s\) session=terminal-5/);
  });

  it("stays quiet when the project has no .octogent/env", () => {
    const logVerbose = vi.spyOn(logging, "logVerbose").mockImplementation(() => {});

    createShellEnvironment({ sourceEnv: SERVER_ENV, workspaceCwd: createWorkspace() });

    expect(logVerbose).not.toHaveBeenCalled();
  });

  it("scrubs the session markers even when a project or caller supplies them", () => {
    const workspace = createWorkspace();
    writeFileSync(join(workspace, ".octogent", "env"), "CLAUDECODE=1\n");

    const env = createShellEnvironment({
      sourceEnv: SERVER_ENV,
      workspaceCwd: workspace,
      inheritedEnv: { CLAUDE_CODE_CHILD_SESSION: "1" },
    });

    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
  });
});

describe("createBaseEnvironment", () => {
  it("is the baseline without Octogent's terminal settings", () => {
    const base = createBaseEnvironment(SERVER_ENV);

    expect(base.PATH).toBe(BASELINE_PATH);
    expect(base.VIRTUAL_ENV).toBeUndefined();
    expect(base.OCTOGENT_SESSION_ID).toBeUndefined();
  });
});

describe("createBaseEnvironment and the server's own virtualenv", () => {
  it("removes the activated venv's bin from PATH along with VIRTUAL_ENV", () => {
    const env = createBaseEnvironment({
      PATH: "/home/dev/other/.venv/bin:/usr/local/bin:/usr/bin",
      VIRTUAL_ENV: "/home/dev/other/.venv",
      HOME: "/home/dev",
    });
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(env.VIRTUAL_ENV).toBeUndefined();
  });

  it("leaves PATH alone when no virtualenv is active or in inherit mode", () => {
    expect(createBaseEnvironment({ PATH: "/usr/local/bin:/usr/bin", HOME: "/home/dev" }).PATH).toBe(
      "/usr/local/bin:/usr/bin",
    );
    expect(
      createBaseEnvironment({
        PATH: "/home/dev/other/.venv/bin:/usr/bin",
        VIRTUAL_ENV: "/home/dev/other/.venv",
        OCTOGENT_PTY_ENV_MODE: "inherit",
      }).PATH,
    ).toBe("/home/dev/other/.venv/bin:/usr/bin");
  });
});

describe("loadProjectEnvironment", () => {
  it("returns nothing when the project has no .octogent/env", () => {
    const workspace = createWorkspace();

    expect(loadProjectEnvironment(workspace, { PATH: "/usr/bin" })).toEqual({
      env: {},
      issues: [],
    });
  });

  it("expands against the base with PWD set to the workspace, without exporting PWD", () => {
    const workspace = createWorkspace();
    writeFileSync(
      join(workspace, ".octogent", "env"),
      "PATH=$PWD/.venv/bin:$PATH\nVIRTUAL_ENV=$PWD/.venv\nbroken line\n",
    );

    const result = loadProjectEnvironment(workspace, { PATH: "/usr/bin", PWD: "/server/cwd" });

    expect(result.env).toEqual({
      PATH: `${workspace}/.venv/bin:/usr/bin`,
      VIRTUAL_ENV: `${workspace}/.venv`,
    });
    expect(result.issues).toEqual([{ line: 3, reason: expect.any(String) }]);
  });

  it("reports an unreadable file instead of throwing", () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, ".octogent", "env"));

    const result = loadProjectEnvironment(workspace, {});

    expect(result.env).toEqual({});
    expect(result.issues).toEqual([{ line: 0, reason: expect.stringMatching(/read/) }]);
  });
});

describe("ensureProjectEnvTemplate", () => {
  const envPath = (workspace: string) => join(workspace, ".octogent", "env");

  it("activates a .venv it finds", () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, ".venv", "bin"), { recursive: true });
    writeFileSync(join(workspace, ".venv", "bin", "activate"), "");

    expect(ensureProjectEnvTemplate(workspace)).toEqual({ written: true, venvDirectory: ".venv" });
    expect(loadProjectEnvironment(workspace, { PATH: "/usr/bin" }).env).toEqual({
      PATH: `${workspace}/.venv/bin:/usr/bin`,
      VIRTUAL_ENV: `${workspace}/.venv`,
    });
  });

  it("falls back to venv/", () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, "venv", "bin"), { recursive: true });
    writeFileSync(join(workspace, "venv", "bin", "activate"), "");

    expect(ensureProjectEnvTemplate(workspace)).toEqual({ written: true, venvDirectory: "venv" });
    expect(readFileSync(envPath(workspace), "utf8")).toContain("VIRTUAL_ENV=$PWD/venv\n");
  });

  it("writes a commented template without a virtualenv", () => {
    const workspace = createWorkspace();

    expect(ensureProjectEnvTemplate(workspace)).toEqual({ written: true, venvDirectory: null });
    expect(readFileSync(envPath(workspace), "utf8")).toContain("# VIRTUAL_ENV=$PWD/.venv");
    expect(loadProjectEnvironment(workspace, {}).env).toEqual({});
  });

  it("never overwrites an existing file", () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, ".venv", "bin"), { recursive: true });
    writeFileSync(join(workspace, ".venv", "bin", "activate"), "");
    writeFileSync(envPath(workspace), "MINE=1\n");

    expect(ensureProjectEnvTemplate(workspace)).toEqual({ written: false, venvDirectory: ".venv" });
    expect(readFileSync(envPath(workspace), "utf8")).toBe("MINE=1\n");
  });
});

describe("createShellEnvironment under the hub", () => {
  it("tells the in-worker CLI which hub project and base it belongs to", () => {
    const env = createShellEnvironment({
      octogentSessionId: "terminal-1",
      apiBaseUrl: "http://127.0.0.1:8787/api/p/project-a",
      projectId: "project-a",
      sourceEnv: SERVER_ENV,
    });

    expect(env.OCTOGENT_API_BASE).toBe("http://127.0.0.1:8787/api/p/project-a");
    expect(env.OCTOGENT_PROJECT_ID).toBe("project-a");
  });

  it("never lets the server's own project id or API origin reach agents", () => {
    // A server launched from inside a hub worker must not hand that worker's
    // project to its own agents, and a dev shell's OCTOGENT_API_ORIGIN would
    // send the worker's CLI to the hub root instead of its project.
    const workspace = createWorkspace();
    writeFileSync(join(workspace, ".octogent", "env"), "OCTOGENT_PROJECT_ID=from-file\n");

    const env = createShellEnvironment({
      apiBaseUrl: "http://127.0.0.1:8787/api/p/project-a",
      workspaceCwd: workspace,
      inheritedEnv: { OCTOGENT_API_ORIGIN: "http://127.0.0.1:8787" },
      sourceEnv: {
        ...SERVER_ENV,
        OCTOGENT_PROJECT_ID: "outer-project",
        OCTOGENT_API_ORIGIN: "http://127.0.0.1:8787",
      },
    });

    expect(env.OCTOGENT_PROJECT_ID).toBeUndefined();
    expect(env.OCTOGENT_API_ORIGIN).toBeUndefined();
    expect(env.OCTOGENT_API_BASE).toBe("http://127.0.0.1:8787/api/p/project-a");
  });
});
