# CLI Reference

## Start the dashboard

```bash
octogent                        # the current project, on the hub
octogent --project <slug|id>    # another registered project, from any directory
octogent --standalone           # a single-project server instead
```

Bare `octogent` (or `octogent start`) opens the current project on the [hub](#run-the-hub). It starts the hub when none answers, as `octogent hub start` would, and registers the project when the hub does not know it yet: a git repository, or a directory with `.octogent/project.json`, which is the same rule [every other command](#which-server-a-command-talks-to) follows. Then it prints `<hub>/p/<slug>/` and opens it in the browser, unless `OCTOGENT_NO_OPEN=1` (or `CI=1`) is set or the web bundle is missing. Outside any project it opens `<hub>/`, the overview of every project. The command returns once the page is open, and the hub keeps running in the background until `octogent hub stop`. `OCTOGENT_NO_AUTOSTART=1` makes it fail with a hint instead of starting a hub. The [hub guide](../guides/hub.md) walks through the whole setup.

It never starts a hub on another port. If something that is not a hub holds the hub's port (typically a single-project server from before the hub), it fails the way `hub start` does, naming that process's pid and its project when known, and points at `--standalone`. If the current project's own single-project server is still running, it prints that server's address and opens it instead: loading the project into the hub as well would put two runtimes over one set of state files. Stop that server and run `octogent` again to move the project to the hub.

`octogent --standalone` starts a single-project server for the current directory, which stays in the foreground until Ctrl-C and takes the first free port from `8787` (`OCTOGENT_API_PORT` or `PORT`). If the directory has not been initialized yet, that server runs against a temporary state root and shows a setup card asking you to run `octogent init`. The local `.octogent/` scaffold is created by `octogent init` (or the setup card's **Initialize workspace** action), not by the server itself, and anything created before that point is migrated into the project on initialization.

### Environment Variables

- `HOST`: Host address to bind to (default: `127.0.0.1`, or `0.0.0.0` when `OCTOGENT_ALLOW_REMOTE_ACCESS=1`)
- `OCTOGENT_API_PORT` or `PORT`: Port a single-project server starts looking from (default: `8787`); the hub uses `OCTOGENT_HUB_PORT` instead
- `OCTOGENT_ALLOW_REMOTE_ACCESS`: Set to `1` to allow access from other machines; this relaxes host/origin checks and, unless `HOST` is set explicitly, binds to `0.0.0.0` instead of `127.0.0.1`
- `OCTOGENT_WORKSPACE_CWD`: Override the workspace directory
- `OCTOGENT_HOME`: Override the global state root (default: `~/.octogent`)
- `OCTOGENT_PROJECT_STATE_DIR`: Override the project state directory
- `OCTOGENT_PROMPTS_DIR`: Override the prompts directory
- `OCTOGENT_WEB_DIST_DIR`: Override the web UI distribution directory
- `OCTOGENT_LOCALE`: UI/CLI locale (`en` or `zh-CN`)
- `OCTOGENT_MAX_TERMINAL_SESSIONS`: Cap on concurrently running terminal sessions
- `OCTOGENT_TERMINAL_STALL_MS`: Milliseconds without transcript activity before a running terminal is marked `stalled` (default: `120000`)
- `OCTOGENT_TERMINAL_IDLE_GRACE_MS`: Milliseconds a PTY with no browser attached stays open after keep-alive is released (default: `300000`, five minutes; invalid values fall back). Workers created with `--initial-prompt` keep their sessions alive between turns, except worktree-mode `completed` terminals whose work is proven merged. `awaiting-review` retains its exemption. Archiving releases keep-alive; stopping closes the session immediately
- `OCTOGENT_TERMINAL_RELEASE_AFTER_TURN`: Set to `1` before starting Octogent to restore releasing worker keep-alive after each Stop hook. Unset or other values keep initial-prompt workers alive between turns. The existing `awaiting-review` and just-delivered channel-message exemptions still apply
- `OCTOGENT_TERMINAL_RETENTION_HOURS`: Hours after which `completed`, `stopped`, and `exited` terminal records are auto-archived; `awaiting-review` records never expire (default: `72`, invalid values fall back to the default)
- `OCTOGENT_CLAUDE_USAGE_SOURCE`: Claude usage data source: `auto` (OAuth first, CLI PTY fallback), `oauth`, `cli`, or `off` to disable collection (default: `auto`)
- `OCTOGENT_CODEX_SANDBOX_MODE`: Codex sandbox mode: `read-only`, `workspace-write`, or `danger-full-access`. When unset, worktree terminals default to `danger-full-access` and shared terminals to `workspace-write` — under `workspace-write` Codex mounts `.git` read-only, so a worktree agent could never commit its work; Claude runs without a sandbox, so this aligns the two providers
- `OCTOGENT_EFFORT_MODELS`: JSON map overriding the effort-tier → model mapping per provider, e.g. `{"light":{"claude-code":"haiku","codex":"gpt-6-luna@medium"}}`; codex entries pack the reasoning effort as `model@reasoning`, and a codex entry may be a JSON array of candidates in preference order. Defaults (Codex side follows the models list of 2026-09-23, when GPT-6 Sol and Luna joined Astra): `light` = haiku / gpt-6-luna@medium, `standard` = sonnet / gpt-6-sol@high, `heavy` = opus / gpt-6-astra@high, `max` = fable / gpt-6-astra@xhigh. Each Codex tier carries fallbacks for accounts the GPT-6 rollout has not reached (`light` → gpt-5.6-luna@medium; `standard` → gpt-5.6-sol@medium, gpt-5.6-terra@medium; `heavy` → gpt-6-sol@xhigh, gpt-5.6-sol@high; `max` → gpt-6-sol@xhigh, gpt-5.6-sol@xhigh), applied when the local Codex models cache (`$CODEX_HOME/models_cache.json`) does not list the first choice; `octogent guide` prints the mapping the installed version applies. The small models are run at their default reasoning level or above because at `low` they start making factual mistakes. Codex's `max` and `ultra` reasoning levels are not defaults (`ultra` delegates to its own sub-agents) but can be set through this variable. The Claude entries are family aliases and follow each new generation automatically (currently haiku→Haiku 4.5, sonnet→Sonnet 5, opus→Opus 5.5, fable→Fable 5.1; Anthropic's own guidance puts everyday feature, debug and review work on Opus 5.5 and planning or result-critical work on Fable, which is how `heavy` and `max` split). Note: a bare `--model` for a codex model without `--effort` inherits codex's own default reasoning level (e.g. gpt-5.6-sol defaults to `low`, the GPT-6 models to `medium`); only an `--effort` tier sets the reasoning level explicitly
- `OCTOGENT_CODEX_RATE_LIMIT_PROMPT`: What Octogent does when Codex shows its "Approaching rate limits — Switch to <cheaper model>?" prompt, which no hook reports and which would otherwise swallow the next pasted message: `keep` (default — answer "Keep current model", so the worker stays on the model you chose; the real limit, when it comes, surfaces as a provider error), `switch` (accept the cheaper model), or `ask` (leave it on screen and mark the worker as waiting for the user, so `terminal wait` exits 3)
- `OCTOGENT_CODEX_APPROVAL_POLICY`: Codex approval policy: `on-request` or `never` (default: `never`, so unattended terminals are not stranded on approval prompts)
- `OCTOGENT_CODEX_CONFIG`: Override the path of the Codex `config.toml` that Octogent seeds with project trust and hook trust hashes (mainly for test isolation)
- `OCTOGENT_ACCESS_TOKEN`: Access token required from non-loopback clients when remote access is on. A single-project server generates one per session (and prints it with the LAN URL) when unset; the hub requires one of at least 32 characters
- `OCTOGENT_VERBOSE_LOGS`: Set to `1` to also print verbose hook and runtime summaries to the terminal. Verbose summaries are always written to the server log
- `OCTOGENT_SERVER_LOG`: Set to `off` to disable the server log, or to a file path to override the default `<project-state-dir>/logs/server.log` (`~/.octogent/hub/logs/server.log` for the hub)
- `OCTOGENT_PTY_ENV_MODE`: Set to `inherit` to hand agent terminals the server's whole environment again (minus the Claude session markers) instead of the baseline described in [Worker environment](#worker-environment). An escape hatch for setups the baseline misses; `.octogent/env` and `--inherit-env` still apply on top

Example for headless servers. The hub reads these variables when it starts, so restart a running one to change them:

```bash
OCTOGENT_ALLOW_REMOTE_ACCESS=1 OCTOGENT_ACCESS_TOKEN="$(openssl rand -hex 32)" octogent hub start
# or bind one address
HOST=192.168.1.100 OCTOGENT_ACCESS_TOKEN="$(openssl rand -hex 32)" octogent hub start
# or a single-project server, which generates a token for the session
OCTOGENT_ALLOW_REMOTE_ACCESS=1 octogent --standalone
```

## Run the hub

```bash
octogent hub start [--foreground]
octogent hub status
octogent hub stop
octogent hub restart [--force]
octogent hub install-service [--remove]
```

The hub is one server for every registered project (see [Hub mode](api.md#hub-mode)). `start` runs it on a fixed port, `OCTOGENT_HUB_PORT` (default `8787`), and never moves to another one: every CLI has to find the one hub without asking. If the port is taken by something that is not a hub, typically a single-project server (`octogent --standalone`, or one from before the hub), `start` fails and names that process's pid, and its project when the server's `runtime.json` records it. Without `--foreground` the hub runs detached: `start` waits up to 15 seconds for it to write `~/.octogent/hub.json` and answer `GET /api/hub/health`, then prints its address. `--foreground` keeps it in the current terminal until Ctrl-C. Either way it logs to `~/.octogent/hub/logs/server.log`; a detached hub's own stderr (a crash before logging starts, say) goes to `~/.octogent/hub/logs/daemon-stderr.log`.

`status` prints the hub's address and whether it answers, its pid and start time, its build next to this CLI's, the log path, and every registered project (`*` marks the current one) with whether it is loaded and how many terminals are running or awaiting review. It exits `1` when no hub answers. `stop` sends `SIGTERM` and waits for the hub to exit, then sends `SIGKILL` after 10 seconds. Because pids are reused after a crash, it signals the pid in `hub.json` only while that process answers as the hub (or, on Linux, its command line shows it is one). `restart` is `stop` followed by `start`, but it refuses while any project has terminals `running` or `awaiting-review` — those sessions die with the hub — and lists them; `--force` restarts anyway.

A project loads on the first request that names it. It unloads after `OCTOGENT_HUB_PROJECT_IDLE_MS` without a PTY session, an open dashboard page, or a request in flight: its context stops, the log records it, and `hub status` and `GET /api/projects` show it as not loaded. Its state stays on disk, and the next request loads it again. A terminal awaiting review keeps its project loaded only while its PTY is open.

`install-service` makes the hub a systemd user service on Linux; see [Running the hub as a systemd user service](systemd.md). Once that unit is installed, every start of the hub (`hub start`, `hub restart`, the automatic start, bare `octogent`) runs `systemctl --user start octogent-hub`, so systemd supervises the only hub. If systemctl refuses, the CLI warns and starts a detached hub as before. `--remove` disables the service and deletes the unit, and leaves a running hub alone.

The hub binds `127.0.0.1`. With `OCTOGENT_ALLOW_REMOTE_ACCESS=1` (or an explicit `HOST`) it binds beyond loopback only when `OCTOGENT_ACCESS_TOKEN` holds a token of at least 32 characters. Unlike a single-project server it never generates one, because a detached hub's token would change on every restart.

- `OCTOGENT_HUB_PORT`: the hub's port (default `8787`)
- `OCTOGENT_NO_AUTOSTART`: set to `1` so commands fail with a hint instead of starting a hub (step 4 below)
- `OCTOGENT_HUB_PROJECT_IDLE_MS`: how long a loaded project may go without sessions or requests before it unloads (default `1800000`, 30 minutes; `0` keeps every project loaded)
- `OCTOGENT_HUB_MAX_TERMINAL_SESSIONS`: PTY sessions across all projects (default `32`); each project also keeps its own cap, `OCTOGENT_MAX_TERMINAL_SESSIONS` (default `12` under a hub)

### Which server a command talks to

Every command that needs a server (`tentacle`, `terminal`, `worktree`, `channel`) picks one in this order:

1. **An explicit base:** `OCTOGENT_API_BASE`, else `OCTOGENT_API_ORIGIN`, used as is. Octogent sets `OCTOGENT_API_BASE` in every worker, already scoped to the worker's project, so the CLI inside a worker always reaches its own project.
2. **The project's own server:** the current project's single-project server, when its `runtime.json` names a live process that answers. Servers started by `octogent --standalone` keep working.
3. **The hub**, when `~/.octogent/hub.json` names a live hub: the command goes to `<hub>/api/p/<id>` for the project named by `--project <slug|id>` or, without it, the project the current directory belongs to (the nearest `.octogent/project.json`, else the registered project whose path contains it). A git repository that is not registered yet is registered on the spot, which scaffolds its `.octogent/`, and the CLI prints one line with its slug; any other directory fails with a hint.
4. **No hub:** the command starts one, as `octogent hub start` would, and continues with step 3. `~/.octogent/hub.lock` makes concurrent commands start a single hub while the others wait for it. `OCTOGENT_NO_AUTOSTART=1` turns this step into an error.

`--project <slug|id>` works on every such command, anywhere on the line, and also accepts a project's former slugs. When the hub runs a different build than the CLI — another version, another `OCTOGENT_BUILD_COMMIT`, or, when no commit is known, a `dist/api/cli.js` rebuilt since the hub started — hub-bound commands print one warning to stderr per command: restart the hub (`octogent hub restart`) when the workers are idle.

## Teach the agents Octogent

```bash
octogent setup-agents            # install the Octogent skill for Claude Code and Codex (user level)
octogent setup-agents --remove
octogent guide                   # print the coordinator's routine and the current command surface
```

`setup-agents` copies one skill directory to `~/.claude/skills/octogent/` and `~/.codex/skills/octogent/` (`CLAUDE_CONFIG_DIR` / `CODEX_HOME` respected) and touches nothing else there. From then on every Claude Code or Codex session on the machine loads the routine on demand — dispatch, `terminal wait`, `terminal result`, follow up, review, finish — without anyone pasting docs into a prompt. The skill defers to `octogent guide` for exact flags, so the installed version always prints the truth; run `setup-agents` again after upgrading Octogent to refresh the copy.

## Initialize a project

```bash
octogent init [project-name]
```

Creates or updates the `.octogent/` scaffold in the current directory without starting the dashboard.

Use this when you want to initialize the project explicitly or set the project display name ahead of time. In normal use, running `octogent` inside a git repository is enough: the hub registers it and creates `.octogent/`. `init` also adds `.octogent` to `.gitignore` and writes `.octogent/env`, which registration leaves alone.

`init` also writes a starter `.octogent/env` (see [Worker environment](#worker-environment)) when the project has none. If it finds `.venv/bin/activate` or `venv/bin/activate`, the virtualenv lines are live, so workers use that environment; otherwise they are left commented as an example. An existing `.octogent/env` is never overwritten, so running `init` again is safe.

## List registered projects

```bash
octogent projects
```

Lists each registered project as its slug (the key in its hub address, `/p/<slug>/`), name, id, and path. `*` marks the project the current directory belongs to.

## Read the server log

```bash
octogent logs [--lines N] [--follow]
```

Prints the last 100 lines of the current project's own server log, the one a `--standalone` server writes. Under the hub, every project logs to `~/.octogent/hub/logs/server.log`, each line tagged `[<slug>]`. Use `--lines N` to choose another positive line count and `--follow` to keep streaming new lines, including across log rotation.

## Create a tentacle

```bash
octogent tentacle create <name> --description "API runtime and routes"
```

Like every server command, it reaches the server described in [Which server a command talks to](#which-server-a-command-talks-to).

## List tentacles

```bash
octogent tentacle list
```

## Create a terminal

```bash
octogent terminal create [options]
```

Options:

- `--name`, `-n`: terminal display name
- `--workspace-mode`, `-w`: `shared` or `worktree`
- `--initial-prompt`, `-p`: raw initial prompt text
- `--terminal-id`: explicit terminal ID
- `--tentacle-id`: existing tentacle ID to attach to. Omit it and the terminal reports directly to the octoboss (its tentacle ID equals its own terminal ID); creating a tentacle first does not attach later terminals to it by itself
- `--worktree-id`: explicit worktree ID
- `--parent-terminal-id`: parent terminal ID for child terminals
- `--agent-provider`: agent provider, `claude-code` or `codex` (defaults to the server-side default)
- `--model`: explicit agent model identifier (letters, digits, `.` `_` `-` only); wins over `--effort`
- `--effort`: effort tier `light`, `standard`, `heavy`, or `max`; the server maps it to a per-provider model (see `OCTOGENT_EFFORT_MODELS`)
- `--prompt-template`: prompt template name
- `--prompt-variables`: JSON object of prompt template variables
- `--inherit-env NAME,...`: pass these variables from your shell to this worker, e.g. `--inherit-env PATH,VIRTUAL_ENV`. Only the named variables leave the CLI; names are upper-case letters, digits, and `_`, at most 64, and the command fails if one is not set in your shell

After a successful create, the CLI prints a warning to stderr when the server's last usage reading shows the chosen provider out of quota: for Codex, its 5-hour or weekly window at 100% or its account limit flag; for Claude, its 5-hour or weekly window, or the weekly bucket of the requested model, at 100%. A reading whose reset time has passed is ignored. Only readings the server already fetched for its usage routes are used — creating a terminal never calls a usage service — so with no reading nothing is printed.

### Worker environment

Agent terminals do not inherit the environment of the shell that started Octogent: one server can serve several projects, and one project's virtualenv or secrets must not leak into another's workers. Each terminal's environment is built in this order, later steps winning:

1. **Baseline** from the server's environment: `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TZ`, `PATH`, `TMPDIR`, `XDG_*`, `SSH_AUTH_SOCK`, `DISPLAY`, `WAYLAND_DISPLAY`, `DBUS_SESSION_BUS_ADDRESS`; what the agent CLIs read: `ANTHROPIC_*`, `CLAUDE_CODE_*`, `CLAUDE_CONFIG_DIR`, `CODEX_*`, `OPENAI_*`, `OCTOGENT_*`, `NODE_*`, `NVM_*`; and the proxy family `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY` (upper and lower case) with `SSL_CERT_FILE` and `SSL_CERT_DIR`. Everything else — `VIRTUAL_ENV`, `DATABASE_URL`, cloud credentials — is dropped. The Claude session markers `CLAUDECODE` and `CLAUDE_CODE_CHILD_SESSION` are always removed: an agent that believes it is a child session stops saving the transcript Octogent reads.
2. **`<project>/.octogent/env`**, when it exists: `KEY=VALUE` lines, `#` comments, blank lines, an optional `export ` prefix, surrounding single or double quotes stripped. `$VAR` and `${VAR}` expand against the baseline and the lines above; `$PWD` is the project root, also for worktree terminals. Single quotes keep `$` literal. The file is re-read whenever a session starts, so edits reach the next session without a restart. Malformed lines are skipped and reported once per session start in the server log; they never stop the terminal.
3. **`--inherit-env` variables** from the shell that created the terminal.
4. **Octogent's own**: `TERM`, `COLORTERM`, `OCTOGENT_SESSION_ID`, `OCTOGENT_API_BASE`.

A Python project typically needs:

```bash
# .octogent/env
PATH=$PWD/.venv/bin:$PATH
VIRTUAL_ENV=$PWD/.venv
```

`.octogent/` is git-ignored, so the file belongs to this clone. With `--inherit-env`, the terminal record keeps only the variable names (`terminal result --json` lists them as `inheritedEnv`); the values stay in the server's memory, so a session started again after a server restart runs without them. Put anything that must persist in `.octogent/env`. `OCTOGENT_PTY_ENV_MODE=inherit` restores copying the server's whole environment.

## List terminals

```bash
octogent terminal list
```

While an agent waits on a dialog, the line appends `waiting=permission:Read 7m` or `waiting=user 3m` (tool name when known, elapsed wait). When the agent CLI has printed a provider error banner, it appends `error=usage-limit`, `error=rate-limit`, `error=api-error`, or `error=auth`; see [Troubleshooting](troubleshooting.md#the-worker-hit-a-usage-limit-or-an-api-error).

Shows each terminal ID, lifecycle state, recorded process ID when available, lifecycle reason, and display name. Archived records are hidden by default; pass `--archived` to list only archived records.

## Stop or kill a terminal

```bash
octogent terminal stop <terminal-id>
octogent terminal kill <terminal-id>
```

`stop` closes an active session or sends `SIGTERM` to the recorded process for a stale terminal. `kill` uses `SIGKILL`.

## Archive terminal records

```bash
octogent terminal archive <terminal-id>
octogent terminal archive --all-completed
```

Archiving stamps `archivedAt` on the record so default listings hide it; transcripts and completion summaries are kept on disk. A running terminal cannot be archived. `--all-completed` archives every record whose lifecycle state is `completed`. Records in `completed`, `stopped`, or `exited` state are also archived automatically once `OCTOGENT_TERMINAL_RETENTION_HOURS` passes; `awaiting-review` records are never auto-archived so unmerged work stays visible.

## Delete a terminal

```bash
octogent terminal delete <terminal-id>
octogent terminal delete <terminal-id> --with-worktree [--force]
```

`delete` (alias `rm`) removes the terminal record. By default it removes only
the record and **keeps the worktree directory on disk** (the iron rule: unmerged
work is never auto-deleted). Pass `--with-worktree` to also remove the worktree
directory and branch — before doing so it checks whether the worktree is still
shared by another terminal (refuses if so) and whether the branch has unmerged
commits (refuses and reports the count; add `--force` to delete anyway).

## Prune inactive terminal records

```bash
octogent terminal prune
```

Removes terminal records whose lifecycle state is `stale`, `stopped`, or `exited`. It does not remove active sessions. Prune only cleans up records — it never touches the disk; use `octogent worktree gc` to reclaim merged worktrees and branches.

## Reclaim merged worktrees

```bash
octogent worktree gc
octogent worktree gc --dry-run
```

Removes the worktree directory and branch of every archived worktree terminal whose work is proven merged. Git is asked at gc time: a worktree whose HEAD is already an ancestor of the operator's branch (and has nothing uncommitted) counts as merged even if its record never learned of the merge, and a branch git says is unmerged is kept even if its record claims otherwise. Only when git cannot answer do the recorded signals decide — a `completed` lifecycle state, or a completion summary that says `merged`. Unmerged work (including `awaiting-review`) is never reclaimed, and a worktree shared by several terminal records is only reclaimed when every record qualifies. `--dry-run` lists the reclaimable worktrees without removing anything. The server also reclaims eligible worktrees automatically when the archive sweep archives their records. Terminal records stay in place either way — that is what `octogent terminal prune` is for.

## Wait for workers and read their answers

```bash
octogent terminal wait <terminal-id> [<terminal-id>...] [--timeout <seconds>] [--interval <seconds>] [--attention-after <seconds>] [--json]
octogent terminal result <terminal-id> [--json] [--screen]
```

`wait` polls until every listed terminal has settled — `awaiting-review`, `completed`, `stopped`, `exited`, or `stale` — printing each state change on the way, then prints each terminal's result block. The exit code is `0` when all of them ended in `awaiting-review` or `completed`, `1` when any ended another way, `2` on timeout, and `3` when a worker needs attention (`--timeout 0`, the default, waits forever; `--interval` defaults to 5 seconds and never goes below 1). `result` prints the same block immediately without waiting.

`--attention-after` defaults to 60 seconds; `0` disables attention exits. On each poll, if any unsettled worker has waited for permission or user input at least that long, `wait` prints the affected workers’ result blocks and exits `3`, before checking the timeout. The age is measured from the start of the dialog, even if it predates this command. An unsettled worker whose provider error (a usage limit, rate limit, API error, or sign-in failure) has stood for 30 seconds also needs attention, whatever `--attention-after` says, unless it is `0`. Exit `1` also covers invalid arguments and API errors.

The block includes a localized attention line with the wait kind, tool name when known, and start time. JSON exposes `attentionKind`, `attentionSince` (ISO time), and `attentionToolName` (null when absent). A recorded provider error adds a line after it with the kind, the banner, and when it appeared; JSON exposes it as `providerError` (`{ kind, message, at }`, or null).

The block holds the lifecycle state and reason, the agent and model, the completion summary when there is one (commits, files, branch, merged flag), and the agent's final message as stored from its Stop hook. `--json` prints one JSON object per terminal for scripts. This is how a headless coordinator collects a worker's answer without attaching to its terminal; a worker that wrote its deliverable to a file (a `RESULT.md` under its tentacle, say) usually names the path in that final message.

## Send a message

```bash
octogent channel send <terminal-id> "message"
```

Use `--from <terminal-id>` when sending on behalf of a worker or parent terminal. If `--from` is omitted, the CLI falls back to `OCTOGENT_SESSION_ID` when the command is running inside an Octogent-managed terminal.

The command prints whether the message was delivered (written into the idle agent's terminal) or queued (the agent is busy), then a reminder that `channel list` shows whether the agent confirmed it. Delivery alone does not prove receipt; see [Inter-agent messaging](../guides/inter-agent-messaging.md#delivered-is-not-received).

## List messages

```bash
octogent channel list <terminal-id>
```

Prints one line per message sent to that terminal through the running API process:

```text
  [msg-3] from=terminal-1 status=delivered (awaiting receipt): Need review on the parser change
```

`status` is one of `pending` (queued), `delivered (awaiting receipt)` (written, no receipt yet), `confirmed` (the agent's next prompt submit arrived), or `failed: <reason>` (`failed: not acknowledged` after two unconfirmed attempts).

## Inspect a screen and send direct input

```bash
octogent terminal screen <id> [--lines N] [--raw]
octogent terminal input <id> [<text>] [--enter] [--keys <name,...>]
octogent terminal result <id> --screen [--json]
```

`screen` prints the last 40 lines by default (`--lines` accepts 1–200). It replays the retained scrollback through a headless terminal emulator (xterm.js) at the session's current size, so cursor-addressed TUI dialogs read as they appear on screen. The replay is limited by the scrollback buffer (about the last 512 KiB of output): anything older is gone, and a repaint that relied on it can come out incomplete. `--raw` returns the unprocessed live tail. On session teardown, the last 200 rendered lines are saved best-effort to `<stateDir>/state/transcripts/<terminalId>.screen.txt`; stripped text (ANSI/OSC removed, carriage-return overwrites applied) is written first and stays if rendering fails or the server exits before it finishes. Without a live session, the saved screen is returned with a “saved at <time>” label. Saved screens contain plain text even with `--raw`. No available screen gives exit code 1; a session that never started or an abruptly killed server may have no saved screen.

`input` works while the agent is busy or waiting for permission. Text is typed directly without bracketed paste, followed by `--keys` in order, then `--enter` sends a carriage return after 150 ms. Allowed keys: `enter`, `esc`, `up`, `down`, `tab`, `ctrl-c`, and `1`–`9`; all others are rejected. Text may be omitted for key-only input; place text beginning with `--` after a `--` separator. Both the JSON request body and decoded input are limited to 4096 bytes (JSON overhead counts toward the body limit). A live PTY is required; this does not start a session. Every accepted request records an `input_submit` audit event. Closing the session before delayed Enter cancels that Enter.

`result --screen` appends 20 lines; with `--json`, it adds `screen: { text, savedAt, raw }` (`null` when unavailable). Live screens have `savedAt: null`; saved screens carry an ISO timestamp.
