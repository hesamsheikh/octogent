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

### Trial-run fixes (this fork's evolution, phase 7)

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
