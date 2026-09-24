# Troubleshooting workers

Each entry: how it looks, what it means, what to do. `terminal list` markers are at the end of the worker's line; `terminal screen <worker>` shows what a person would see.

## `wait` exits 3 — `waiting=permission:<tool> <elapsed>`

The agent CLI is asking for permission. `terminal screen` shows something like:

```
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for: octogent terminal *
   3. No
```

Answer it: `octogent terminal input <worker> --keys 1` (or `2` to allow that command for the rest of the session). A `Read outside the working directories` dialog means the worker wants a file Octogent did not pre-authorize; `1` lets it. Then `terminal wait` again. Claude Code workers dispatched by Octogent run in its automatic permission mode where the project allows it, so these dialogs are the exception, not the rule — a brief that keeps the worker inside its worktree sees very few.

## `wait` exits 3 — `waiting=user <elapsed>`

The agent stopped and is waiting for a person: a question back to you, a menu, a login. `terminal screen` shows what it wants. Answer the question with `channel send` (or `terminal input ... --enter` for a one-liner), answer a menu with `--keys`.

## `wait` exits 3 — `error=api-error`

```
● API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.
✻ Baked for 3m 21s · done 9:08
❯
```

The provider's API failed. Claude Code retries about ten times over three to four minutes; if the screen still shows the error above an idle prompt, that turn was lost — nothing was rolled back, the session is intact. Restart it in place:

```bash
octogent terminal input <worker> "The API returned an error and that turn was lost. Please continue the brief from where you are: check git status and git log on your branch first." --enter
```

Then `wait` again. Do not create a second worker for the same brief: you would get two branches for one task.

## `wait` exits 3 — `error=usage-limit` or `error=rate-limit`

The provider's quota is exhausted (weekly limit, or a rate limit that did not clear). The worker cannot continue on this provider. Options: `terminal stop` it and dispatch the same brief on the other provider (`--agent-provider codex` ↔ `claude-code`), or wait for the reset time the UI's usage panel shows. `terminal create` warns up front when the last usage fetch already says the quota is gone.

## `wait` exits 3 — `error=auth`

The agent CLI is logged out or its token expired. Log in as the operator on that machine (`claude` / `codex login`), then `terminal input <worker> --keys enter` or re-dispatch.

## `stalled`

Two minutes without a hook or output. Look before acting:

- `terminal screen` shows a spinner line such as `✻ Sublimating… (9m 50s · ↓ 44.8k tokens)` with `esc to interrupt`: the agent is thinking or running a long command. Leave it; `wait` again.
- The screen shows an idle prompt (`❯`) under a finished answer, and `terminal result` shows a final answer: the worker is done but its lifecycle has not settled yet (a shared-workspace worker with no commits, for instance). Read the result; `stop` it when you have what you need.
- The screen shows an idle prompt and no answer: the brief may never have arrived (see below), or the agent ended its turn early — `terminal input <worker> "Please continue with the brief." --enter`.

## `initial prompt not acknowledged` (in `terminal result`)

The brief was typed into the agent but the agent never reported receiving it. Usually a startup dialog stood in the way (`Do you trust the files in this folder?`, a theme picker, a login), or the agent CLI crashed. `terminal screen` tells which; answer the dialog with `--keys`, then paste the brief again with `terminal input <worker> "$(cat brief.md)" --enter`.

## The survey

```
● How is Claude doing this session? (optional)
  1: Bad    2: Fine   3: Good   0: Dismiss
```

Claude Code shows this between turns. It blocks nothing but sits on the screen; `octogent terminal input <worker> 0` dismisses it.

## Codex: `Approaching rate limits — Switch to <cheaper model>?`

Octogent answers "Keep current model" for you by default (`OCTOGENT_CODEX_RATE_LIMIT_PROMPT=keep`), because this prompt otherwise swallows the next channel message and silently downgrades the model. If you see it on screen anyway, `--keys down,enter` keeps the model; `--keys enter` accepts the switch.

## `channel list` shows `failed: not acknowledged`

The message was written into the terminal but the agent's session never accepted it as a prompt — typically because a dialog or the survey was in front. Clear the screen (`terminal screen`, then the right `--keys`), then send again. `terminal input <worker> "..." --enter` bypasses the channel when you can see the prompt is idle.

## `wait` exits 1 — `exited` or `stopped`

The agent process ended: it crashed, was told to quit, or the PTY closed. `terminal result` shows the reason and, with `--screen`, the last screen (kept on disk after the session ends). `octogent logs` has the server side. The branch and worktree are still there; to continue, dispatch a new worker on the same tentacle with a brief that starts from that branch's state (`terminal delete` the old record first if you want to reuse the id).

## `terminal delete --with-worktree` refuses

The branch has commits that are not merged into your branch. Merge first (`git merge --no-ff octogent/<worker>`) or, if the work really is to be discarded, `--force`. This refusal is deliberate: nothing in Octogent deletes unmerged work on its own.

## The worker's branch conflicts with main

Another worker merged first. Resolve in main (you own the merge), run the gates again, then delete the worker. To avoid it: workers that touch the same files run one after the other, not in parallel.

## No hub / port taken

`octogent hub status` exits 1 when no hub answers; the next command starts one. `port 8787 is taken by pid <n>` means an old single-project server holds the hub's port — stop it (or run with `--standalone` for the old behavior). `hub is running an older build` after an upgrade: `octogent hub restart` once no worker is running.

## A worker cannot find `python`, `node`, or a tool your shell has

Workers start from a clean environment. Put the project's needs in `<workspace>/.octogent/env` (`PATH=$PWD/.venv/bin:$PATH`, `VIRTUAL_ENV=$PWD/.venv`), which every new session reads, or pass `--inherit-env PATH,VIRTUAL_ENV` on `terminal create` for one worker.
