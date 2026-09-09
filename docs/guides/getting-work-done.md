# Get Your First Piece of Work Done With Octogent

## Part 1: Get started in ten minutes

Before starting: install Octogent, sign in to `claude` or `codex`, and have a Git repository with existing commits.

### 1. Start Octogent

Run these two lines in the project directory and leave this window running.
The octoboss (big octopus) on the page is the project's coordination entry point.

```bash
octogent init
octogent
```

Optional: commit the ignore rule that `init` adds to `.gitignore`.

### 2. Create a tentacle

Open another command-line window in the same project directory.
Create a tentacle (little octopus) to hold this work stream's background, todos, and handoff files.

```bash
octogent tentacle create first-task --description "First dispatch, review, and merge"
```

### 3. Give your first task to Claude Code or Codex

A terminal runs one agent session; a worktree is a separate Git checkout for its edits and commits.
This example uses Claude Code; for Codex, replace `claude-code` with `codex`.
`--tentacle-id first-task` sets the attachment; omitting it makes the terminal report directly to the octoboss.

```bash
octogent terminal create --terminal-id first-worker --name "Small documentation fix" \
  --tentacle-id first-task --workspace-mode worktree \
  --agent-provider claude-code --effort standard \
  --initial-prompt "Edit only README.md: use the existing repository content to clarify one first-run instruction so a newcomer has one less thing to guess. Do not invent commands or change code. Run git diff --check and verify that commands mentioned in your change actually exist. Commit on your branch; do not push. End with a summary of the change, checks, and doubts."
```

### 4. Check how it is doing

Use the first command to check progress: `running` means work is in progress, and `awaiting-review` means there are commits and a clean worktree ready to inspect.
To avoid polling, use the second one: it waits until the worker is done and then prints the worker's final answer.

```bash
octogent terminal list
octogent terminal wait first-worker
```

### 5. Review, merge, and finish

Read the diff first and merge when satisfied; the last line closes the session and deletes the terminal record, worktree, and branch.
If your main branch is not named `main`, substitute its name.
If merging opens an editor, save and exit to finish the merge.

```bash
git diff main..octogent/first-worker
git merge --no-ff octogent/first-worker
octogent terminal delete first-worker --with-worktree
```

## Part 2: Quick reference

Replace `<tentacle-id>`, `<terminal-id>`, `<project-id>`, and `<task-brief>` with actual values, removing the angle brackets too. Git examples assume the main checkout is currently on `main`; replace `main` if you use another branch. By default, the worktree ID equals the terminal ID. Each create command in this table creates a new terminal.

| What you want to do | Exact command |
| --- | --- |
| Create a tentacle / find tentacle IDs | `octogent tentacle create api-work --description "API work"` / `octogent tentacle list` |
| Dispatch to Claude Code | `octogent terminal create --name "API worker" --tentacle-id <tentacle-id> --workspace-mode worktree --agent-provider claude-code --initial-prompt "<task-brief>"` |
| Dispatch to Codex | `octogent terminal create --name "API worker" --tentacle-id <tentacle-id> --workspace-mode worktree --agent-provider codex --initial-prompt "<task-brief>"` |
| Choose a model by tier | `octogent terminal create --tentacle-id <tentacle-id> --workspace-mode worktree --agent-provider codex --effort heavy --initial-prompt "<task-brief>"`; tiers are `light`, `standard`, `heavy`, and `max` |
| Choose an explicit model | `octogent terminal create --tentacle-id <tentacle-id> --workspace-mode worktree --agent-provider claude-code --model sonnet --initial-prompt "<task-brief>"` |
| List terminals / archived records | `octogent terminal list` / `octogent terminal list --archived` |
| Read a worker's activity transcript | `tail -n 40 ~/.octogent/projects/<project-id>/state/transcripts/<terminal-id>.jsonl` |
| Wait for a worker and get its answer / read the answer any time | `octogent terminal wait <terminal-id>` / `octogent terminal result <terminal-id>` (add `--json` in scripts) |
| Send a follow-up / check delivery | `octogent channel send <terminal-id> "Add your test results and doubts"` / `octogent channel list <terminal-id>` |
| Stop / archive / delete only the record | `octogent terminal stop <terminal-id>` / `octogent terminal archive <terminal-id>` / `octogent terminal delete <terminal-id>` |
| Read commits and changes | `git -C .octogent/worktrees/<terminal-id> log main..HEAD` / `git diff main..octogent/<terminal-id>` |
| Merge after review passes | `git merge --no-ff octogent/<terminal-id>` |
| Delete the record, worktree, and branch after merging | `octogent terminal delete <terminal-id> --with-worktree` |
| Preview / reclaim archived, merged worktrees | `octogent worktree gc --dry-run` / `octogent worktree gc` |
| Archive completed records / prune inactive records | `octogent terminal archive --all-completed` / `octogent terminal prune` |

## Part 3: Go further

Replace `first-worker` in examples with a current worker ID; Part 1 deleted it. The last section runs independently.

### Before you start, and how to check startup

- Requirements: Node.js 22+, pnpm 10+, Git, `curl`, and a signed-in agent; Linux also needs a `node-pty` toolchain, covered in the [installation guide](../getting-started/installation.md). Work from the project root, save changes, and configure your Git commit identity; worktrees include only committed versions.
- `octogent init` creates `.octogent/` configuration and ignore rules; `octogent` starts the service, using a temporary state root and initialization card for uninitialized projects.
- Ports start at `127.0.0.1:8787` and increment when occupied; `OCTOGENT_API_PORT` or `PORT` sets the starting point. Check startup output for the actual address; an initialized project's CLI reads it automatically.
- Use `OCTOGENT_NO_OPEN=1` without a browser; redirect logs to the file created and printed by `mktemp` to investigate startup, hooks, and retries.

```bash
octogent init
octogent_log=$(mktemp)
printf 'Octogent log: %s\n' "$octogent_log"
OCTOGENT_NO_OPEN=1 OCTOGENT_VERBOSE_LOGS=1 octogent >"$octogent_log" 2>&1 &
```

Verify from another window; substitute the port from startup output. An empty list also means connection succeeded:

```bash
curl --fail --silent --show-error http://127.0.0.1:8787/api/health
octogent terminal list
```

For LAN access, use this startup method: it binds to `0.0.0.0` by default, overridable with `HOST`. The CLI prints access links containing an automatically generated token; alternatively, set a high-entropy `OCTOGENT_ACCESS_TOKEN` of at least 32 characters. Tokens control the project, so give logs containing them only to authorized users.

```bash
OCTOGENT_NO_OPEN=1 OCTOGENT_ALLOW_REMOTE_ACCESS=1 octogent
```

Choose one startup method per project.

### The mental model in five sentences

1. A person or AI coordinator uses the octoboss (big octopus) to assign and review work: tentacles group it, terminals execute it.
2. A tentacle stores background, todos, and handoffs in `CONTEXT.md`, `todo.md`, and other files under `.octogent/tentacles/<tentacle-id>/`, shared by multiple terminals.
3. A terminal is an agent session and record for a specific task; the tentacle ID identifies the work stream, the terminal ID its executor.
4. `worktree` uses an isolated checkout and an `octogent/<terminal-id>` branch for code and parallel tasks; workers commit, the coordinator reviews and merges.
5. `shared` means shared workspace, working directly in the main directory with instructions not to commit, suitable for investigation and small edits; simultaneous edits to the same file collide.

The deck manages tentacle files and todos; see [Mental Model](../concepts/mental-model.md) and [Tentacles](../concepts/tentacles.md).

### Choose an agent, model, and tier

- Select an agent with `--agent-provider claude-code` or `--agent-provider codex`; omission uses the server default.
- Default `--effort` mappings (updated 2026-09-08; `@` precedes the Codex reasoning level):
  - `light`: `haiku` (Haiku 4.5) / `gpt-5.6-luna@low`.
  - `standard`: `sonnet` (Sonnet 5) / `gpt-5.6-sol@medium`, fallback `gpt-5.6-terra@medium`.
  - `heavy`: `opus` (Opus 5) / `gpt-6-astra@medium`, fallback `gpt-5.6-sol@high`.
  - `max`: `fable` (Fable 5.1) / `gpt-6-astra@xhigh`, fallback `gpt-5.6-sol@xhigh`.
- GPT-6 availability varies by account; candidates are selected using `$CODEX_HOME/models_cache.json` (default `~/.codex/models_cache.json`). An unreadable cache or no listed candidate means trying the first choice.
- `--model sonnet` or `--model gpt-5.6-sol` overrides tiers and uses the agent's default reasoning level, even alongside `--effort`. Identifiers start with a letter or digit and contain only letters, digits, `.`, `_`, and `-`.
- Before startup, override mappings with `OCTOGENT_EFFORT_MODELS`; Codex supports `model@reasoning` and candidate arrays. See the [CLI reference](../reference/cli.md).
- Cards and `terminal list` show agent and model (`agent=`, `model=`); Claude's actual model can be learned from its transcript. When unknown, cards say “default model” and the CLI omits `model=`.
- Codex defaults to `workspace-write` for shared mode and `danger-full-access` for worktrees, overridable with `OCTOGENT_CODEX_SANDBOX_MODE`; the former mounts `.git` read-only, preventing commits. Worktrees isolate Git changes, not system permissions; `OCTOGENT_CODEX_APPROVAL_POLICY` defaults to `never` to avoid approval stalls.

### Dispatch: write a complete task brief

Create a tentacle, then use `--name` for identification, `--workspace-mode` for location, and `--initial-prompt` for the task. **Always pass `--tentacle-id`**; omission produces a CLI hint about direct octoboss reporting, with no automatic attachment to an existing tentacle.

Include in the brief:

- The goal and why.
- Exact files or areas.
- Required behavior as a list.
- Tests to add, or documentation checks.
- Gates: API tasks here use `pnpm --filter @octogent/api test`, `pnpm lint`, and `pnpm build`; adapt to other repositories.
- For worktrees, “commit on your branch, do not push”; for shared tasks, “do not commit.”
- A closing summary, doubts, unfinished work, and unverified items.

A complete documentation task for this repository, using an unused name:

```bash
octogent tentacle create install-docs --description "Make the first startup after installation clearer"
octogent_brief=$(cat <<'TASK'
Goal and why: help newly installed users verify that Octogent is running, with less guesswork.
Scope: change only the First run behavior section of docs/getting-started/installation.md.
Required behavior:
- Check apps/api/src/cli.ts for the difference between direct startup and octogent init, and correct inconsistent instructions.
- Explain that the port can increment, so users should check the address in startup output.
- Add startup verification with /api/health and octogent terminal list.
Verification: this is documentation work, so add no code tests; check each claim against CLI source and verify every link and command.
Gates: run git diff --check and pnpm lint; if you cannot run a check, explain why and do not claim it passed.
Commit on your branch, do not push. Do not change other files.
End with a summary of changes, verification results, and doubts; list unverified items.
TASK
)
octogent terminal create --name "Check installation instructions" --tentacle-id install-docs \
  --workspace-mode worktree --agent-provider claude-code --effort standard \
  --initial-prompt "$octogent_brief"
```

- Hooks report startup, tool calls, and turn endings. `SessionStart` triggers initial task delivery, with a fallback 15 seconds after the bootstrap command; `UserPromptSubmit` acknowledges receipt.
- With a readiness hook but no acknowledgement for 10 seconds, delivery retries once; another 10 seconds produces `initial prompt not acknowledged`. Without readiness hooks, no retry occurs, avoiding duplicate tasks. This is a reason field, cleared by a late acknowledgement.
- Inspect the terminal and logs, resolve sign-in/update/trust prompts, then resend with `channel send` once you confirm the task did not start.

### Follow progress: check states and evidence

- `octogent terminal list`: ID, lifecycle, name, and known `pid=`, `agent=`, `model=`, and `reason=` fields.
- `running`: running. `stalled`: a live session with no activity for `OCTOGENT_TERMINAL_STALL_MS` (default 120000 milliseconds). Prompts, tool calls, and output count, with output throttled to every few seconds; check for input waits.
- `awaiting-review`: a clean worktree has unmerged commits beyond the base. `completed`: worktree output is merged, or a shared worker ended a turn. New activity can return either to `running`.
- `stopped`: session closed. `exited`: process exited. `stale`: an old record could not reattach after restart.
- The flow view shows assignments, with links reflecting activity; the canvas opens terminals for output and summaries. Codex's conversation view has no full transcript replay yet.

Default transcript: `~/.octogent/projects/<project-id>/state/transcripts/<terminal-id>.jsonl`. The project ID is in `.octogent/project.json`; use your actual state path if overridden:

```bash
octogent_project_id=$(node -p "JSON.parse(require('node:fs').readFileSync('.octogent/project.json', 'utf8')).projectId")
tail -n 40 "$HOME/.octogent/projects/$octogent_project_id/state/transcripts/first-worker.jsonl"
```

Events: `session_start` begins a session, `state_change` changes agent state, `tool_use` records a tool call, and `session_end` ends a session. These record activity rather than full output; long turns continue recording `tool_use` without repeated `processing` entries.

### Send follow-ups to a running worker

A channel sends follow-up requirements or progress questions:

```bash
octogent channel send first-worker "Explain which commands you verified; tell me first if you have doubts."
octogent channel list first-worker
```

- `send` reports delivered (written into the terminal) or queued (busy, delivered when idle); `list` shows `status=delivered` / `status=pending`.
- Add `--from <sender-terminal-id>` when sending on behalf of a worker; omission uses `OCTOGENT_SESSION_ID` if present.
- Workers with initial tasks keep sessions alive between turns; merged worktree `completed` releases keep-alive, while `awaiting-review` retains it.
- `terminal stop` closes immediately; archiving releases keep-alive, followed by closure after `OCTOGENT_TERMINAL_IDLE_GRACE_MS` (default five minutes). `OCTOGENT_TERMINAL_RETENTION_HOURS` (default 72 hours) archives eligible `completed`, `stopped`, and `exited` records, never awaiting-review records.
- `OCTOGENT_TERMINAL_RELEASE_AFTER_TURN=1` restores release after every turn. Service restarts end sessions and lose in-memory messages; write important handoffs to tentacle files. See [Inter-Agent Messaging](inter-agent-messaging.md).

### Review, test, merge, and clean up

Read summaries, commits, and diffs from the main directory; test changes in the worktree. Below uses a `main` base and this repository's gates for code tasks:

```bash
git -C .octogent/worktrees/first-worker status --short
git -C .octogent/worktrees/first-worker log --oneline main..HEAD
git diff main..octogent/first-worker
git -C .octogent/worktrees/first-worker diff --check main..HEAD
# These gates apply to API code tasks in the Octogent repository.
(
  cd .octogent/worktrees/first-worker
  pnpm install && pnpm --filter @octogent/api test && pnpm lint && pnpm build
)
```

Request corrections by message; once approved, merge, resolve conflicts, and recheck the combined result before cleanup:

```bash
git merge --no-ff octogent/first-worker
# Clean up only after the merge and combined-result checks pass.
octogent terminal stop first-worker
octogent terminal delete first-worker --with-worktree
```

- `delete --with-worktree` closes the session, checks unmerged commits against the main directory's current branch, and refuses worktrees still referenced by other terminals. `--force` bypasses the unmerged warning. Deleting parents includes children, so review the whole chain.
- `terminal archive <terminal-id>` hides records, retains transcripts and summaries, and may immediately reclaim merged worktrees; running records must be stopped first.
- `worktree gc --dry-run` previews; `worktree gc` reclaims archived, merged worktrees and branches. Live Git facts take priority: uncommitted or unmerged work stays; records apply only when Git cannot answer. Shared worktrees require every record to qualify.
- `terminal delete <terminal-id>` keeps worktrees by default; `terminal prune` removes only `stale`, `stopped`, and `exited` records. To reclaim disk space, archive and gc before deleting records.

**Unmerged work must not be deleted automatically; archive reclamation and gc follow this rule, with an exception for ephemeral direct terminals:**

- A direct terminal without a durable tentacle folder, with all parent/child sessions closed and a top-level `completed` / `stopped` / `exited` / `stale` state, is deleted at the next top-level dispatch, which also attempts to remove its worktrees and branches **without checking the merge**. Review and merge before stopping and dispatching again.
- Durable tentacles use archive reclamation; workers with open sessions are protected from next-batch cleanup, busy or idle. Attach tasks producing work to durable tentacles.

### Run batches and parallel workers

- Use one tentacle per work stream; workers from separate `terminal create` calls run concurrently. Set file scopes, use worktrees for code, and review and merge each result.
- Parents assign and review, children execute. Create children with `--parent-terminal-id <parent-terminal-id>` and `--tentacle-id`, up to 9 children per parent.
- The service defaults to 32 active sessions; set `OCTOGENT_MAX_TERMINAL_SESSIONS` before startup according to host resources and account allowances.
- The deck uses `todo.md` checkboxes for single-item solves or swarms (multiple collaborating workers); keep their order during execution and check them off after review. See [Working With Todos](working-with-todos.md) and [Orchestrating Child Agents](orchestrating-child-agents.md).

### The coordinator's routine: dispatch → wait → read → follow up → review → finish

This section is for whoever hands out the work — you, or an AI coordinator (a Claude Code or Codex session) calling commands from a shell. The coordinator does not have to be an Octogent terminal; every step below uses only the CLI, with no browser and no hand-written API or WebSocket code.

1. **Dispatch**: `octogent tentacle create` first, then `octogent terminal create` per worker — **always with `--tentacle-id`** — and give each worker a `--terminal-id` you can refer to later. Say in the brief where the deliverable goes: have the worker write its conclusions to `.octogent/tentacles/<tentacle-id>/RESULT.md` and name the path in its final message.
2. **Wait**: `octogent terminal wait <worker-id> [<worker-id>...] --timeout 600`. It blocks until the workers settle and prints each one's state, summary, and final answer; exit code 0 means all reached awaiting-review or completed, 1 means one ended some other way, 2 means timeout (sessions stay open, so you can wait again).
3. **Read the answer**: `octogent terminal result <worker-id>` prints the same block at any time; use `--json` in scripts. Read the files the answer names (`RESULT.md` and the like) yourself.
4. **Follow up**: `octogent channel send <worker-id> "..."`. A worker created with an initial prompt keeps its session between turns; the message is delivered when it is idle (`send` says delivered or queued). Then `wait` again for the new answer.
5. **Review and merge**: for worktree tasks look at the branch — `git diff main..octogent/<worker-id>`, then `git merge --no-ff octogent/<worker-id>` once satisfied; for shared-workspace tasks read the files it changed.
6. **Finish**: you end every worker — `octogent terminal delete <worker-id> --with-worktree` (once merged) or `octogent terminal stop <worker-id>`. Workers do not exit on their own, and the server allows 32 concurrent sessions by default.

Mistakes coordinators keep making:

- Forgetting `--tentacle-id`, so every worker hangs off the octoboss.
- Attaching to a terminal's WebSocket or polling `/api/terminal-snapshots` to detect completion — `terminal wait` is all you need.
- Treating `stalled` as a dead process and re-dispatching the same task; run `terminal result` first to see what it last said.
- Expecting the worker to "reply" over the channel to a coordinator that is not an Octogent terminal — answers are read with `terminal result`.
- Dispatching the next batch without stopping the previous one, so sessions pile up.

### Trial pitfalls: symptom → cause → action

Based on the 2026-09-05 through 09-08 DEIMv2 and DiveoDevOps trial records:

- **Workers appear under the octoboss** → Missing `--tentacle-id` → Pass the ID every time; the CLI now includes a direct-reporting hint.
- **`npm install` dependency errors** → This repository uses pnpm workspaces → Run `pnpm install` at the root; clean old dependencies using the [installation guide](../getting-started/installation.md). `npm install -g .` installs the global CLI.
- **Claude commits but never awaits review** → Older versions treated unignored `.claude/` hooks as changes → Completion now ignores `.claude/settings.json`, and the installer adds it to Git `info/exclude`; check other uncommitted files.
- **Tool records stop updating** → Hooks may not arrive → Start with `OCTOGENT_VERBOSE_LOGS=1`, look for `[Hook] Received hook`, and inspect the agent directory's `.claude/settings.json` or user-level `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`), plus sign-in and trust prompts.
- **Workers launched together stay silent** → The old fixed four-second delivery preceded input readiness → Now uses `SessionStart`, a 15-second fallback, and one retry. Check `reason=initial prompt not acknowledged` and retry logs; resend after confirming the task did not start.
- **`channel list` is missing messages** → Checking before sending, or treating initial tasks and answers as messages → Confirm `send` succeeded and query the same service; messages from before restart are lost.
- **Seeing `stalled` leads to duplicate dispatch** → Confusing inactivity with exit → Check the terminal, transcript, and `reason=`; tool calls and output now refresh activity, while silence can mean waiting for input.
- **Closure five minutes after the first turn** → Old per-turn keep-alive release → Sessions now persist between turns by default; check `OCTOGENT_TERMINAL_RELEASE_AFTER_TURN=1`. End deliberately with `terminal stop` or archive.
- **Restart kills the wrong process or the service restarts itself** → Confusing worker PID, service PID, and parent process → Find the service PID in the global project directory's `state/runtime.json`; inspect it and its parent with `ps -o pid,ppid,args -p <service-pid>`. For systemd, follow the [service guide](../reference/systemd.md). Finish workers first; backend updates require a restart after rebuilding.
- **GPT-6 availability differs by account** → Different model lists → Use `--effort` for local-cache fallback and check `model=`; explicit `--model` requires account availability and skips tier fallback.

### Further reading

- [CLI reference](../reference/cli.md), [Troubleshooting](../reference/troubleshooting.md).
- [Filesystem Layout](../reference/filesystem-layout.md), [API reference](../reference/api.md).
- [Working With Todos](working-with-todos.md), [Orchestrating Child Agents](orchestrating-child-agents.md), [Inter-Agent Messaging](inter-agent-messaging.md).

### Complete headless coordinator example

Run blocks in the same Bash or AI coordinator shell. Use a clean repository with `README.md` and a configured commit identity, both agents signed in, default state paths, and no API-address overrides; the project must have no service running yet.

Block one: save logs, wait for readiness, create a tentacle, and dispatch two non-overlapping documentation tasks.

```bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
test -f README.md
test -z "$(git status --porcelain)"
octogent_base=$(git branch --show-current)
test -n "$octogent_base"
octogent init
git add .gitignore
git diff --cached --quiet || git commit -m "chore: ignore Octogent workspace"
octogent_log=$(mktemp)
nohup env OCTOGENT_NO_OPEN=1 OCTOGENT_VERBOSE_LOGS=1 octogent >"$octogent_log" 2>&1 < /dev/null &
octogent_server_pid=$!
printf 'Service PID: %s; log: %s\n' "$octogent_server_pid" "$octogent_log"
octogent_project_id=$(node -p "JSON.parse(require('node:fs').readFileSync('.octogent/project.json', 'utf8')).projectId")
octogent_state="$HOME/.octogent/projects/$octogent_project_id/state"
octogent_ready=0
for octogent_attempt in {1..30}; do
  if test -f "$octogent_state/runtime.json"; then
    octogent_api=$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).apiBaseUrl" "$octogent_state/runtime.json")
    octogent_metadata_pid=$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).pid" "$octogent_state/runtime.json")
    if test "$octogent_metadata_pid" = "$octogent_server_pid" && curl --fail --silent --show-error "$octogent_api/api/health"; then
      octogent_ready=1
      break
    fi
  fi
  sleep 1
done
if test "$octogent_ready" != 1; then
  cat "$octogent_log"
  exit 1
fi
octogent terminal list
octogent_batch="docs-batch-$(date +%s)-$$"
octogent_claude="$octogent_batch-claude"
octogent_codex="$octogent_batch-codex"
octogent tentacle create "$octogent_batch" --description "Check first-run instructions and local-directory ignore rules"
octogent terminal create --terminal-id "$octogent_claude" --name "README worker" \
  --tentacle-id "$octogent_batch" --workspace-mode worktree \
  --agent-provider claude-code --effort standard \
  --initial-prompt "Edit only README.md: clarify one first-run instruction using the repository's actual configuration so newcomers can start it. Do not invent commands or change code. Verify the commands involved and run git diff --check. Commit on your branch; do not push. End with a summary of changes, verification, and doubts."
octogent terminal create --terminal-id "$octogent_codex" --name "Ignore-rule documentation worker" \
  --tentacle-id "$octogent_batch" --workspace-mode worktree \
  --agent-provider codex --effort light \
  --initial-prompt "Edit only .gitignore: add a comment beside the existing .octogent ignore rule explaining that it holds local agent configuration and worktrees, which should not be committed as runtime files. Preserve the meaning of every ignore rule. Verify with git check-ignore .octogent/project.json and git diff --check. Commit on your branch; do not push. End with a summary of changes, verification, and doubts."
```

Block two: send a follow-up, then wait up to ten minutes for both workers to finish and print their final answers; on timeout (exit code 2) the sessions stay open for investigation and continuation using logs and transcripts.

```bash
octogent terminal list
octogent channel send "$octogent_claude" "Additional requirement: list the commands you verified and their source files in the commit message to support review without a browser."
octogent channel list "$octogent_claude"
octogent terminal wait "$octogent_claude" "$octogent_codex" --timeout 600
```

Block three: review against the briefs and follow-up. These are documentation gates; code tasks use project tests in each worktree (API tests, lint, and build here).

```bash
for octogent_worker in "$octogent_claude" "$octogent_codex"; do
  git -C ".octogent/worktrees/$octogent_worker" status --short
  test -z "$(git -C ".octogent/worktrees/$octogent_worker" status --porcelain)"
  git -C ".octogent/worktrees/$octogent_worker" log "$octogent_base..HEAD"
  git diff "$octogent_base..octogent/$octogent_worker"
  git -C ".octogent/worktrees/$octogent_worker" diff --check "$octogent_base..HEAD"
done
git -C ".octogent/worktrees/$octogent_codex" check-ignore .octogent/project.json
```

Run the final block after review passes; request corrections with `channel send` and recheck first if needed. Conflicts or failed checks stop execution and retain worktrees; the service and logs remain afterward.

```bash
test "$(git branch --show-current)" = "$octogent_base"
test -z "$(git status --porcelain)"
octogent_review_base=$(git rev-parse HEAD)
git merge --no-ff "octogent/$octogent_claude" -m "docs: merge reviewed startup clarification"
git merge --no-ff "octogent/$octogent_codex" -m "docs: merge reviewed ignore-rule explanation"
git diff --check "$octogent_review_base..HEAD"
git check-ignore .octogent/project.json
for octogent_worker in "$octogent_claude" "$octogent_codex"; do
  git merge-base --is-ancestor "octogent/$octogent_worker" HEAD
  octogent terminal stop "$octogent_worker"
  octogent terminal delete "$octogent_worker" --with-worktree
done
octogent worktree gc --dry-run
octogent terminal list
```
