# CLI Reference

## Start the dashboard

```bash
octogent
```

Starts the local API for the current project and opens the UI when bundled web assets are present.

If the current directory has not been initialized yet, the dashboard still starts, but it runs against a temporary state root and shows a setup card asking you to run `octogent init`. The local `.octogent/` scaffold is created by `octogent init` (or the setup card's **Initialize workspace** action), not by the dashboard itself. Anything created before that point is migrated into the project on initialization.

### Environment Variables

- `HOST`: Host address to bind to (default: `127.0.0.1`, or `0.0.0.0` when `OCTOGENT_ALLOW_REMOTE_ACCESS=1`)
- `OCTOGENT_API_PORT` or `PORT`: Port to listen on (default: `8787`)
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
- `OCTOGENT_EFFORT_MODELS`: JSON map overriding the effort-tier → model mapping per provider, e.g. `{"light":{"claude-code":"haiku","codex":"gpt-5.6-luna@low"}}`; codex entries pack the reasoning effort as `model@reasoning`. Defaults (Codex side follows the models list of 2026-09-08): `light` = haiku / gpt-5.6-luna@low, `standard` = sonnet / gpt-5.6-sol@medium, `heavy` = opus / gpt-6-astra@medium, `max` = fable / gpt-6-astra@xhigh. GPT-6 is rolling out per account, so the Codex tiers carry fallbacks (`standard` → gpt-5.6-terra@medium, `heavy` → gpt-5.6-sol@high, `max` → gpt-5.6-sol@xhigh) that apply when the local Codex models cache (`$CODEX_HOME/models_cache.json`) does not list the first choice; a codex entry in this variable may likewise be a JSON array of candidates in preference order. Codex's `max` and `ultra` reasoning levels are not defaults (`ultra` delegates to its own sub-agents) but can be set through this variable. The Claude entries are family aliases and follow each new generation automatically (currently haiku→Haiku 4.5, sonnet→Sonnet 5, opus→Opus 5, fable→Fable 5.1). Note: a bare `--model` for a codex model without `--effort` inherits codex's own default reasoning level (e.g. gpt-5.6-sol defaults to `low`); only an `--effort` tier sets the reasoning level explicitly
- `OCTOGENT_CODEX_APPROVAL_POLICY`: Codex approval policy: `on-request` or `never` (default: `never`, so unattended terminals are not stranded on approval prompts)
- `OCTOGENT_CODEX_CONFIG`: Override the path of the Codex `config.toml` that Octogent seeds with project trust and hook trust hashes (mainly for test isolation)
- `OCTOGENT_ACCESS_TOKEN`: Access token required from non-loopback clients when remote access is on; auto-generated per session (and printed with the LAN URL) when unset

Example for headless servers:

```bash
OCTOGENT_ALLOW_REMOTE_ACCESS=1 octogent
# or specify a custom host
HOST=192.168.1.100 octogent
```

## Initialize a project

```bash
octogent init [project-name]
```

Creates or updates the `.octogent/` scaffold in the current directory without starting the dashboard.

Use this when you want to initialize the project explicitly or set the project display name ahead of time. In normal use, running `octogent` inside the codebase is enough to initialize and start the app.

## List registered projects

```bash
octogent projects
```

## Create a tentacle

```bash
octogent tentacle create <name> --description "API runtime and routes"
```

Octogent must already be running for this command.

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

## List terminals

```bash
octogent terminal list
```

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
octogent terminal wait <terminal-id> [<terminal-id>...] [--timeout <seconds>] [--interval <seconds>] [--json]
octogent terminal result <terminal-id> [--json]
```

`wait` polls until every listed terminal has settled — `awaiting-review`, `completed`, `stopped`, `exited`, or `stale` — printing each state change on the way, then prints each terminal's result block. The exit code is `0` when all of them ended in `awaiting-review` or `completed`, `1` when any ended another way, and `2` on timeout (`--timeout 0`, the default, waits forever; `--interval` defaults to 5 seconds and never goes below 1). `result` prints the same block immediately without waiting.

The block holds the lifecycle state and reason, the agent and model, the completion summary when there is one (commits, files, branch, merged flag), and the agent's final message as stored from its Stop hook. `--json` prints one JSON object per terminal for scripts. This is how a headless coordinator collects a worker's answer without attaching to its terminal; a worker that wrote its deliverable to a file (a `RESULT.md` under its tentacle, say) usually names the path in that final message.

## Send a message

```bash
octogent channel send <terminal-id> "message"
```

Use `--from <terminal-id>` when sending on behalf of a worker or parent terminal. If `--from` is omitted, the CLI falls back to `OCTOGENT_SESSION_ID` when the command is running inside an Octogent-managed terminal.

## List messages

```bash
octogent channel list <terminal-id>
```
