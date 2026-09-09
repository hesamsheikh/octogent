# API Reference

Octogent exposes a local HTTP and WebSocket API.

The API has two different kinds of state:

- persisted project state, such as terminal records, Deck metadata, UI state, and transcripts
- in-memory runtime state, such as live PTYs, attached WebSockets, scrollback, and channel queues

Most HTTP routes either read/write persisted files or create runtime records. WebSocket routes attach clients to live PTY sessions owned by the API process.

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
