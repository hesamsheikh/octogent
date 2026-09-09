<div align="center">

<img width="1500" height="500" alt="Octogent header" src="./static/images/octogent-header.png" />
<br/>
<br/>

<strong>too many terminals, not enough tentacles</strong>
<br />
<br />

[中文](README.md) | English
<br />
<br />

![Last Update](https://img.shields.io/github/last-commit/Chang-Tao/octogent?label=Last%20Update&style=flat-square)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-5FA04E?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Follow on X](https://img.shields.io/badge/Follow%20on-X-000000?style=flat-square&logo=x)](https://x.com/Hesamation)
[![Discord](https://img.shields.io/badge/Discord-Open%20Source%20AI%20Builders-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/vtJykN3t)

</div>

## About This Fork

This repository is a fork of [hesamsheikh/octogent](https://github.com/hesamsheikh/octogent). The original project is no longer maintained; this fork continues development independently under the same MIT license.

Many thanks to [@hesamsheikh](https://github.com/hesamsheikh) for creating Octogent, and to the upstream contributors whose pull requests have been merged here:

- [#4](https://github.com/hesamsheikh/octogent/pull/4) type coercion test coverage — @KomalSrinivasan
- [#5](https://github.com/hesamsheikh/octogent/pull/5) error boundary and UI-state flush (partial port) — @carson24wilson-cmyk
- [#7](https://github.com/hesamsheikh/octogent/pull/7) remote-access host binding and env var docs (partial port) — @KomalSrinivasan
- [#14](https://github.com/hesamsheikh/octogent/pull/14) deck route integration tests (test commit) — @directorsambasivagroup
- [#15](https://github.com/hesamsheikh/octogent/pull/15) PTY leak fix, stalled-agent detection, tentacle sizing cap — @Alecbdc
- [#17](https://github.com/hesamsheikh/octogent/pull/17) pnpm build-script allowlist (partial) — @TechIntegrationLabs
- [#22](https://github.com/hesamsheikh/octogent/pull/22) Corepack-compatible build scripts — @kingmarh-hash
- [#24](https://github.com/hesamsheikh/octogent/pull/24) Windows `pnpm dev` fix — @dcx010591-code

# Octogent

It's really not fun to have **ten Claude Code sessions open at once**, constantly switching between them and trying to remember what each one was supposed to do. *Things get blurry fast* when one agent is doing documentation, another is touching the database, another is changing the API, and another is somewhere in the frontend. **Octogent** tries to fix that by giving each job its own <u>scoped context, notes, and task list</u>, while also making it possible for Claude Code to **spawn other Claude Code agents**, assign them work, and communicate with them.

## The Vision

This repo is a personal exploration of what an AI coding environment might look like when terminal coding agents are treated as parts of a bigger orchestration layer, not the final interface by themselves. The point is not to hide **Claude Code** behind abstractions. The point is to make *multi-agent work less chaotic for the developer* on a real codebase.

## Screenshots

<div align="center">
<table>
<tr>
<td><img src="./static/images/preview_1.jpg" alt="Screenshot 1" width="100%"/></td>
<td><img src="./static/images/preview_2.jpg" alt="Screenshot 2" width="100%"/></td>
</tr>
<tr>
<td><img src="./static/images/preview_3.jpg" alt="Screenshot 3" width="100%"/></td>
<td><img src="./static/images/preview_4.jpg" alt="Screenshot 4" width="100%"/></td>
</tr>
<tr>
<td><img src="./static/images/preview_5.jpg" alt="Screenshot 5" width="100%"/></td>
<td><img src="./static/images/preview_6.jpg" alt="Screenshot 6" width="100%"/></td>
</tr>
</table>
</div>

## What Octogent Does for You

- **Creates tentacles as context layers** so agents can work with scoped markdown files instead of broad, messy chat context
- **Uses `todo.md` as an execution surface** so tasks stay visible, trackable, and ready for delegation
- **Runs multiple agent terminals (Claude Code or Codex)** so one developer can coordinate several coding sessions at once
- **Spawns child agents from todo items** so parallel work has a concrete source of truth
- **Supports inter-agent messaging** so workers and coordinators can report completion, blockers, and handoff notes
- **Keeps agent-facing context in files** so the system is more durable than a single prompt thread
- **Provides a local API and UI** for terminal lifecycle, persistence, websocket transport, and orchestration
- **Tracks a completion lifecycle** so the agent's Stop hook decides whether a finished terminal is completed or awaiting review, and stamps a completion summary card (task, commits, diff stats, branch, merged flag, duration)
- **Opens on the flow progress view** — a pseudo-3D layered spread of the whole fleet, with hover cards narrating each node's role and its previous/current/next step
- **Auto-archives finished terminals after a retention period** (`OCTOGENT_TERMINAL_RETENTION_HOURS`, default 72h) and reclaims merged worktrees (`octogent worktree gc`) — unmerged work is never deleted by any automated path
- **Exposes `GET /api/health`** for daemon and monitor probes
- **Runs as a systemd user service** so Octogent can stay up in the background
- **Lets you switch the Claude usage source** via `OCTOGENT_CLAUDE_USAGE_SOURCE` (auto/oauth/cli/off, OAuth first by default)

A **tentacle** is a folder under `.octogent/tentacles/<tentacle-id>/` that holds agent-readable markdown such as `CONTEXT.md`, `todo.md`, and any extra notes needed for that slice of the codebase.

The octopus metaphor is literal: *one octopus, many tentacles, different work happening at the same time*.

## Tentacles

A **tentacle** is a scoped job container. It gives one slice of work its own files, notes, and `todo.md` so the agent is not forced to reconstruct the entire codebase context from chat history.

What it does:

- keeps context local to one area such as documentation, database work, API changes, or frontend work
- gives agents durable files they can read and update
- provides a natural source for delegation through todo items

For the full model, see [Tentacles](docs/concepts/tentacles.md) and [Working With Todos](docs/guides/working-with-todos.md).

## Context, Notes, and Task Lists

In Octogent, a tentacle is not only a task bucket. It is also where the job keeps its local context. That can include notes about one part of the codebase, implementation details, handoff files, and a `todo.md` that tracks what still needs to happen. A Claude Code agent can read and update those files as the work moves forward.

That means you can:

- keep documentation, database, API, or frontend work separated into different job contexts
- store the notes that help an agent understand that part of the codebase
- spawn one agent for one specific item
- break a larger job into multiple items
- launch a swarm so several agents work through the list in parallel
- use the files inside the tentacle as the shared source of truth for what is done and what is left

For the full model, see [Tentacles](docs/concepts/tentacles.md) and [Working With Todos](docs/guides/working-with-todos.md).

## Claude Code Managing Claude Code

One of the main ideas here is that **Claude Code** should not only be treated as a single terminal session waiting for a human prompt. In Octogent, one Claude Code agent can coordinate other Claude Code agents, assign them specific jobs, and exchange short messages with them while the human stays at the orchestration layer.

This is different from Claude Code's subagent spawning, since it allows you to directly see and control what each worker agent is doing.

That means Octogent is not just a dashboard for multiple terminals. It is also a way to structure parent-worker behavior around scoped tasks and shared context files.

For the current model, see [Orchestrating Child Agents](docs/guides/orchestrating-child-agents.md) and [Inter-Agent Messaging](docs/guides/inter-agent-messaging.md).

## How It Works

Octogent separates three concerns that usually get mixed together in a pile of terminals:

1. **Context** lives in `.octogent/tentacles/<tentacle-id>/`. `CONTEXT.md` explains the area, `todo.md` supplies executable work items, and extra markdown files hold notes or handoffs.
2. **Execution** lives in terminal records and PTY sessions managed by the local API. A terminal can attach to an existing tentacle, and several terminals can share one tentacle during swarm work.
3. **Isolation** is optional. Shared terminals run in the main workspace; worktree terminals run under `.octogent/worktrees/<worktree-id>/` on `octogent/<worktree-id>` branches.

Deck reads the tentacle files directly, parses checkbox items from `todo.md`, and uses incomplete items to generate worker prompts. Agent hooks — Claude Code's, or the Codex hooks Octogent auto-provisions — feed the API with agent state, transcript, and idle events so the UI can show more than raw terminal output.

## Quick start

<details>
<summary><strong>Local development</strong></summary>

```bash
pnpm install
pnpm dev
```

This starts the API and web app for local development.

</details>

<details open>
<summary><strong>Current install status</strong></summary>

```bash
Octogent is not published to the npm registry yet.
```

For local development:

```bash
pnpm install
pnpm dev
```

For a local global CLI install from a clone (needs pnpm 10+: `npm install -g pnpm`; on Linux also `build-essential` and `python3` to compile node-pty):

```bash
pnpm install     # must not end with "Ignored build scripts: … node-pty"; run pnpm approve-builds if it does
pnpm build       # repeat after every git pull
npm install -g . # symlinks to the clone; do not move the clone afterwards
octogent --help
```

Do not run `npm install` inside the clone. Full steps and troubleshooting: [installation guide](docs/getting-started/installation.md). The registry install flow `npm install -g octogent` will only work after the package is published.

</details>

On first run, **Octogent** picks an available local API port starting at `8787` and opens the UI unless `OCTOGENT_NO_OPEN=1` is set. In a directory that has not been initialized yet it starts against a temporary state root and prompts you to run `octogent init`, which creates the local `.octogent/` scaffold, assigns a stable project ID, and adopts anything created beforehand.

## Requirements

- Node.js `22+`
- `claude` (Claude Code terminals) and/or `codex` (Codex terminals) — at least one supported agent binary
- `git` for worktree terminals
- `gh` for GitHub pull request features
- `curl` for the agent hook callback flow

Startup fails if neither `claude` nor `codex` is installed. Both **Claude Code** and **Codex** terminals are supported — pick per terminal with `octogent terminal create --agent-provider`. Codex terminals run unattended out of the box: Octogent auto-provisions a shared, session-guarded `hooks.json` in the user-level `$CODEX_HOME` (the only layer the Codex TUI reliably loads from git worktree sessions; the guard keeps non-Octogent Codex sessions untouched) and seeds Codex's `config.toml` with project trust and hook trust hashes. Known Codex limitations: the conversation view has no transcript replay yet (Codex's rollout format is not wired in) and there are no code-intel events.

## What persists

- `.octogent/` keeps project-local scaffold and worktrees
- `~/.octogent/projects/<project-id>/state/` keeps runtime state, transcripts, monitor cache, and metadata
- `.octogent/tentacles/<tentacle-id>/` keeps the context files and todos that agents read

PTY sessions survive browser reloads during the idle grace period, but they do **not** survive an API restart. Octogent marks previously running terminal records as `stale` on startup when it cannot reattach them to a live PTY session; use `octogent terminal list`, `stop`, `kill`, and `prune` to inspect and clean them up. Octogent caps live PTY sessions at 32 by default to protect the host; set `OCTOGENT_MAX_TERMINAL_SESSIONS` to a positive integer to tune that limit for larger orchestration runs. Archiving only hides a finished terminal record from default listings and deletes no files; archived records stay reachable via `octogent terminal list --archived` (or `?includeArchived=1` on the API).

## Docs

- [Get Work Done](docs/guides/getting-work-done.md)
- [Docs Home](docs/index.md)
- [Installation](docs/getting-started/installation.md)
- [Quickstart](docs/getting-started/quickstart.md)
- [Mental Model](docs/concepts/mental-model.md)
- [Tentacles](docs/concepts/tentacles.md)
- [Runtime and API](docs/concepts/runtime-and-api.md)
- [Working With Todos](docs/guides/working-with-todos.md)
- [Orchestrating Child Agents](docs/guides/orchestrating-child-agents.md)
- [Inter-Agent Messaging](docs/guides/inter-agent-messaging.md)
- [CLI Reference](docs/reference/cli.md)
- [Filesystem Layout](docs/reference/filesystem-layout.md)
- [API Reference](docs/reference/api.md)
- [Experimental Features](docs/reference/experimental-features.md)
- [Running as a systemd User Service](docs/reference/systemd.md)
- [Troubleshooting](docs/reference/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)

## Contributor setup
Octogent is not actively reviewing pull requests right now. If you still open one and any code was written with AI, disclose which coding agent and model were used. For contributor workflow and expectations, see [CONTRIBUTING.md](CONTRIBUTING.md).
