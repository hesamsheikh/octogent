# Quickstart

This is the shortest useful path through the project.

## 1. Start the app

For local development:

```bash
pnpm install
pnpm dev
```

For a local global CLI install from a clone:

```bash
pnpm install
pnpm build
npm install -g .
octogent
```

Octogent is not published to npm yet, so `npm install -g octogent` is not currently a valid quick start path.

Run `octogent` in a project directory (a git repository). It starts the hub if none is running, registers the project, and opens its page at `http://127.0.0.1:8787/p/<slug>/`; `http://127.0.0.1:8787/` lists every project. The hub keeps running in the background. See [Running Octogent through the hub](../guides/hub.md), and `octogent --standalone` for a server of the project's own.

On a fresh workspace, Octogent opens the Deck setup flow first. The setup card verifies the
workspace files, `.gitignore`, and local prerequisites before you create tentacles.

## 2. Create or inspect a tentacle

If the app is already running, you can create a tentacle from the CLI:

```bash
octogent tentacle create api-backend --description "API runtime and request handling"
```

Or use the Deck view in the UI.

Each tentacle becomes a folder under `.octogent/tentacles/<tentacle-id>/`.

## 3. Let the agent build the local context

The tentacle files are where the job keeps its local context:

- `CONTEXT.md` for the local model of that area
- `todo.md` for concrete tasks
- extra markdown files for notes, architecture, handoff, or examples

You do not need to treat these as manual setup that the developer always writes by hand. One of the points of Octogent is that **Claude Code** can help create, update, and maintain these files from inside the app as the work becomes clearer.

## 4. Create a terminal

```bash
octogent terminal create --name "API worker" --tentacle-id api-backend
```

Use `--workspace-mode worktree` if you want an isolated git worktree.

## 5. Delegate from todo items

The runtime can parse incomplete items in `todo.md` and use them as inputs when spawning child agents from the Deck swarm flow. That means one item can become one worker, or a larger list can become a swarm.

## 6. Send a message

```bash
octogent channel send terminal-2 "Need review on the request parser changes"
```

## What to verify

- the tentacle folder exists
- the terminal appears in the UI
- `CONTEXT.md` and `todo.md` exist for that tentacle
- todo progress is visible
- messages show up in the target terminal channel

## Next reading

- [Mental Model](../concepts/mental-model.md)
- [Tentacles](../concepts/tentacles.md)
