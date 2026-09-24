---
name: octogent
description: Coordinate coding-agent workers (Claude Code or Codex) through Octogent from a shell — plan work streams (tentacles), write worker briefs, dispatch with `octogent terminal create`, wait with `terminal wait`, read answers with `terminal result`, unstick dialogs, follow up over the channel, review branches, merge and finish. Use it whenever the user mentions Octogent, octoboss, tentacles, the hub, workers, or says 派发 / 派给 / 触手 / 章鱼; whenever they ask to delegate, parallelize, or hand tasks to other agents; and whenever an `octogent` command is being written, has failed, or a worker looks stuck — even when the word Octogent never appears.
---

# Octogent — coordinating workers from the shell

## What you are working with

- **You are the coordinator** (Octogent's *octoboss* seat). When a worker can do the coding, you do not: you write briefs, dispatch, watch, review, merge, and finish. Your own context stays small; the workers burn theirs.
- **A tentacle** is one work stream, created with `octogent tentacle create <id>`. It owns `<workspace>/.octogent/tentacles/<id>/` (`CONTEXT.md`, `todo.md`; workers may write `RESULT.md` there). Every worker belongs to a tentacle: without `--tentacle-id` a worker hangs directly off the octoboss, which is the single most common mistake.
- **A terminal, or worker,** is one Claude Code or Codex session Octogent starts in its own PTY, named by `--terminal-id`. Lifecycle: `running` → `awaiting-review` (commits on its branch, not merged) or `completed` (merged; or a shared-workspace worker that ended cleanly), else `stopped` / `exited`. `stalled` only means two quiet minutes — usually thinking, not dead.
- **Workspace mode.** `worktree` gives the worker its own git worktree at `<workspace>/.octogent/worktrees/<terminal-id>` on branch `octogent/<terminal-id>`; use it for anything that edits code. `shared` runs in the main checkout: read-only investigation, or edits nothing else touches at the same time.
- **The hub.** One Octogent server serves every registered project. Commands run inside a project directory reach that project; from elsewhere add `--project <slug>`; `octogent hub status` shows what runs. Inside a worker, `OCTOGENT_API_BASE` already points at its own project, so nested `octogent` commands need nothing extra.
- **Environment.** Workers start from a clean baseline, not from your shell. A project's virtualenv or PATH belongs in `<workspace>/.octogent/env` (`octogent init` writes a template); `--inherit-env NAME,...` copies named variables from your shell to one worker.

Run `octogent guide` once per session before the first dispatch: it prints the routine with the exact flags and today's model mapping from the installed version, so it is never stale.

## The routine

1. **Check the ground.** `octogent terminal list` — what is already running (never dispatch over a live worker), `octogent tentacle list`, `git status` in the workspace (a clean main, so merges are yours alone).
2. **One tentacle per stream.** `octogent tentacle create <id> --description "..."`. Reuse an existing one when the work belongs there.
3. **Write the brief** into a file — it is long, and `$(cat file)` keeps the shell out of it. See *Writing the brief* below.
4. **Dispatch.**
   ```bash
   octogent terminal create --terminal-id <worker> --tentacle-id <tentacle> \
     -w worktree --agent-provider claude-code --effort heavy \
     -p "$(cat tasks/<worker>.md)"
   ```
   `--terminal-id` is how you will refer to it everywhere else; pick something readable (`p2-hub-web`, `fix-login-timeout`).
5. **Wait.** `octogent terminal wait <worker> [<worker>...] --timeout 1800`. Exit `0`: every worker finished well. `2`: timeout — sessions stay open, just wait again. **`3`: a worker needs you** — a dialog is blocking it or its provider refused; the printed block says which, then go to *While workers run*. `1`: a worker ended some other way (`exited`, `stopped`) — read its result and screen before doing anything else.
6. **Read the answer.** `octogent terminal result <worker>`: state, a summary (commits, files, diff stats, branch, merged or not) and the worker's final message. `--screen` appends what its terminal shows; `--json` for scripts.
7. **Follow up in the same session**, never with a new worker: `octogent channel send <worker> "..."`, then `octogent channel list <worker>` until the message reads `confirmed`, then `wait` again. A worker sitting idle at its prompt can also be typed at directly: `octogent terminal input <worker> "..." --enter`.
8. **Review.** `git diff --stat main...octogent/<worker>`, read the diff, then run the project's gates **in the worker's worktree** (`cd .octogent/worktrees/<worker>`), not in main. Ask for changes over the channel instead of fixing silently — the worker has the context.
9. **Merge.** `git merge --no-ff octogent/<worker>`; conflicts between parallel workers are yours to resolve. Release notes / changelog are yours too — tell workers not to touch them, or every branch conflicts there.
10. **Finish every worker.** `octogent terminal delete <worker> --with-worktree` after merging (it checks the merge live and refuses to discard unmerged work), otherwise `octogent terminal stop <worker>`. Workers never exit on their own; a forgotten worker keeps its session and quota.

## Writing the brief (most of the job)

A worker knows nothing but its worktree and your brief. Put in it, in this order: where it is and the house rules; the context (what exists, why the change is needed, the exact files and functions involved, decisions already taken so it does not re-ask); the required behavior as a numbered list; the tests you expect; docs to update; the gates to run; how to finish (`commit on your branch, do not push; end with a summary and your doubts`). Say what it must not do (touch the changelog, read outside the worktree, widen scope). Everything the worker would have to ask you is a round trip of minutes — put it in the brief.

Size: a heavy task is 40–90 lines; a light one 10. One deliverable per worker; if the brief has two unrelated halves, that is two workers. The full template and a real example are in `references/brief-template.md`.

## Choosing provider, effort, and mode

| Task | `--effort` | Typical model (today's mapping: `octogent guide`) |
|---|---|---|
| Docs, renames, mechanical edits | `light` | haiku / GPT-6 Luna |
| A focused fix or feature in a known area | `standard` | sonnet / GPT-6 Sol |
| Design + multi-file implementation, new modules | `heavy` | opus / GPT-6 Astra |
| Only when the result matters more than the cost | `max` | fable / GPT-6 Astra xhigh |

`--agent-provider claude-code|codex`; `--model <id>` overrides the tier. Spread load across providers when one is near its usage limit — `terminal create` warns when the provider's quota is exhausted, and `terminal list` shows `error=usage-limit` on workers that hit it. Codex tiers fall back per account (an account that cannot see GPT-6 gets the 5.6 generation automatically). Use `worktree` mode unless the task is read-only.

## While workers run

- A heavy worker takes 20–60 minutes; `wait --timeout 1800` and loop. Do not poll `terminal list` in a tight loop, and do not touch the worker's files while it runs.
- **Exit 3 with `waiting=permission:<tool>`**: `octogent terminal screen <worker>` shows the dialog (`Do you want to proceed? 1. Yes 2. Yes, and don't ask again 3. No`); answer with `octogent terminal input <worker> --keys 1` (or `2` to stop being asked for that command). Then `wait` again.
- **Exit 3 with `error=api-error`** (e.g. `529 Overloaded`): the agent retries on its own for a few minutes; if it gives up, that turn is lost but the session is fine — `octogent terminal input <worker> "Please continue the brief from where you are: check git status and git log on your branch first." --enter`. Never answer a provider error by dispatching a second worker.
- **`error=usage-limit` / `rate-limit` / `auth`**: stop that worker; switch provider or effort, or wait for the reset.
- **`stalled`**: look at `terminal screen` — a spinner with a token counter and `esc to interrupt` means it is working. Only an idle prompt (`❯`) with nothing after the last answer is really idle.
- The Claude survey (`How is Claude doing this session? … 0: Dismiss`) is answered with `octogent terminal input <worker> 0`.
- Everything else: `references/troubleshooting.md`.

## Parallel work

Workers in worktrees can run side by side when they touch different areas (e.g. `apps/api` vs `apps/web`, or different docs). If two briefs need the same file, run them one after the other, or give one worker both halves. Merge in the order they finish and re-run the gates on main after each merge. The hub caps sessions (12 per project, 32 in all by default) — you rarely want more than three or four workers anyway, because reviewing is your bottleneck.

## Mistakes coordinators keep making

- No `--tentacle-id` — the worker lands on the octoboss.
- Polling `terminal list`, writing WebSocket listeners, or calling `/api/...` — `terminal wait` is the whole answer.
- Treating `stalled` as dead and re-dispatching — read `terminal result` and `terminal screen` first.
- Waiting for the worker to "reply over the channel" — answers are read with `terminal result`.
- Dispatching the next batch without finishing the previous one.
- Two shared-workspace workers editing the same file.
- Passing `--help` to `terminal create`: there is no per-command help, and the flag is ignored — the command really creates a terminal. Use `octogent guide` or `octogent --help`.
- Briefs that say "see the discussion above": the worker never saw it.

## References (read on demand)

- `references/commands.md` — every command with its flags, what it prints, and exit codes.
- `references/brief-template.md` — the brief template, a real example, and a checklist.
- `references/troubleshooting.md` — each stuck state, how it looks in `terminal list` / `terminal screen`, and what to do.

## 中文速记

你是协调者（octoboss），代码交给工人写。流程：`octogent terminal list` 看现场 → `octogent tentacle create <触手>` 每条工作线一个 → 把任务书写进文件 → `octogent terminal create --terminal-id <工人> --tentacle-id <触手> -w worktree --agent-provider claude-code --effort heavy -p "$(cat 任务书.md)"` → `octogent terminal wait <工人> --timeout 1800`（退出码 0 完成 / 2 超时再等 / **3 需要你处理**：`terminal screen` 看画面，权限框用 `terminal input <工人> --keys 1`，供应商错误后用 `terminal input <工人> "继续" --enter`）→ `octogent terminal result <工人>` 读回答 → 改意见走 `octogent channel send <工人> "..."`，`channel list` 看到 confirmed 再 `wait` → 到 `.octogent/worktrees/<工人>` 跑测试、看 diff → `git merge --no-ff octogent/<工人>`，变更日志你自己写 → `octogent terminal delete <工人> --with-worktree` 收尾。任务书要自成一体（背景、文件、要求、测试、门禁、"在自己分支提交不要 push、最后给总结和疑问"），一个工人一件事；`stalled` 不等于死了；不带 `--tentacle-id` 工人会挂到大章鱼下；确切的参数以 `octogent guide` 为准。
