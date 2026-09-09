# Repository Guidelines

## Code Style First
- Preserve existing patterns before inventing new ones. Read nearby code and match the established module shape, naming, and data flow unless there is a clear reason to change direction.
- Start with tests. For bug fixes, reproduce first. For new features, add the test that defines the behavior before expanding the implementation.
- Implement incrementally. Prefer small, working steps over broad rewrites. Keep the tree passing as you go.
- Think in systems. Extract shared behavior into reusable components, hooks, utilities, or domain functions instead of cloning slightly different versions.
- Keep modules focused. Large React containers should orchestrate, not hold every constant, parser, and JSX block. Keep pure logic in `src/app/*`, UI in `src/components/*`, and CSS split into focused files under `src/styles/*`.
- Comments explain why, not what. Add comments only for constraints, tradeoffs, or non-obvious reasoning.
- Design defensively. Validate assumptions, handle edge cases, and treat security boundaries as part of the implementation, not a follow-up.

## Project Structure
- Monorepo: `apps/*` and `packages/*` via `pnpm-workspace.yaml`.
- Runtime: Node.js 22+, TypeScript, `pnpm`.
- Core package: `packages/core`
  - Framework-agnostic domain types, application logic, and ports.
  - Must stay free of React, HTTP, PTY, and filesystem orchestration concerns.
- API app: `apps/api`
  - Node HTTP/WebSocket server, PTY session runtime, worktree lifecycle, transcript persistence, monitor service.
- Web app: `apps/web`
  - Vite + React operator UI, modular CSS, UI orchestration over API/runtime contracts.
- Runtime state: `.octogent/`
  - `state/tentacles.json`
  - `state/transcripts/*.jsonl`
  - `worktrees/<tentacleId>`

## Documentation Map
- Start at `README.md` for the product overview and command surface.
- Docs index: `docs/index.md`
- Core concepts:
  - `docs/concepts/mental-model.md`
  - `docs/concepts/tentacles.md`
  - `docs/concepts/runtime-and-api.md`
- Workflow guides:
  - `docs/zh-CN/guides/getting-work-done.md` (Chinese-first getting-started workflow)
  - `docs/guides/getting-work-done.md` (full English translation)
  - `docs/guides/working-with-todos.md`
  - `docs/guides/orchestrating-child-agents.md`
  - `docs/guides/inter-agent-messaging.md`
- References:
  - `docs/reference/cli.md`
  - `docs/reference/api.md`
  - `docs/reference/filesystem-layout.md`
  - `docs/reference/troubleshooting.md`
- Read only the docs relevant to the surface you are touching. Do not do a full docs sweep unless the task is documentation maintenance.

## Architecture Boundaries
- `packages/core` defines domain contracts and pure application logic. Both apps may depend on it; it must not depend on app code.
- `apps/api` owns infrastructure concerns: PTYs, WebSockets, filesystem persistence, process execution, and git worktree operations.
- `apps/web` owns presentation and client-side interaction state. Do not move server-only behavior into the web app to avoid adding hidden backend logic to the UI.
- If behavior is reusable across apps, move it into `packages/core` only when it can remain framework-agnostic.
- Keep orchestration thin. Entry points such as API server/bootstrap files and top-level React containers should wire dependencies, not accumulate business logic.

## Workflow
- Read only the guides and code relevant to the surface you are changing. Do not sweep the whole repo before starting.
- Prefer small, isolated edits over broad cleanup unless the task explicitly asks for refactoring.
- Keep docs in sync with behavior changes when user-facing workflows, commands, persistence layout, or architecture assumptions change.
- Preserve the product vocabulary already documented in `CLAUDE.md`: agents, sessions, worktrees, logs, pipelines, tentacles, and terminal columns.

## Verification
- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Test: `pnpm test`
- Lint: `pnpm lint`
- Format: `pnpm format`
- For narrow changes, run the most direct test or package-scoped test first, then widen verification as needed.
- For changes that affect shared contracts, persistence, or cross-app behavior, run the relevant package tests and the root build before landing.

## Scoped Guides
- `apps/api/AGENTS.md` expands server/runtime/worktree rules.
- `apps/web/AGENTS.md` expands UI/component/style rules.
- `packages/core/AGENTS.md` expands domain and ports-and-adapters rules.
