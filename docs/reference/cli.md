# CLI Reference

## Start the dashboard

```bash
octogent
```

Starts the local API for the current project and opens the UI when bundled web assets are present.

If the current directory has not been initialized yet, `octogent` also creates or updates the local `.octogent/` scaffold automatically on first run.

### Environment Variables

- `HOST`: Host address to bind to (default: `127.0.0.1`)
- `OCTOGENT_API_PORT` or `PORT`: Port to listen on (default: `8787`)
- `OCTOGENT_ALLOW_REMOTE_ACCESS`: Set to `1` to bind to `0.0.0.0` instead of `127.0.0.1`, allowing access from other machines
- `OCTOGENT_WORKSPACE_CWD`: Override the workspace directory
- `OCTOGENT_PROJECT_STATE_DIR`: Override the project state directory
- `OCTOGENT_PROMPTS_DIR`: Override the prompts directory
- `OCTOGENT_WEB_DIST_DIR`: Override the web UI distribution directory

Example for headless servers:

```bash
OCTOGENT_ALLOW_REMOTE_ACCESS=1 octogent
# or specify a custom host
HOST=192.168.1.100 octogent
```

## Initialize a project

```bash
octogent init [project-name]
```

Creates or updates the `.octogent/` scaffold in the current directory without starting the dashboard.

Use this when you want to initialize the project explicitly or set the project display name ahead of time. In normal use, running `octogent` inside the codebase is enough to initialize and start the app.

## List registered projects

```bash
octogent projects
```

## Create a tentacle

```bash
octogent tentacle create <name> --description "API runtime and routes"
```

Octogent must already be running for this command.

## List tentacles

```bash
octogent tentacle list
```

## Create a terminal

```bash
octogent terminal create [options]
```

Options:

- `--name`, `-n`: terminal display name
- `--workspace-mode`, `-w`: `shared` or `worktree`
- `--initial-prompt`, `-p`: raw initial prompt text
- `--terminal-id`: explicit terminal ID
- `--tentacle-id`: existing tentacle ID to attach to
- `--worktree-id`: explicit worktree ID
- `--parent-terminal-id`: parent terminal ID for child terminals
- `--prompt-template`: prompt template name
- `--prompt-variables`: JSON object of prompt template variables

## Delete a terminal

```bash
octogent terminal delete <terminal-id>
```

Deletes a terminal and stops its underlying process. This is useful for cleaning up idle or stuck terminals.

Aliases: `octogent terminal stop <terminal-id>`, `octogent terminal kill <terminal-id>`

Example:

```bash
octogent terminal delete terminal-abc123
```

Note: Octogent must be running for this command to work.

## Send a message

```bash
octogent channel send <terminal-id> "message"
```

## List messages

```bash
octogent channel list <terminal-id>
```
