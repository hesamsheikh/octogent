# Octogent CLI — command reference for coordinators

Every command runs from the project directory (or with `--project <slug|id>` from anywhere). `octogent --help` prints the installed version's surface; `octogent guide` prints the routine with today's model mapping. When this file and the installed CLI disagree, the CLI wins.

## Contents

1. Project and hub
2. Tentacles
3. Creating workers — `terminal create`
4. Watching — `terminal list`, `terminal wait`
5. Reading — `terminal result`, `terminal screen`
6. Steering — `terminal input`, `channel send`, `channel list`
7. Ending — `terminal stop`, `terminal delete`, `terminal archive`, `terminal prune`, `worktree gc`
8. Logs and diagnostics

## 1. Project and hub

```bash
octogent                      # open the current project on the hub (starts the hub, registers the project)
octogent init [name]          # scaffold .octogent/ here, write .octogent/env (venv detected), register
octogent projects             # registered projects: slug, name, id, path; * = current
octogent hub status           # address, pid, build, log path, loaded projects; exit 1 when no hub answers
octogent hub start|stop|restart [--force]
octogent guide                # the routine + exact flags + today's effort→model mapping
```

Any command below starts the hub if none answers (`OCTOGENT_NO_AUTOSTART=1` makes that an error instead). A git repository that is not registered yet is registered on first use; a plain directory fails with a hint. Inside a worker, `OCTOGENT_API_BASE` and `OCTOGENT_PROJECT_ID` are preset: commands go to the worker's own project.

## 2. Tentacles

```bash
octogent tentacle create <id> --description "API runtime and routes"
octogent tentacle list
```

Creates `<workspace>/.octogent/tentacles/<id>/` with `CONTEXT.md` and `todo.md`. Ids are lowercase-with-dashes. A tentacle is the unit the web UI groups workers under; it is also where a worker can leave `RESULT.md` if your brief asks for one.

## 3. Creating workers — `terminal create`

```bash
octogent terminal create \
  --terminal-id <worker>            # how you refer to it from now on (unique per project)
  --tentacle-id <tentacle>          # always; otherwise the worker hangs off the octoboss
  -w worktree | shared              # --workspace-mode; worktree = own checkout + branch octogent/<worker>
  --agent-provider claude-code | codex
  --effort light | standard | heavy | max   # or --model <id> (wins over --effort)
  -p "<brief>"                      # --initial-prompt; use -p "$(cat brief.md)"
  [--name "<display name>"]         # shown in the UI; auto-named from the prompt otherwise
  [--inherit-env PATH,VIRTUAL_ENV]  # copy these variables from your shell to this worker only
  [--prompt-template <name> --prompt-variables '<json>']   # a template from prompts/ instead of -p
```

Prints `Created terminal <worker> on tentacle <tentacle>`. Without `--tentacle-id` it also prints a hint that the terminal reports to the octoboss. When the provider's quota is exhausted (per the last usage fetch) it prints a usage warning first — believe it.

What happens next: Octogent starts the agent CLI in a PTY, installs hooks that report the agent's state back, and delivers the brief on the agent's session-start hook (15 s fallback, one retry). `terminal result` shows `initial prompt not acknowledged` as the reason if the brief never went through — look at `terminal screen`.

The brief goes through the shell once: keep it in a file and pass `-p "$(cat file)"`. Terminal ids must be new — `terminal delete` an old one first if you want to reuse the name.

## 4. Watching

### `terminal list`

```
  p2-hub-web    running          pid=2795422 agent=claude-code model=opus  <name>
  fix-login     awaiting-review  pid=2793486 agent=codex       model=gpt-6-sol  <name>
  docs-sweep    running          pid=3134578 agent=claude-code model=haiku  <name> waiting=permission:Bash 3m
  p1b-hub-cli   running          pid=2793486 agent=claude-code model=opus reason=provider error: API Error: 529 … error=api-error
```

One line per live terminal: id, lifecycle state, pid, provider, model, name. While an agent waits on a dialog the line ends with `waiting=permission:<tool> <elapsed>` or `waiting=user <elapsed>`; after a provider error banner it ends with `error=usage-limit | rate-limit | api-error | auth` and shows the banner text as `reason=`. `--archived` lists archived records. `No terminals found.` means nothing is registered.

### `terminal wait`

```bash
octogent terminal wait <worker> [<worker>...] [--timeout <s>] [--interval <s>] [--attention-after <s>] [--json]
```

Blocks until every named terminal settles, then prints one result block per terminal (the same block `terminal result` prints). Exit codes:

| exit | meaning | what to do |
|---|---|---|
| 0 | all `awaiting-review` or `completed` | `terminal result`, review |
| 1 | a terminal ended otherwise (`exited`, `stopped`), or a bad argument / unreachable API | read its result and screen |
| 2 | `--timeout` reached (default 0 = forever) | wait again; nothing was cancelled |
| 3 | needs attention: a dialog has been waiting longer than `--attention-after` (default 60 s; 0 disables), or a provider error has persisted 30 s | `terminal screen`, then `terminal input` |

Exit 3 is checked before the timeout, so a stuck worker surfaces early. `wait` prints result blocks for the terminals that need attention and exits; the others keep running.

## 5. Reading

### `terminal result`

```bash
octogent terminal result <worker> [--json] [--screen]
```

```
== p3-hub-ops  (claude-code · opus)
  State: awaiting-review
  Summary: 5 commits, 40 files, +2020/-372, branch octogent/p3-hub-ops, merged ✗
  Final answer:
    <the worker's last message, verbatim>
```

Works at any time, not only after `wait`. Before the agent has answered, the final-answer line says so. `--screen` appends the last 20 screen lines; `--json` gives `terminalId`, `lifecycleState`, `lifecycleReason`, `summary`, `finalAnswer`, `inheritedEnv`, and so on.

### `terminal screen`

```bash
octogent terminal screen <worker> [--lines N] [--raw]
```

The terminal as a person sees it (a replay of the PTY through a headless terminal; default 40 lines). This is how you read a permission dialog, a survey, a login prompt, or a crash. After the session ends, the last screen is kept on disk and still readable. `--raw` keeps the escape sequences.

## 6. Steering

### `terminal input`

```bash
octogent terminal input <worker> [<text>] [--enter] [--keys enter,esc,up,down,tab,ctrl-c,1-9]
```

Types straight into the PTY (up to 4096 bytes). `--keys 1` answers a numbered dialog; `--keys down,enter` picks the second option; `--enter` submits `<text>` as a prompt to an idle agent. Use it for dialogs and for restarting an agent whose turn was lost to a provider error; use the channel for real follow-ups.

### `channel send` / `channel list`

```bash
octogent channel send <worker> "Please also cover the empty-list case and add a test for it."
octogent channel list <worker>
```

`send` prints whether the message was delivered (written into the idle agent's terminal) or queued (the agent is busy; it is delivered when the agent goes idle). `list` shows each message's status: `pending` → `delivered (awaiting receipt)` → `confirmed` (the agent's session accepted it as a prompt) or `failed: not acknowledged` (send again when the agent is idle, or use `terminal input ... --enter`). Delivery alone is not receipt: wait for `confirmed` before `terminal wait`.

## 7. Ending

```bash
octogent terminal stop <worker>                       # end the session; record stays (stopped)
octogent terminal delete <worker> [--with-worktree] [--force]   # remove the record; --with-worktree also removes its worktree and branch
octogent terminal kill <worker>                       # last resort for a session that will not stop
octogent terminal archive <worker> | --all-completed  # hide finished records from the UI
octogent terminal prune                               # drop stale/stopped/exited records
octogent worktree gc [--dry-run]                      # remove worktrees + branches of archived, merged workers
```

`delete --with-worktree` asks git whether the branch is merged and refuses to discard unmerged commits; that refusal is the safety net for `awaiting-review` work you have not merged yet. Nothing ever auto-deletes unmerged work.

## 8. Logs and diagnostics

```bash
octogent logs [--lines N] [--follow]     # this project's server log (hooks, deliveries, verdicts)
octogent hub status                      # hub log path, loaded projects, build drift
```

The server log records every hook the agents send (`session-start`, `user-prompt-submit`, `pre-tool-use`, `stop`), every channel delivery, and every lifecycle verdict — the first place to look when a worker's state does not match what its screen shows.
