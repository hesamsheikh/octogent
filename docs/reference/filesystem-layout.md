# Filesystem Layout

Octogent splits files by ownership. Agent-facing project context stays in the workspace. Runtime-owned state stays in the per-project global state directory.

## Project-local files

`.octogent/` is created in the workspace.

Main paths:

- `.octogent/project.json`
- `.octogent/env` (optional)
- `.octogent/tentacles/`
- `.octogent/worktrees/`

`project.json` holds the stable project ID used to find global state. The tentacles folder is intended for agent-readable markdown. Worktrees are generated execution checkouts and should not be treated as context storage.

`env` is the project's worker environment: `KEY=VALUE` lines applied on top of the baseline environment of every agent terminal in this project, re-read at each session start. `octogent init` writes a starter file (activating `.venv/` or `venv/` when found) and never overwrites one. Like the rest of `.octogent/`, it is git-ignored and belongs to this clone. Syntax and precedence: [CLI reference — Worker environment](cli.md#worker-environment).

Tentacle example:

```text
.octogent/
  tentacles/
    api-backend/
      CONTEXT.md
      todo.md
      routes.md
```

`CONTEXT.md` may end with a managed `Suggested Skills` block when the operator or planner attaches Claude Code skills to that tentacle.

Deck also writes UI metadata for tentacles, but not into these markdown files. Color, status, appearance, paths, and tags are stored in global deck state.

Project-local Claude Code skills, when present, live under:

```text
.claude/
  skills/
    some-skill/
      SKILL.md
```

## Global state

Per-project runtime files are stored under:

```text
~/.octogent/projects/<project-id>/
  logs/
    server.log
    server.log.1
    server.log.2
    server.log.3
  state/
```

Notable files under `state/`:

- `tentacles.json`
- `deck.json`
- `transcripts/<sessionId>.jsonl`
- `monitor-config.json`
- `monitor-cache.json`
- `code-intel.jsonl`
- `runtime.json`

`tentacles.json` is the terminal registry despite the historical name. It stores terminal records, lifecycle state, UI state, parent-child links, workspace mode, worktree IDs, and display names.

`deck.json` stores Deck presentation metadata that is not part of the agent-facing tentacle files.

`transcripts/*.jsonl` stores conversation transcript events separately from PTY scrollback. Scrollback is in memory and bounded; transcripts are persisted.

`logs/server.log` records server startup facts, runtime summaries, and uncaught errors. It rotates at 5 MB and keeps three generations. `OCTOGENT_SERVER_LOG` can override or disable this location.

`runtime.json` holds the address and pid of the project's single-project server while it runs. CLI commands in the project use it ahead of the hub when that process is alive and answers.

## Registry and hub files

Machine-wide files sit next to the per-project directories:

```text
~/.octogent/
  projects.json
  hub.json
  hub.lock
  hub.env
  hub/
    logs/
      server.log
      daemon-stderr.log
  projects/<project-id>/
```

- `projects.json` is the project registry. Each entry has `id`, `name`, `path`, `createdAt`, `lastOpenedAt`, and two fields for the hub: `slug`, the project's key in its hub address (`/p/<slug>/`), unique across the registry and backfilled on load for older files; and `aliases`, the slugs it answered to before a rename, kept so old links still resolve and never handed to another project. The file is written to a temporary name and renamed into place, so a reader never sees half of it.
- `hub.json` describes the running hub: `{ apiBaseUrl, host, port, pid, startedAt, version, commit?, builtAt? }`. `commit` comes from `OCTOGENT_BUILD_COMMIT` and `builtAt` is the mtime of `dist/api/cli.js`; CLIs compare them with their own build to warn about drift. The hub writes the file once it listens and removes it on shutdown. A CLI treats it as stale unless its pid is alive and `GET /api/hub/health` answers with that pid.
- `hub.lock` exists only while a CLI is starting the hub, so concurrent CLIs start one hub. It is created exclusively, holds the starter's pid, and counts as stale after 60 seconds or once that pid has exited.
- `hub.env` is optional and written by you: `KEY=value` lines the [systemd service](systemd.md) loads into the hub's environment (`OCTOGENT_HUB_PORT`, `OCTOGENT_ACCESS_TOKEN`, …). A hub started any other way ignores it.
- `hub/logs/server.log` is the hub's server log: one file for every project, each line tagged `[<slug>]`, rotated like a project's log. `daemon-stderr.log` holds a detached hub's stderr from its latest start (whatever it printed before or outside the server log, such as a crash while loading).

`octogent hub install-service` also writes one file outside the state root: `~/.config/systemd/user/octogent-hub.service` (under `$XDG_CONFIG_HOME` when set), the hub's systemd user unit. It names the state root it serves in an `OCTOGENT_HOME=` line, and a CLI starts the hub through systemd only when that line names its own state root.

## Prompt storage

- core prompts are synced from `prompts/`
- synced copies live in `.octogent/prompts/core/`
- user prompts live in `.octogent/prompts/`

## Practical rule

If something is agent-facing context, keep it in the tentacle folder.

If something is runtime-owned state, expect it under the global project state directory.

If something is an isolated execution checkout, expect it under `.octogent/worktrees/` and treat its branch lifecycle as part of the terminal that created it.

`transcripts/<terminalId>.screen.txt` stores the last 200 processed PTY lines best-effort on session teardown, for `terminal screen` fallback.
