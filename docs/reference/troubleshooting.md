# Troubleshooting

## Diagnose a server problem

Run `octogent logs` from the project directory to read the persistent server log, or `octogent logs --follow` to stream it. The default file is `~/.octogent/projects/<project-id>/logs/server.log`; Octogent prints the active path at startup. The file keeps verbose hook summaries even when the terminal stays quiet, rotates at 5 MB, and retains three older generations as `server.log.1` through `server.log.3`.

Set `OCTOGENT_SERVER_LOG=<path>` before startup to use another location, or `OCTOGENT_SERVER_LOG=off` to disable it. Access tokens in LAN URLs are masked in the file, and hook request bodies are not recorded.

The hub keeps one log for every project, `~/.octogent/hub/logs/server.log`, with each line tagged `[<slug>]`; `octogent hub status` prints its path.

## Port 8787 is taken by an old single-project server

`octogent`, `octogent hub start`, or any other command that starts the hub fails with `port 8787 is taken by pid <pid>, a single-project Octogent server for <path>, not a hub`. The hub uses one fixed port so every CLI can find it, and a single-project server got there first: one started with `octogent --standalone`, or by bare `octogent` before it defaulted to the hub. Either:

- stop that server (Ctrl-C in its terminal, or `kill <pid>`) and start the hub again. Stopping it ends its running terminals, so check `octogent terminal list` in that project first. Until it stops, CLI commands in that project keep using it; afterwards they move to the hub on their own.
- or leave it running and give the hub another port: set `OCTOGENT_HUB_PORT` (for example `9787`) in your shell profile, so the hub and every CLI agree on it.

When the message says the pid is unknown, the port belongs to something that is not Octogent; `lsof -i :8787` or `ss -ltnp 'sport = :8787'` shows what.

## The hub is running an older build

Commands print `` Warning: the hub is running an older build (hub …, CLI …); `octogent hub restart` when workers are idle. `` after Octogent was upgraded or rebuilt while the hub kept running: the hub still runs the code it loaded when it started. Most things work, but fixes and routes from the new build are missing until it restarts. Run `octogent hub restart` once `octogent hub status` shows no terminals running or awaiting review. Restart refuses while there are some, since they would die with the hub, and lists them; `--force` restarts anyway.

"A different build" instead of "an older build" means the CLI and the hub come from different installs or commits, for example a global install next to a development checkout; check which `octogent` is first on your `PATH`. Workers never print this warning (their CLI goes straight to `OCTOGENT_API_BASE`), so it does not prompt an agent to restart the hub on its own.

## `pnpm test` fails because of browser APIs

Make sure the workspace dependencies are installed from the repo root:

```bash
pnpm install
```

## Package resolution is broken

Run install from the repository root, not from a subpackage.

## Node version is too old

Use Node.js `22+`.

## Terminal startup fails

Check that your shell environment is available and executable.

If startup fails with `Terminal session limit reached`, Octogent already has the configured number of live PTY-backed sessions. Stop unused terminals with `octogent terminal stop <terminal-id>` or prune inactive records with `octogent terminal prune`. The default cap is 32; set `OCTOGENT_MAX_TERMINAL_SESSIONS` to a positive integer before starting Octogent to adjust it.

## A worker cannot find python, node, or a tool that your shell has

Workers start from a clean baseline, not from the shell that started Octogent, so an activated virtualenv, a `conda` environment, or variables exported only in that shell do not reach them (see [Worker environment](cli.md#worker-environment)). `PATH` itself is kept, but `VIRTUAL_ENV` and anything outside the baseline are not.

- For the whole project, add the variables to `<project>/.octogent/env`, e.g. `PATH=$PWD/.venv/bin:$PATH` and `VIRTUAL_ENV=$PWD/.venv`. `octogent init` writes this for a `.venv/` or `venv/` it finds. The file is re-read at each session start, so no restart is needed; lines it skipped appear in `octogent logs`.
- For one worker, pass them from your shell: `octogent terminal create --inherit-env PATH,VIRTUAL_ENV ...`. These values are not persisted, so after a server restart use `.octogent/env` instead.
- Cloud-provider credentials for the agents themselves (for example `AWS_PROFILE` for Bedrock or `GOOGLE_APPLICATION_CREDENTIALS` for Vertex) are outside the baseline too; add them the same way.
- To confirm the difference is the environment, start Octogent with `OCTOGENT_PTY_ENV_MODE=inherit`, which copies the server's whole environment as before.

## A worker never picked up its initial prompt

Octogent sends `--initial-prompt` when Claude or Codex reports `SessionStart`, with a fallback 15 seconds after the bootstrap command if readiness has not arrived. `UserPromptSubmit` acknowledges delivery. If `SessionStart` was seen but no acknowledgement arrives within 10 seconds of sending, Octogent retries the paste and Enter exactly once. Agents without a `SessionStart` hook are never retried, since missing hooks cannot distinguish a lost prompt from a delivered one.

If the retry is also unacknowledged after 10 seconds, terminal snapshots and `octogent terminal list` show `reason=initial prompt not acknowledged`. The lifecycle stays `running` until the usual stall detector acts; a late acknowledgement clears this reason. Use `octogent logs` to find hook arrivals and `initial-prompt retry` / `initial-prompt not acknowledged after retry` lines; set `OCTOGENT_VERBOSE_LOGS=1` before startup only when you also want them in the terminal. Inspect the worker's terminal for startup, update, trust, or sign-in prompts and resolve them before sending the task again. Check the terminal and logs first to avoid duplicating work that already started.

## A Claude worker froze right after starting (reads outside the working directories)

Claude Code can show a one-time `Read outside the working directories` dialog when a session first reads a path outside its working directories. Octogent adds `<workspace>/.octogent/tentacles` to Claude worktree terminals, so reading task briefs and tentacle docs there does not trigger the dialog. Reads from other outside paths can still raise it.

Answer the dialog once in any interactive `claude` session to settle the choice for that user; Claude stores it in the user settings. If reads were blocked, the dialog notes that removing `permissions.blockReadsOutsideWorkingDirectories` from those settings undoes the Block choice.

## Worktree terminal creation fails

Verify:

- `git --version` works
- the workspace is a git repository
- the current user can create worktrees in `.octogent/worktrees/`

## GitHub summary is unavailable

Verify:

```bash
gh auth status
```

## Monitor refresh fails

Verify your X bearer token and API access.

## A busy terminal reads as `stalled`, and its transcript stops growing

The Octogent transcript (`state/transcripts/<terminal>.jsonl`) records state *changes* (idle → processing and back), plus one `tool_use` event per tool call reported by the agent's PreToolUse hook. A long single turn therefore shows a stream of `tool_use` events rather than repeated `processing` lines. Activity for the stall detector counts prompt submissions, tool calls, and PTY output (throttled to one tick every few seconds), so an agent that is visibly working is never `stalled`; the verdict is reserved for a live PTY that has produced nothing for `OCTOGENT_TERMINAL_STALL_MS`.

If a terminal still reads as stalled while its agent is working, check that the agent's hooks reach the API: use `octogent logs --follow` and look for `[Hook] Received hook` lines when the agent acts. Hooks live in `<workspace>/.claude/settings.json` for Claude and in the user-level `$CODEX_HOME/hooks.json` for Codex.

## `channel send` says the message is queued

That is the normal answer while the target agent is busy. A channel message is injected only when the target session is idle (as reported by its hooks and output detection); until then it stays in the queue with `status=pending`, which `octogent channel list <terminal-id>` shows. It is delivered automatically at the end of the agent's current turn. Note that `channel list` only knows about messages sent to the API process that is running now.

## A channel message shows as delivered but the agent did nothing

"Delivered" means the text was written into the target's terminal, not that the agent received it; a dialog in its TUI (a usage-limit or model-switch prompt, say) can take the paste and the Enter. Run `octogent channel list <terminal-id>` and read the status:

- `confirmed`: the agent submitted a prompt after delivery, so it has the message; look at its terminal for what it is doing with it.
- `delivered (awaiting receipt)`: no receipt yet. Octogent waits 10 seconds per attempt, so a fresh delivery may still be retried; for an agent that has never sent a hook it stays unconfirmed, since nothing can confirm it there.
- `failed: not acknowledged`: Octogent pasted it twice and got no receipt either time. A `running` target also shows `reason=channel message not acknowledged` in `octogent terminal list`, and `octogent logs` has the `[Channel] ... not acknowledged` line.

Then look at what the agent is showing and answer it directly:

```bash
octogent terminal screen <terminal-id> --lines 40
octogent terminal input <terminal-id> --keys esc
```

Once the dialog is gone, send the message again; the reason clears when the agent accepts a prompt. Check the screen first: a message that did get through (a lost receipt, not a lost message) would otherwise be handed over twice.

## The worker's session closed five minutes after its first turn

Previously, a shared-mode worker's first Stop hook marked it `completed` and released its PTY keep-alive. Without a browser, the default five-minute idle grace then closed the session (`session_close`), stranding later channel messages.

Workers created with `--initial-prompt` now stay alive between turns, even when shared-mode completion is reported. A worktree-mode `completed` verdict (proven merged work) still releases keep-alive, and `awaiting-review` remains exempt. If the old pattern persists, unset `OCTOGENT_TERMINAL_RELEASE_AFTER_TURN=1` before restarting Octogent; that override restores the old release behavior. `OCTOGENT_TERMINAL_IDLE_GRACE_MS` controls the grace after release.

When finished, use `octogent terminal stop <terminal-id>` to close the worker immediately or `octogent terminal archive <terminal-id>` to archive an eligible idle worker and release keep-alive. Retention also archives eligible idle workers after `OCTOGENT_TERMINAL_RETENTION_HOURS`. A worker whose PTY is still open is never touched by the next batch's cleanup, idle or not — the orchestrator may still continue it over the channel.

## The coordinator never hears back from its worker

A worker's final message is stored when its Stop hook fires; nothing pushes it to whoever dispatched the worker, and a coordinator that is not itself an Octogent terminal cannot receive channel messages. Use `octogent terminal wait <terminal-id> [...]` to block until the worker settles and print its answer, or `octogent terminal result <terminal-id>` to read it at any time; `--json` for scripts. Both are read-only and work against a running server of any recent version.

## Messages disappear after restart

That is expected. Channel messages are in-memory only and do not persist across API restarts.

## A terminal survived reload but not server restart

That is also expected. PTY sessions can survive a reconnect window, but they do not survive an API restart.

After restart, terminals that were persisted as running are marked `stale` when Octogent cannot reattach them to an in-memory PTY session. Use `octogent terminal list` to inspect lifecycle state, `octogent terminal stop <terminal-id>` or `octogent terminal kill <terminal-id>` for a recorded process, and `octogent terminal prune` to remove stale, stopped, or exited records from the UI.

## A worker is waiting on a dialog

Use `octogent terminal list` to look for `waiting=permission:Read 7m` or `waiting=user 3m`. `octogent terminal result <id>` shows the wait kind, known tool, and when waiting began. Attention does not immediately change the lifecycle: it remains `running` until the stall threshold (`OCTOGENT_TERMINAL_STALL_MS`, default 120000 ms), checked every 30 seconds. Dialog repainting does not refresh activity; a stalled dialog reports a reason such as `waiting for permission: Read (since ...)`.

`octogent terminal wait <id>` exits `3` and prints the affected result block after 60 seconds of waiting for input, checked at each poll. Set `--attention-after <seconds>` to adjust this or `0` to disable it. Run `octogent terminal screen <id>`, review the permission request or question, respond with `terminal input`, and run `wait` again. The PTY remains alive; a needs-attention exit does not stop it. Wait metadata clears when the runtime leaves the waiting state. Avoid starting a duplicate worker for the same task.


Inspect a stuck worker, then choose a response based on the actual dialog (`1` below is an example, not a recommendation to approve every permission):

```bash
octogent terminal screen <id> --lines 40
octogent terminal input <id> "1" --enter
octogent terminal input <id> --keys esc
octogent terminal result <id> --screen
```

`channel send` waits for idle and cannot answer a dialog inside a busy turn; `terminal input` writes directly to a live PTY. Use `result --screen` or `screen` to investigate usage limits, startup failures, and exits; ended sessions show the save time. The screen is an emulator replay of the retained scrollback, so a dialog shows as painted, but output older than the scrollback buffer is not included. A session that never started may have no screen. Restart does not restore the PTY; only screens saved during normal teardown are available.

## The worker hit a usage limit or an API error

Agent CLIs report provider failures only on screen: Codex ends a usage-limited turn without a Stop hook, and Claude prints an API error and then waits. Octogent watches each terminal's PTY output for those banners — usage limits, rate limits, API errors such as a lost connection or an overloaded service, and sign-in failures — and records the first matching line on the terminal as `providerError` (`kind`, `message`, `at`). A banner counts only at the start of a line, so a worker writing about limits in its own prose is not flagged, and retry notices the CLI is still working through are ignored. The same banner repainting does not restart its clock.

While the error stands, the lifecycle stays `running` with the reason `provider error: <message>`, and a stall that follows keeps that reason instead of `no transcript activity`. `octogent terminal list` appends `error=usage-limit` (or `rate-limit`, `api-error`, `auth`), and `octogent terminal result <id>` prints a provider error line after the attention line. `octogent terminal wait` exits `3` once a provider error has stood for 30 seconds, sooner than the dialog threshold, because waiting does not lift a limit; `--attention-after 0` disables this as well. The error clears when the agent makes real progress again — its next tool call, or a Stop hook that yields a completion verdict — and a restarted session starts without one. A new prompt alone does not clear it, since the agent may hit the same wall.

What to do depends on the kind:

- `usage-limit`: do not re-dispatch to the same provider. The banner usually names the reset time; wait for it, or create the worker again with another `--agent-provider` or `--model`.
- `rate-limit` or `api-error`: usually transient. After a short pause, send `continue` with `octogent channel send <id> "continue"` and check that the next tool call clears the error.
- `auth`: sign the CLI in again on the host (run `/login` inside `claude`, or `codex login`); the worker cannot recover by itself.

Detection reads screen text, so a tool result whose first line is itself such a banner (a worker printing an error log, say) can raise it too; the next tool call clears it. `octogent terminal create` also warns when the server's last usage reading already shows the chosen provider out of quota; see [CLI reference](cli.md#create-a-terminal).
