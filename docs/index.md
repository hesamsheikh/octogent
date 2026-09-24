# Octogent Docs

These docs are written for contributors and future coding agents. They explain how Octogent is put together, where state lives, and how local terminal agents are coordinated.

Octogent has three main layers:

- **agent-facing files** in `.octogent/tentacles/<tentacle-id>/`, which hold context, todos, and handoff notes
- **runtime state** under `~/.octogent/projects/<project-id>/state/`, which tracks terminals, UI state, transcripts, and app metadata
- **live sessions** in the API process, where WebSocket connections are attached to PTY-backed Claude Code terminals

## Start here

- [Get Work Done](guides/getting-work-done.md) walks through your first dispatch, reviewed result, and merge in about ten minutes
- [Installation](getting-started/installation.md)
- [Quickstart](getting-started/quickstart.md)
- [Mental Model](concepts/mental-model.md) explains the boundaries between tentacles, terminals, worktrees, and runtime state
- [Running Octogent Through the Hub](guides/hub.md) covers starting the one server every project shares, registering projects, the worker environment, and upgrading

## Concepts

- [Mental Model](concepts/mental-model.md) explains the boundaries between tentacles, terminals, worktrees, and runtime state
- [Tentacles](concepts/tentacles.md) explains the file-backed context model and how Deck reads it
- [Runtime and API](concepts/runtime-and-api.md) explains terminal lifecycle, WebSockets, hooks, persistence, and restart behavior

## Guides

- [Working With Todos](guides/working-with-todos.md) explains how checkbox lines become progress and worker inputs
- [Orchestrating Child Agents](guides/orchestrating-child-agents.md) explains parent/worker spawning, shared mode, and worktree mode
- [Inter-Agent Messaging](guides/inter-agent-messaging.md) explains the in-memory channel queue and delivery rules

## Reference

- [CLI](reference/cli.md)
- [Filesystem Layout](reference/filesystem-layout.md)
- [API](reference/api.md)
- [Experimental Features](reference/experimental-features.md)
- [Running the Hub as a systemd User Service](reference/systemd.md)
- [Troubleshooting](reference/troubleshooting.md)

## Contributor policy

- [Contributing](../CONTRIBUTING.md)
