# API Reference

Octogent exposes a local HTTP and WebSocket API.

The API has two different kinds of state:

- persisted project state, such as terminal records, Deck metadata, UI state, and transcripts
- in-memory runtime state, such as live PTYs, attached WebSockets, scrollback, and channel queues

Most HTTP routes either read/write persisted files or create runtime records. WebSocket routes attach clients to live PTY sessions owned by the API process.

## Hub mode

A hub is one API process serving every project registered in `~/.octogent/projects.json`; a single-project server is the same thing with its one project mounted at the root, so every path on this page works there unchanged. Under a hub each of those routes, HTTP and WebSocket alike, sits behind a project prefix, `/api/p/<key>/api/...`, where `<key>` is the project's id, its slug, or a former slug kept as an alias; a project loads on the first request that names it and unloads again after `OCTOGENT_HUB_PROJECT_IDLE_MS` (default 30 minutes; `0` never) without a PTY session, an open terminal-events socket, or a request in flight, until the next request loads it again; an unknown key answers `404`. Claude hook commands, the guard in the user-level Codex hooks, and `OCTOGENT_API_BASE` in each terminal use `<hub>/api/p/<projectId>` (the id, because slugs change on rename), and terminals also get `OCTOGENT_PROJECT_ID`. The hub's own routes are `GET /api/hub/health` (the health snapshot below with counts summed over loaded projects, plus the hub's build as `hub.json` records it, `version` with `commit` and `builtAt` when known, then `pid`, `maxTerminalSessions`, `projects: { registered, loaded }`, and `loadedProjects`), `GET /api/projects` (`{ "projects": [{ id, name, slug, path, loaded, summary? }] }`, where a loaded project's `summary` carries its session and terminal counts and `lastActivityAt`), and `POST /api/projects` with `{ "path": "/absolute/dir", "name": "optional" }`, which scaffolds `.octogent/` and registers the directory (`201` when new, `200` when already registered, `400` unless the path is an absolute existing directory; loopback or access token only). `GET /p/<key>/...` serves the web app, which derives its API prefix from its own address: on a `/p/<key>/...` page every request and WebSocket goes to `/api/p/<key>/api/...`, on any other page to `/api/...`; at `/` it asks `GET /api/projects` and shows the project overview when that answers, or the single-project app on `404`. Each project may run 12 PTY sessions by default (`OCTOGENT_MAX_TERMINAL_SESSIONS` overrides it) and the hub 32 in total (`OCTOGENT_HUB_MAX_TERMINAL_SESSIONS`); creating a terminal past the hub cap returns `429`.

## Terminals

- `GET /api/terminal-snapshots` - returns the current terminal list and snapshot state for the UI; archived records are excluded unless `?includeArchived=1` is passed
- `POST /api/terminals` - creates a new terminal session
- `POST /api/terminals/prune` - removes terminal records with `stale`, `stopped`, or `exited` lifecycle state
- `POST /api/terminals/archive-completed` - archives every terminal record with `completed` lifecycle state
- `PATCH /api/terminals/:terminalId` - updates terminal metadata such as the display name
- `DELETE /api/terminals/:terminalId` - removes a terminal and closes its active session
- `POST /api/terminals/:terminalId/stop` - stops an active session or recorded stale process
- `POST /api/terminals/:terminalId/kill` - kills an active session or recorded stale process
- `POST /api/terminals/:terminalId/archive` - archives a non-running terminal record (running terminals get `409`); files such as transcripts and completion summaries are kept
- `WS /api/terminals/:terminalId/ws` - streams live terminal IO over WebSocket

Terminal snapshots carry `providerError` (`{ kind, message, at }`, kind one of `usage-limit`, `rate-limit`, `api-error`, `auth`) while a provider banner the agent CLI printed stands; it clears on the agent's next tool call or completion verdict. `POST /api/terminals` adds `usageWarning` (`{ provider, bucket, usedPercent, resetAt }`) when the usage reading the server last fetched shows the chosen provider out of quota.

`POST /api/terminals` accepts `inheritEnv` (array of up to 64 names matching `^[A-Z_][A-Z0-9_]*$`) together with `env` (object holding exactly those names, string values without NUL or newlines); the values are applied to that terminal's sessions on top of the project's `.octogent/env`. Any mismatch between the two fields is a `400`. Records and snapshots carry only the names, as `inheritedEnv`; the values are kept in memory and not persisted.

Terminal snapshots include `lifecycleState` when known. Supported lifecycle states are `registered`, `running`, `stopped`, `exited`, and `stale`. Stale terminals are records that were persisted as running but could not be reattached to a live Octogent PTY session after startup.

Creating a terminal registers metadata first. A PTY starts immediately only when an initial prompt is provided, a WebSocket attaches, or an internal direct listener starts the session. Worktree terminals also create their worktree before the terminal record is exposed.

## Git and worktrees

- `GET /api/tentacles/:tentacleId/git/status` - reads git status for a worktree-backed tentacle
- `POST /api/tentacles/:tentacleId/git/commit` - creates a commit from the tentacle worktree
- `POST /api/tentacles/:tentacleId/git/push` - pushes the tentacle branch
- `POST /api/tentacles/:tentacleId/git/sync` - syncs the tentacle worktree with its base branch
- `GET /api/tentacles/:tentacleId/git/pr` - reads pull request information for the tentacle branch
- `POST /api/tentacles/:tentacleId/git/pr/merge` - merges the tentacle pull request
- `POST /api/worktrees/gc` - reclaims the worktree directory and branch of every archived worktree terminal whose work is proven merged (`completed` lifecycle state or a `merged: true` completion summary); pass `?dryRun=1` to list the candidates without removing anything. Returns `dryRun`, `candidates`, `reclaimedWorktreeIds`, and `failedWorktreeIds`. Unmerged work is never reclaimed.

## Deck and tentacles

- `GET /api/deck/skills` - lists available Claude Code skills discovered from project-local `.claude/skills/<skill>/SKILL.md` entries
- `GET /api/deck/tentacles` - lists tentacles with metadata, vault files, and todo progress
- `POST /api/deck/tentacles` - creates a new tentacle
- `DELETE /api/deck/tentacles/:tentacleId` - deletes a tentacle and its stored files
- `PATCH /api/deck/tentacles/:tentacleId/skills` - updates the tentacle's suggested Claude Code skills and rewrites the managed block in `CONTEXT.md`
- `POST /api/deck/tentacles/:tentacleId/todo` - adds a todo item to `todo.md`
- `PATCH /api/deck/tentacles/:tentacleId/todo/toggle` - marks a todo item done or undone
- `PATCH /api/deck/tentacles/:tentacleId/todo/edit` - edits the text of a todo item
- `POST /api/deck/tentacles/:tentacleId/todo/delete` - deletes a todo item
- `GET /api/deck/tentacles/:tentacleId/files/:filename` - reads one markdown file from the tentacle vault
- `POST /api/deck/tentacles/:tentacleId/swarm` - spawns worker terminals from incomplete todo items

Deck routes treat `.octogent/tentacles/<tentacle-id>/` as the source of truth for agent-facing context. Todo operations update `todo.md` by parsed item index. Swarm operations derive worker assignments from incomplete parsed todo items.

## Prompts

- `GET /api/prompts` - lists available prompt templates
- `POST /api/prompts` - creates a user prompt
- `GET /api/prompts/:promptId` - reads one prompt
- `PUT /api/prompts/:promptId` - updates one prompt
- `DELETE /api/prompts/:promptId` - deletes one prompt

## Channels

- `GET /api/channels/:terminalId/messages` - lists messages for one terminal channel
- `POST /api/channels/:terminalId/messages` - sends a message to one terminal channel

Channel messages are queued in memory. The POST body provides `fromTerminalId` and `content`; delivery injects pending messages into the target terminal input when the target session is idle.

## Code intel

- `POST /api/code-intel/events` - records one code-intel event
- `GET /api/code-intel/events` - returns the stored code-intel event log

## Hooks

- `POST /api/hooks/:hookName` - ingests lifecycle events coming from Claude Code hooks

Current hook names:

- `session-start`
- `user-prompt-submit`
- `pre-tool-use`
- `notification`
- `stop`

## Health

- `GET /api/health` - returns a liveness snapshot for daemon scripts and monitors: `status`, `uptimeMs`, `version`, `eventLoopDelayP95Ms` (p95 event-loop delay in ms, one decimal), `ptySessions`, `terminals` (counts by lifecycle state), and `terminalEventClients`

## Usage and telemetry

- `GET /api/codex/usage` - returns Codex usage data when available
- `GET /api/claude/usage` - returns Claude usage data when available
- `GET /api/github/summary` - returns GitHub summary and repo telemetry data
- `GET /api/analytics/usage-heatmap?scope=all|project` - returns heatmap data from Claude session history

## UI state

- `GET /api/ui-state` - reads the persisted UI state for the current project
- `PATCH /api/ui-state` - updates the persisted UI state

## Workspace setup

- `GET /api/setup` - reads the verified first-run setup status for the current workspace
- `POST /api/setup/steps/:stepId` - runs one setup step and returns the refreshed setup snapshot

## Monitor

- `GET /api/monitor/config` - reads monitor configuration
- `PATCH /api/monitor/config` - updates monitor configuration
- `GET /api/monitor/feed` - returns the current monitor feed snapshot
- `POST /api/monitor/refresh` - forces a monitor refresh

## Conversations

- `GET /api/conversations` - lists stored conversations
- `DELETE /api/conversations` - deletes all stored conversations
- `GET /api/conversations/search?q=...` - searches conversations by text
- `GET /api/conversations/:sessionId` - reads one conversation in full
- `GET /api/conversations/:sessionId/export?format=json|md` - exports one conversation as JSON or Markdown

## Request limits and defaults

- JSON request bodies are capped at `1 MiB`
- invalid JSON returns `400`
- unsupported methods return `405`
- the server binds to loopback by default

## Terminal screen and direct input

- `GET /api/terminals/:terminalId/screen?lines=40&raw=1`: `lines` defaults to 40 and must be an integer from 1–200. Omit `raw=1` for the rendered screen: the retained scrollback replayed through a headless terminal emulator, limited by the scrollback buffer size. Returns `{ "text": "...", "savedAt": null, "raw": true }`. With no live session, reads `<stateDir>/state/transcripts/<terminalId>.screen.txt`; `savedAt` is its modification time in ISO format and `raw` is `false`. At most 200 rendered lines are saved best-effort on all normal session teardown paths (stripped text if rendering fails or the server exits first); abrupt server termination cannot guarantee a save. Returns `404` without a screen and `400` for invalid line counts.
- `POST /api/terminals/:terminalId/input`: accepts `{ "text": "1", "enter": true, "keys": ["tab"] }`. Fields are optional but some input is required. Types text, then keys in order; `enter: true` appends carriage return after 150 ms (cancelled if the session ends). Keys are limited to `enter`, `esc`, `up`, `down`, `tab`, `ctrl-c`, and `1`–`9`. Uses no bracketed paste and does not wait for idle. Records an `input_submit` event and returns `200 { "ok": true }` on acceptance. Returns `404` without a live session, `400` for invalid fields, unknown keys, or decoded input exceeding 4096 bytes, and `413` for a JSON body exceeding 4096 bytes. Uses the same authentication, Host, and Origin checks as other terminal mutations.
