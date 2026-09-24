# Writing a worker brief

The brief is the only thing the worker knows besides its worktree. It is dispatched with `-p "$(cat tasks/<worker>.md)"`, so write it as a file.

## Template

```markdown
You are working in a git worktree of <repo> (<stack, e.g. pnpm monorepo, TypeScript, Vitest>). Read <house-rules file, e.g. CLAUDE.md / AGENTS.md> first. Tests first, small commits, comments explain why. Do NOT edit <CHANGELOG.md> (the maintainer writes it at merge). Everything you need is in this brief and inside this worktree — do not read files outside it. Touch only <area>.

## Context
<What exists today, in concrete terms: the modules, functions and files involved, with paths. Why the change is needed. Decisions already taken, so the worker does not reopen them. Anything surprising about the codebase it would otherwise discover the slow way.>

## Required behavior
1. <One numbered item per behavior, stated as what must be true afterwards — command, input, expected output/exit code.>
2. …

## Tests
- <Which test files to add or extend, and what each test proves. Name the harness conventions if there are any (fixtures, mocks, temp dirs).>

## Docs
<Which docs to update, in which languages, and what they must say.>

## Gates before you finish
`<test command>`, `<lint command>` (`<format command>` first if needed), `<build command>`. Commit on your branch in small steps (no push). End with a summary, the exact commands you added, and any doubts.
```

## A real example (condensed)

```markdown
You are working in a git worktree of the Octogent monorepo (pnpm, TypeScript, Vitest, Biome). Read CLAUDE.md and apps/api/AGENTS.md first. Tests first, small commits, comments explain why. Do NOT edit CHANGELOG.md. Everything you need is in this brief and inside this worktree — do not read files outside it.

## Context (hub phase 1b: the CLI side)
`main` has a hub server (`apps/api/src/createHubServer.ts`) that serves every registered project: `GET /api/hub/health`, `GET /api/projects`, `POST /api/projects { path }`, and per-project routes under `/api/p/<key>/api/...`. Nothing starts the hub yet; the CLI (`apps/api/src/cli.ts`) only knows single-project servers via `runtime.json` (`apps/api/src/runtimeMetadata.ts`). Read those files first.

## Required behavior
1. `octogent hub start [--foreground]`, `hub status`, `hub stop`, `hub restart [--force]`. `start` runs the hub on a fixed port (`OCTOGENT_HUB_PORT`, default 8787); if the port is held by something that is not a hub, fail with a message naming the pid — do not hunt for another port. Write `~/.octogent/hub.json` `{ apiBaseUrl, host, port, pid, startedAt, version }` with a stale check (pid alive and `/api/hub/health` answering). Without `--foreground`, daemonize and wait up to 15 s for the hub to answer.
2. Resolution order for every command that talks to a server: (a) `OCTOGENT_API_BASE` explicit; (b) a live single-project `runtime.json`; (c) hub.json alive → `<hub>/api/p/<id>` for `--project <slug|id>` or the current directory's project; (d) no hub → start one, guarded by `~/.octogent/hub.lock`.
3. `restart` refuses while any project has running or awaiting-review terminals unless `--force`, and lists them.

## Tests (apps/api/tests)
- `hubMetadata.test.ts`: write/read/stale (dead pid, missing file, bad json).
- Resolution order as a pure function (`resolveApiTarget({ env, cwd, registry, hubMetadata, runtimeMetadata, projectFlag })`) — one test per branch.
- Lock file: concurrent acquire → one winner; stale lock reclaimed.

## Docs (both languages)
`docs/reference/cli.md` (+zh): the `hub` commands, `--project`, the resolution order in four bullets.

## Do not touch
`createHubServer.ts`, the web app.

## Gates before you finish
Run with `env -u OCTOGENT_VERBOSE_LOGS`: `pnpm --filter @octogent/api test`, `pnpm lint` (`pnpm format` first if needed), `pnpm build`. Commit on your branch in small steps (no push). End with a summary, the exact commands added, and any doubts.
```

That brief produced eight clean commits and a summary that listed exactly the deviations the worker had chosen — the deviations are what you review first.

## Checklist before dispatching

- One deliverable. Two unrelated halves → two workers.
- Every file or function the worker must find is named with its path.
- Decisions already made are stated as facts, not left as questions.
- The tests are named, so "done" is defined.
- The gates are the project's real commands, copied, not paraphrased.
- The ending is prescribed: commit on the branch, no push, summary + doubts.
- The forbidden list is there: changelog, files outside the worktree, unrelated cleanup, pushing.
- Nothing refers to "the conversation" or "as discussed" — the worker was not there.
- For a Python or tool-heavy project: the environment is covered (`.octogent/env`, or `--inherit-env` on the create command).

## When the answer comes back

Read the worker's *doubts* and *deviations* before its diff — that is where a good worker tells you what the brief did not cover. Then the summary's numbers (commits, files, diff stats) against your expectation of the task's size: ten files for a one-line fix means scope creep, one file for a feature means something was skipped.
