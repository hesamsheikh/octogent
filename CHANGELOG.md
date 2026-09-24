# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Agent lifecycle (this fork's evolution, phase 1)

- Terminals now report `completed` and `awaiting-review` lifecycle states,
  decided on Claude's Stop hook: a clean worktree with commits beyond the base
  counts as done, merged into the operator's branch reads completed, unmerged
  reads awaiting-review; new activity flips a finished terminal back to running.
- A completion summary (task line, commits, diff stats, branch, merged flag,
  duration) is stamped on the record and shown in the canvas node tooltip;
  session nodes carry DONE / REVIEW pills and a Hide Done toolbar toggle.
### Orchestration, flow view, and operations (this fork's evolution, phases 2–4)

- Channel delivery reaches a live agent reliably — three fixes surfaced by the
  pilot swarm run: injection writes a bracketed paste and submits with a
  delayed Enter (so the TUI cannot swallow the return), delivery requires a
  live transcript instead of a merely idle shell and marks delivered only
  after a successful write, and a session-start handover replays the queued
  backlog when a fresh agent starts in the same PTY. Agent PTYs also no longer
  inherit the operator's Claude session environment markers.
- The multi-agent workflow closed the loop on a live swarm run: pilot and
  worker agents built this batch's features in worktrees and merged them back,
  that run surfaced the channel-delivery bugs above, and the flow layout
  engine is tested against the hierarchy shape the run produced.
- New flow progress view: a pseudo-3D depth-staged scene of the whole fleet
  (octoboss → tentacles → agents → swarm workers), with pan/zoom, hover cards,
  click-to-pin, and completed agents rendered as calm dimmed dots. It is now
  the first page (nav schema 2): the view order lives in one named map, and
  persisted UI state without `navSchemaVersion: 2` has its saved view index
  migrated so nobody reloads into the wrong view.
- Each flow card narrates its node in both languages: a role line (fleet
  commander, tentacle description, swarm coordinator with sub-agent count,
  worker isolation mode) and a previous/current/next strip read from todos,
  latest commits, live runtime state, and the lifecycle.
- Claude usage source switch (`OCTOGENT_CLAUDE_USAGE_SOURCE`: auto/oauth/cli/
  off, OAuth first by default), a systemd user-service deployment guide, and
  `GET /api/health` for daemon and monitor probes.
- Finished records auto-archive after a retention period
  (`OCTOGENT_TERMINAL_RETENTION_HOURS`, default 72h); archived worktrees whose
  work is merged are reclaimed (`octogent worktree gc`), and unmerged work is
  never deleted by any automated path.

### Codex provider parity (this fork's evolution, phase 5)

- The terminal runtime now runs agents through a provider adapter layer
  (`agentProviders.ts`), and Codex terminals run unattended out of the box:
  Octogent auto-writes a shared, session-guarded `hooks.json` into the
  user-level `$CODEX_HOME` (the only layer the Codex TUI reliably loads from
  git worktree sessions; the guard makes the hooks inert outside Octogent
  PTYs) covering SessionStart, UserPromptSubmit,
  PreToolUse, PermissionRequest, and Stop, all reporting to `/api/hooks/*`)
  and seeds Codex's `config.toml` with project trust and hook trust hashes
  (`codexTrust.ts`) so Codex accepts both without prompting.
- `octogent terminal create` gained `--agent-provider` (`claude-code` or
  `codex`).
- The hook processor understands Codex payloads: `permission-request` events,
  a Stop branch that does not try to parse Codex's rollout transcript format,
  and a forced return to idle once a turn ends.
- Three new environment variables: `OCTOGENT_CODEX_SANDBOX_MODE` (`read-only`,
  `workspace-write`, or `danger-full-access`; unset defaults to
  `danger-full-access` for worktree terminals and `workspace-write` for shared
  ones, because `workspace-write` mounts `.git` read-only and a worktree agent
  could never commit — Claude has no sandbox, so this aligns the providers),
  `OCTOGENT_CODEX_APPROVAL_POLICY` (`on-request` or `never`, default `never`),
  and `OCTOGENT_CODEX_CONFIG` (overrides the Codex `config.toml` path, mainly
  for test isolation).
- Known Codex limitations: the conversation view has no transcript replay yet
  (the rollout format is not wired in) and no code-intel events.
- Web fixes landed alongside the batch: the events WebSocket reconnects
  automatically after a server restart so live views no longer freeze, and the
  flow progress view auto-fits the camera to the fleet on load.

### Model selection (this fork's evolution, phase 6)

- `octogent terminal create` gained `--model` (explicit identifier, wins) and
  `--effort` (`light` / `standard` / `heavy` / `max`), which the server maps
  to a per-provider model via `OCTOGENT_EFFORT_MODELS`; Codex entries pack the
  reasoning level as `model@reasoning`.
- Defaults re-based on the September 2026 model generation: Claude tiers stay
  on family aliases (haiku → Haiku 4.5, sonnet → Sonnet 5, opus → Opus 5,
  fable → Fable 5.1) so they follow new releases without a code change; Codex
  `heavy` moved from `gpt-5.5@high` (now "previous-generation") to
  `gpt-5.6-sol@high`, and `max` from `gpt-5.6-sol@high` to `gpt-5.6-sol@xhigh`
  so the top two tiers are separated by reasoning level. Codex's `ultra` level
  is intentionally not a default because it delegates to its own sub-agents.
  Retired `gpt-5.4` / `gpt-5.4-mini` no longer appear anywhere.

### Model list follow-up (2026-09-08)

- Codex published GPT-6: `gpt-6-astra` is the new top model and
  `gpt-5.6-sol` is now billed as the everyday workhorse. Effort tiers follow:
  `standard` = gpt-5.6-sol@medium (was terra), `heavy` = gpt-6-astra@medium
  (was sol@high), `max` = gpt-6-astra@xhigh (was sol@xhigh); `light` stays
  on gpt-5.6-luna@low. The hidden `gpt-reserve` is not used. GPT-6 is
  rolling out per account, so each Codex tier carries a fallback that applies
  when the local Codex models cache does not list the first choice, and
  `OCTOGENT_EFFORT_MODELS` accepts candidate arrays.

### Model list follow-up (2026-09-23)

- Codex effort tiers moved to the GPT-6 generation now that Sol and Luna sit
  beside Astra: `light` = gpt-6-luna@medium, `standard` = gpt-6-sol@high,
  `heavy` = gpt-6-astra@high, `max` = gpt-6-astra@xhigh, each with 5.6-era
  fallbacks for accounts the rollout has not reached (and Sol as the step-down
  from Astra). Small models run at their default reasoning level or above
  rather than `low`. The Claude aliases already resolve to the new Opus 5.5
  (`opus`), so the Claude side is unchanged apart from the docs.
- `octogent guide` now derives its tier line from the same table
  `terminal create` uses, and mentions the hub (`--project`, `hub status`,
  `/p/<slug>/`).
- The agent skill (`octogent setup-agents`) grew from a one-page routine into
  a routine plus three references — every command with its output and exit
  codes, a brief template with a real example and checklist, and a
  troubleshooting guide for each stuck state (permission dialogs, provider
  errors, stalls, the survey, unacknowledged briefs, channel failures) — with
  the mental model (octoboss, tentacles, workers, worktree vs shared, the hub,
  the clean worker environment) and the mistakes seen in real coordinator
  sessions. Run `octogent setup-agents` again to refresh the installed copy.

### Hub, phase 3: the hub is the default (2026-09-22)

- Bare `octogent` now opens the current project on the hub: it starts the
  hub if none answers, registers the project if needed (a git repository;
  `octogent init` still does the full scaffold), and opens
  `<hub>/p/<slug>/` — or `<hub>/` outside any project, or the project named
  by `--project <slug>`. A project's own single-project server, when one is
  still running, is opened instead of loading the project twice; a foreign
  process on the hub port is reported, never worked around with another
  port. `octogent --standalone` keeps the old single-project server. The
  decision is a pure function (`resolveStartMode`).
- The hub unloads a project after 30 minutes without a live PTY session, an
  open dashboard, or a request (`OCTOGENT_HUB_PROJECT_IDLE_MS`; `0` keeps
  everything loaded); its state stays on disk and the next request loads it
  again, after the old context has finished writing.
- `octogent hub install-service [--remove]` installs the hub as a systemd
  user unit (`~/.config/systemd/user/octogent-hub.service`: the `octogent`
  launcher's `hub start --foreground`, the installing shell's `PATH`,
  `OCTOGENT_HOME`, `EnvironmentFile=~/.octogent/hub.env`, restart on
  failure) and advises `loginctl enable-linger` when needed. Once installed,
  every way of starting the hub — `hub start`, `hub restart`, auto-start,
  bare `octogent` — goes through `systemctl --user start` so the hub never
  escapes supervision; `--remove` disables the unit without stopping a hub
  that may still have workers. `GET /api/hub/health` now reports the hub's
  commit and build time next to its version.
- Docs: a hub guide (`docs/guides/hub.md`, zh-CN too) linked from the
  indexes, the READMEs and CLAUDE.md; the systemd reference rewritten for
  the hub (`examples/octogent-hub.service`); quickstart, installation,
  getting-work-done, CLI, API, filesystem-layout and troubleshooting
  updated for the hub-first flow.

### Hub, phase 1: the hub CLI (2026-09-22)

- `octogent hub start [--foreground]`, `hub status`, `hub stop`, `hub restart
  [--force]`. The hub runs on a fixed port (`OCTOGENT_HUB_PORT`, default
  8787) and never moves: when something else holds it — typically an old
  single-project server — `start` fails naming that pid and project. A
  detached hub writes `~/.octogent/hub.json` (address, pid, start time,
  version, commit, build time; live only while the pid is alive and
  `/api/hub/health` answers with it), logs to `~/.octogent/hub/logs/server.log`
  (its own stderr to `daemon-stderr.log`), and `restart` refuses while any
  project has running or awaiting-review terminals unless `--force`.
- Every server-bound command now resolves its target in order: an explicit
  `OCTOGENT_API_BASE` / `OCTOGENT_API_ORIGIN`; the current project's own live
  single-project server; the hub, scoped to `--project <slug|id>` or the
  project the current directory belongs to; and, with no hub answering,
  starting one (`~/.octogent/hub.lock` makes concurrent commands start a
  single hub; `OCTOGENT_NO_AUTOSTART=1` turns that into an error). An
  unregistered git repository is registered on the spot.
- Hub-bound commands warn once per command when the hub runs another build
  than the CLI (version, `OCTOGENT_BUILD_COMMIT`, or the bundle's build
  time). `octogent projects` shows slugs and marks the current project. Bare
  `octogent` while a hub already serves the project prints
  `<hub>/p/<slug>/` instead of starting a second server; `octogent
  --standalone` always starts a single-project server.

### Hub, phase 2: the web side (2026-09-22)

- The web app is hub-aware. A page at `/p/<slug-or-id>/…` sends every HTTP
  and WebSocket request to that project's mount (`/api/p/<key>/api/…`); any
  other page keeps `/api/…`, and `VITE_OCTOGENT_API_ORIGIN` still applies
  first. The twelve call sites that bypassed the endpoint builders with
  literal `/api/` strings now go through them (`buildTerminalUrl`,
  `buildDeckTentacleSwarmUrl`, `buildCodeIntelEventsUrl`, `buildHubProjectsUrl`
  are new).
- `/` asks `GET /api/projects` once: a 404 means a single-project server and
  the app renders as before; a listing renders the project overview — one
  card per project with slug, path, running / awaiting-review counts and
  last activity (unloaded projects show "not loaded"), refreshed every 15 s,
  a click opening `/p/<slug>/`. An add-project form (absolute path) appears
  only when the hub would accept the registration; otherwise the page points
  at `octogent init` / `octogent projects`.
- Inside a project page the top bar gains a project switcher listing every
  registered project plus "All projects"; it is hidden on a single-project
  server. `?token=` sign-in links keep working on both pages.

### Hub, phase 1: the hub server (2026-09-22)

- One process can now serve every registered project: `createHubServer`
  loads a project on the first request that names it (`/api/p/<slug-or-id>/api/…`,
  WebSockets included) and keeps it loaded, each with its own runtime,
  monitor, prompts, usage cache and health source (`createProjectContext`,
  extracted from the single-project server, which now mounts one context at
  the root). Hub-level routes: `GET /api/hub/health`, `GET /api/projects`
  (id, name, slug, path, loaded, and a summary with running / awaiting-review
  counts and last activity for loaded projects) and `POST /api/projects
  { path, name? }` (loopback or token holders only; scaffolds the workspace
  without touching `.gitignore`). `/` and `/p/<key>/…` serve the web app.
- Registry entries carry a `slug` (backfilled on load, unique, kept stable
  across renames with the old slug kept as an alias so bookmarked links keep
  resolving); ids win over slugs and slugs over aliases. The registry is now
  written atomically, since the hub, CLI calls and other servers all read it.
- Under the hub every project's hooks, PTY environment (`OCTOGENT_API_BASE`)
  and prompts use the id-scoped base `<hub>/api/p/<id>`; workers also get
  `OCTOGENT_PROJECT_ID`. The server's own `OCTOGENT_PROJECT_ID` and
  `OCTOGENT_API_ORIGIN` never reach workers, and the CLI now prefers the
  per-worker `OCTOGENT_API_BASE` over the dev shell's `OCTOGENT_API_ORIGIN`.
  Swarm prompts receive `{{apiBaseUrl}}` next to `{{apiPort}}`, since the
  port alone reaches the hub root.
- Session caps: 12 PTY sessions per project under the hub (or
  `OCTOGENT_MAX_TERMINAL_SESSIONS`) and 32 hub-wide
  (`OCTOGENT_HUB_MAX_TERMINAL_SESSIONS`); a refused create answers 429.
  Log lines from a project are tagged `[<slug>]`, and `configureServerLogging`
  accepts a `hubStateDir` (`~/.octogent/hub/logs/server.log`) for the hub.
  Nothing starts the hub yet — the CLI side follows.

### Hub, phase 1: worker environment (2026-09-22)

- Worker PTYs start from a clean baseline instead of a copy of the server's
  environment (which leaked whatever shell started Octogent: one project's
  virtualenv, secrets, Claude session markers). Only login-shell basics, the
  agents' own families (`ANTHROPIC_*`, `CLAUDE_CODE_*`, `CODEX_*`, `OPENAI_*`,
  `NODE_*`, `NVM_*`, proxy and CA variables) and `OCTOGENT_*` carry over;
  the server's activated venv is also removed from `PATH`.
  `OCTOGENT_PTY_ENV_MODE=inherit` restores the old behavior.
- Each project declares what its workers need in `<workspace>/.octogent/env`
  (`KEY=VALUE`, `$VAR` expansion, `PWD` = workspace; re-read at every session
  start); `octogent init` writes a template and fills it in when a `.venv`
  exists. `octogent terminal create --inherit-env PATH,VIRTUAL_ENV` copies
  named variables from the caller's shell for one worker; only the names are
  recorded. Order: baseline → `.octogent/env` → inherited → Octogent's own.

### Hub, phase 0: agents learn Octogent (2026-09-22)

- `octogent setup-agents` installs a user-level skill for Claude Code and
  Codex (`~/.claude/skills/octogent/`, `~/.codex/skills/octogent/`; nothing
  else in those homes is touched; `--remove` uninstalls). Every session on the
  machine then loads the coordinator's routine on demand. Three real
  coordinators had learned the CLI from `--help` and made the same mistakes.
- `octogent guide` prints the routine and the exact current command surface
  (both locales); the skill defers to it, so it never goes stale.

### Trial-run fixes (this fork's evolution, phase 7)

- Provider-side failures are visible. Banners the agent CLIs print when their
  provider refuses work (usage limit, rate limit, API error, auth) are
  recognized in the PTY text — neither CLI reports them through hooks — and
  recorded as `providerError` on the terminal with a `provider error: …`
  lifecycle reason; `terminal list` appends `error=<kind>`, `terminal result`
  prints it, `terminal wait` exits 3 once it is 30 s old, and
  `terminal create` warns when the cached usage reading shows the provider
  exhausted. A coordinator had dispatched three rounds into an exhausted
  Codex quota before switching model.
- Codex's "Approaching rate limits — switch to a cheaper model?" prompt is
  handled. It appears after a turn once the account nears its limit, no hook
  reports it, and its default answer is "switch": a follow-up pasted into it
  was swallowed and the worker silently moved from gpt-6-astra to
  gpt-5.6-luna (seen on screen with `terminal screen`). Octogent now answers
  "Keep current model" by default; `OCTOGENT_CODEX_RATE_LIMIT_PROMPT=keep|
  switch|ask` chooses, and `ask` parks the worker as waiting for the user.
- Channel deliveries are confirmed by the agent. "Delivered" used to mean
  "bytes written to the PTY": a Codex "switch to a cheaper model?" dialog that
  no hook reports swallowed a follow-up (and switched the model) while
  `channel send` said delivered. A delivered batch is now unconfirmed until
  the agent's next `user-prompt-submit` hook; when hooks are known to work it
  is re-sent once after 10 s, then marked `failed: not acknowledged` with a
  lifecycle reason. `channel list` shows `pending` / `delivered (unconfirmed)`
  / `confirmed` / `failed`, and the initial prompt keeps first claim on an
  acknowledgement. Verified with a live Claude worker.
- A headless coordinator can now see and answer a worker's terminal.
  `octogent terminal screen <id> [--lines N] [--raw]` replays the retained PTY
  output through a headless terminal emulator (`@xterm/headless`) and prints
  the screen as a person would see it — TUIs paint dialogs with cursor
  addressing, which a strip-the-escapes approach rendered as garbage; the last
  screen is saved when a session ends (`<id>.screen.txt`) and served
  afterwards. `octogent terminal input <id> [text] [--enter] [--keys …]`
  writes to the PTY whatever the agent's state (allow-listed keys, 4 KB cap,
  audited as an `input_submit` transcript event), and `terminal result
  --screen` appends the screen tail. Verified end to end on a real Claude
  permission dialog: `wait` exits 3 → `screen` shows the dialog → `input
  --keys 3` answers it → `wait` exits 0.
- A verdict that post-Stop activity flipped back to `running` is re-evaluated
  once the agent has stayed idle for 20 s. Claude made two tool calls two
  seconds after its Stop hook, no further Stop followed, and the finished
  terminal slid into `stalled` while its coordinator waited (found through
  the new server log).
- The API server always keeps a log file at `<project state>/logs/server.log`
  (timestamped lines, 5 MB rotation with three generations, access tokens
  masked). Verbose hook traffic goes to the file even when
  `OCTOGENT_VERBOSE_LOGS` is off, so a post-mortem no longer depends on
  having switched it on in advance; `OCTOGENT_SERVER_LOG=off|<path>` controls
  it and `octogent logs [--lines N] [--follow]` reads it. Three September
  post-mortems had no server log because stdout lived on a terminal.
- A worker waiting on a dialog is no longer invisible. The runtime records
  since when and on what it waits (`attentionSince` / `attentionKind` /
  `attentionToolName` on the snapshot), dialog repaints stop counting as
  activity so the stall detector fires with a specific reason
  (`waiting for permission: Read (since …)`), `terminal list` appends
  `waiting=permission:Read 7m`, `terminal result` prints a "needs attention"
  line, and `terminal wait` exits with code 3 once a terminal has waited
  longer than `--attention-after` (default 60 s). Verified against a real
  Claude permission dialog.
- Flow view octopuses now look the way they do on the canvas: one shared
  derivation (`apps/web/src/app/octopusVisuals.ts`) gives each tentacle its
  animation, expression, accessory, hair color and color from its id and the
  deck's stored appearance, and the canvas node, canvas panel, deck and flow
  view all use it — the flow view used to draw the same octopus in different
  colors. Octoboss-direct agents keep their place in front of the fan.
- Claude worktree terminals are launched with `--add-dir
  <workspace>/.octogent/tentacles`. Claude Code raises a blocking one-time
  dialog ("Read outside the working directories…") on the first read outside
  a session's working directories, and Octogent's own convention keeps task
  briefs in the main checkout — four workers in a real project froze on that
  read for 41–464 minutes while Octogent reported them as running
  (cross-project log analysis, 2026-09-21). Verified with a live sonnet
  worktree worker: no dialog, task read in seconds.
- `octogent terminal wait <id>...` blocks until the listed terminals settle
  and prints each one's final answer (exit 0 when all reached
  awaiting-review/completed, 1 otherwise, 2 on `--timeout`);
  `octogent terminal result <id>` prints the same block at once. A Codex
  coordinator on a colleague's machine had hand-rolled WebSocket listeners
  to learn that its workers were done — the answer was stored on the Stop
  hook all along, but nothing in the CLI exposed it. The quick-start guide
  gained a "coordinator's routine" section (dispatch → wait → read → follow
  up → review → finish) and the mistakes coordinators keep making.
- Added a Chinese-first getting-work-done guide and full English translation:
  five steps to a reviewed and merged result, a verified CLI quick reference,
  trial pitfalls, and a complete headless coordinator walkthrough. The guide
  also documents the current ephemeral-terminal batch-cleanup exception to
  unmerged-work protection.
- Headless workers created with an initial prompt now keep their PTYs alive
  between turns, so a shared-mode `completed` verdict no longer cuts off later
  channel messages after five minutes. Proven-merged worktree completion still
  releases keep-alive; `awaiting-review` remains exempt. Set
  `OCTOGENT_TERMINAL_RELEASE_AFTER_TURN=1` to restore the previous behavior.
  Manual, bulk, and retention archiving release idle workers' keep-alive;
  stop/delete still close sessions immediately. A worker whose PTY is open
  is never touched by the next batch's cleanup, idle or not, since the
  orchestrator may still continue it over the channel.
- Workers could silently lose `--initial-prompt` when concurrent launches or
  CLI updates took longer than the fixed four-second delay (2026-09-07 trial).
  Claude and Codex now receive it on `SessionStart`, with a 15-second fallback.
  `UserPromptSubmit` acknowledges delivery; sessions with a readiness hook
  retry once after 10 seconds without acknowledgement and expose
  `initial prompt not acknowledged` in snapshots and `terminal list` if the
  retry also times out. Retries are logged with `OCTOGENT_VERBOSE_LOGS=1`;
  agents without readiness hooks are never retried. Input drafts are unchanged.
- Flow view links kept flowing after agents had finished: the animation was
  gated on lifecycle alone, and a PTY stays open after the turn ends. The
  flow view now uses the canvas rule — runtime state known and not idle — via
  `computeActiveNodeIds`, and never flows toward a settled (awaiting-review,
  stalled, shelved) agent.
- A `stalled` verdict was masked back to `running` by the live-PTY snapshot
  mirror, so reloads and `/api/health` showed silent agents as busy. `stalled`
  now survives the mirror like `completed` / `awaiting-review`, and the health
  lifecycle counters use the same resolution as the terminal snapshots.
- Claude worktree terminals never reached `awaiting-review` in repositories
  that do not ignore `.claude/`: the hooks file Octogent writes into the
  worktree showed up as untracked on every Stop and read as unfinished work.
  The completion check now ignores Octogent's own files (file-level status
  listing), and the hook installer adds them to the repository's
  `info/exclude` so agents and operators stop seeing them in `git status`.
- Terminals parked in `awaiting-review` are no longer closed by the idle
  grace five minutes after their last turn; they stay open for the reviewer
  until an operator stops them. The grace itself is now configurable with
  `OCTOGENT_TERMINAL_IDLE_GRACE_MS`.
- `octogent worktree gc` (and the archive sweep's reclaim) asks git at gc
  time: a branch already merged into the operator's branch is reclaimable even
  if its record never learned of the merge, and a branch git says is unmerged
  is protected even if its record claims otherwise. Recorded signals decide
  only when git cannot answer.
- Flow view tentacles now take their color the same way the canvas does
  (deck color, else a per-id palette color); tentacles created without a
  color used to all fall back to the octoboss gold. Links carry their
  tentacle's color, trunk links (octoboss → tentacle) are drawn heavier than
  the fan below, and the traveling dot glows in the same color, so each
  branch reads as one path instead of the octoboss appearing wired straight
  to terminals.
- Flow view cards name the agent behind a node: an agent card shows its CLI
  and model ("Claude Code · opus", "Codex · gpt-5.6-sol"), a tentacle card
  lists the distinct CLIs its agents run. Terminal snapshots now carry
  `agentProvider` for this.
- Long turns no longer read as `stalled` (DEIMv2 trial): only prompt
  submissions refreshed `lastActiveAt`, so one turn with many tool calls and
  no new prompt was flagged two minutes in. Tool calls (PreToolUse) and PTY
  output (throttled) now count as activity, and each tool call is written to
  the Octogent transcript as a `tool_use` event so a long turn has a
  heartbeat instead of a single `processing` line.
- `octogent channel send` says whether the message was delivered or queued
  (the agent was busy; delivery happens when it goes idle), and
  `octogent terminal list` shows `agent=` and `model=`.
- Terminals created without `--model` now learn the model from the Claude
  transcript (`agentModelObserved`); the flow card shows it, or "default
  model" until known. The registry also reads `agentModel` /
  `agentEffortTier` back on load — they were written but never restored, so
  a restart forgot every terminal's model. Learning the model pushes a
  snapshot to the UI immediately instead of waiting for the next lifecycle
  event.
- `octogent terminal create` without `--tentacle-id` now says so: the
  terminal reports directly to the octoboss, and creating a tentacle first
  does not attach later terminals to it by itself (an orchestrator kept
  wondering why its workers hung off the big octopus).

This fork of [hesamsheikh/octogent](https://github.com/hesamsheikh/octogent) is now
maintained independently. This first batch merges the valuable open upstream pull
requests and sets up the independent-maintenance baseline.

### Added

- Integration tests for all deck route handlers, from upstream PR
  [#14](https://github.com/hesamsheikh/octogent/pull/14) (test commit only) by
  @directorsambasivagroup.
- Test coverage for the type coercion utilities, from upstream PR
  [#4](https://github.com/hesamsheikh/octogent/pull/4) by @KomalSrinivasan.
- Stalled-agent detection: a running terminal with no transcript activity for 2
  minutes (configurable via `OCTOGENT_TERMINAL_STALL_MS`) is marked with the new
  `stalled` lifecycle state, from upstream PR
  [#15](https://github.com/hesamsheikh/octogent/pull/15) by @Alecbdc; the web UI
  shows stalled terminals with an attention-style `STALLED` pill (with a zh-CN
  label, 停滞).
- Error boundary around the primary views so a render error in one view cannot
  white-screen the whole shell, ported from upstream PR
  [#5](https://github.com/hesamsheikh/octogent/pull/5) by @carson24wilson-cmyk
  (theme redesign from that PR not taken).
- Unload-time flush of pending UI state so the 250ms persistence debounce cannot
  lose state on tab close, ported from upstream PR
  [#5](https://github.com/hesamsheikh/octogent/pull/5) by @carson24wilson-cmyk
  (implemented with a keepalive `PATCH` fetch instead of `sendBeacon`, which can
  only `POST` and would be rejected by the API).
- An "Environment Variables" section in `docs/reference/cli.md`, based on
  upstream PR [#7](https://github.com/hesamsheikh/octogent/pull/7) by
  @KomalSrinivasan and checked against the variables the API reads today.
- A Windows CI job (advisory, `continue-on-error`) alongside the required Linux
  job.

### Changed

- `OCTOGENT_ALLOW_REMOTE_ACCESS=1` now binds the API to `0.0.0.0` by default
  when `HOST` is not set explicitly, based on upstream PR
  [#7](https://github.com/hesamsheikh/octogent/pull/7) by @KomalSrinivasan.
- `pnpm build` now runs through `scripts/build.mjs`, which falls back to
  `corepack pnpm` when `pnpm` is not on the PATH, from upstream PR
  [#22](https://github.com/hesamsheikh/octogent/pull/22) by @kingmarh-hash.
- pnpm build scripts for `node-pty`, `esbuild`, and `@biomejs/biome` are
  allowlisted (`onlyBuiltDependencies` in both `pnpm-workspace.yaml` and the
  root `package.json` for the pinned pnpm 10.4.1), based on upstream PR
  [#17](https://github.com/hesamsheikh/octogent/pull/17) by
  @TechIntegrationLabs.
- LICENSE and README now record the fork provenance and independent
  maintenance; the license remains MIT with the original copyright preserved.

### Fixed

- `pnpm dev` works on Windows and on paths containing spaces
  (`fileURLToPath` instead of `URL.pathname`, shell spawn on Windows for
  Node ≥ 20.12), from upstream PR
  [#24](https://github.com/hesamsheikh/octogent/pull/24) by @dcx010591-code.
- PTY file-descriptor leak: closed sessions now drop their `IPty` reference so
  the underlying master FD can be released, from upstream PR
  [#15](https://github.com/hesamsheikh/octogent/pull/15) by @Alecbdc.
- Tentacle sizing is capped to sane bounds, from upstream PR
  [#15](https://github.com/hesamsheikh/octogent/pull/15) by @Alecbdc.
- The web UI no longer silently drops terminals in unknown lifecycle states
  from the snapshot list (follow-up to the PR #15 merge).
