# Running Octogent Through the Hub

The hub is one Octogent server for every project on the machine: one process on one fixed address, `http://127.0.0.1:8787`. Each registered project has its dashboard at `/p/<slug>/`, and `/` is an overview of all of them with their running and awaiting-review counts. Run in a project directory, CLI commands reach that project through the hub. A project loads on its first request and unloads after 30 minutes without a session or a request (`OCTOGENT_HUB_PROJECT_IDLE_MS`; `0` keeps it loaded). Unloading keeps everything on disk, and the next request loads the project again. Project state stays where it always was: `.octogent/` in the project and `~/.octogent/projects/<id>/`.

## 1. Start the hub

1. **Automatically.** Run `octogent` in a project directory. It starts the hub if none answers, registers the project if needed, and opens the project's page:

   ```bash
   cd ~/code/my-app
   octogent
   # Octogent dashboard for my-app: http://127.0.0.1:8787/p/my-app/
   ```

   Every other command that needs a server (`octogent terminal list`, `octogent tentacle create`, …) starts the hub the same way. `OCTOGENT_NO_AUTOSTART=1` turns this off, and `OCTOGENT_NO_OPEN=1` keeps the browser closed.

2. **By hand.**

   ```bash
   octogent hub start        # detached; --foreground keeps it in this terminal
   octogent hub status       # address, pid, build, log, and projects
   octogent hub stop
   ```

3. **As a systemd user service** (Linux), so the hub starts on its own and restarts after a crash:

   ```bash
   octogent hub install-service
   loginctl enable-linger "$USER"    # only if it reports lingering is off
   ```

   Once the service is installed, every start of the hub goes through systemd. The service reads its variables from `~/.octogent/hub.env`, not from your shell. See [systemd user service](../reference/systemd.md).

`octogent --standalone` still starts a single-project server of its own (next free port from `8787`). Pick one or the other for a given project, never both at once.

## 2. Projects

1. **Register** a project by running `octogent` (or any server command) inside a git repository, by running `octogent init` there (which also writes `.gitignore` and `.octogent/env`), or with the form on the overview page.
2. **List** them:

   ```bash
   octogent projects
   # * my-app   My App   3f1c…   /home/ada/code/my-app
   ```

3. **Slugs** come from the project name: lowercased, with each run of other characters becoming `-` (`My App` → `my-app`). A clash gets `-2`, `-3`, …, and a renamed project keeps answering to its old slugs.
4. **Pages:** `http://127.0.0.1:8787/` is the overview and `http://127.0.0.1:8787/p/<slug>/` is one project. The switcher at the left of the top bar moves between projects.
5. **From anywhere**, name the project with `--project <slug>`:

   ```bash
   octogent --project my-app                 # open its page
   octogent terminal list --project my-app
   ```

## 3. The worker environment

Workers do not inherit the environment of whatever started the hub: that could be another shell or systemd. Each gets a baseline (`HOME`, `PATH`, locale, proxies, the agent CLIs' own variables, …) plus the following:

1. **Per project, persistent:** `<project>/.octogent/env`, with `KEY=VALUE` lines. It is re-read whenever a session starts, so there is no need to restart anything. A Python project typically needs:

   ```bash
   # .octogent/env
   PATH=$PWD/.venv/bin:$PATH
   VIRTUAL_ENV=$PWD/.venv
   ```

2. **Per terminal:** `--inherit-env` passes named variables from the shell that creates the terminal:

   ```bash
   octogent terminal create --inherit-env AWS_PROFILE,DATABASE_URL -p "…"
   ```

The full order and rules are in [Worker environment](../reference/cli.md#worker-environment).

## 4. Upgrade

```bash
cd ~/src/octogent          # the checkout Octogent was installed from
git pull
pnpm install
pnpm build
octogent hub restart
```

`hub restart` refuses while any project has terminals `running` or `awaiting-review`, because those sessions die with the hub, and it lists them. Let them finish (or stop them) and run it again, or pass `--force`. Until the hub restarts, commands warn once that it runs an older build. With the systemd service installed, the restart goes through systemd too.

## 5. Troubleshooting

1. `octogent hub status` first: is the hub answering, which build is it on, and which projects are loaded?
2. Logs: `~/.octogent/hub/logs/server.log` (`octogent logs` shows the current project's own server log instead). A crash during startup lands in `~/.octogent/hub/logs/daemon-stderr.log`, or in `journalctl --user -u octogent-hub` under systemd.
3. `port 8787 is taken by pid …`: an old single-project server holds the port. See [Port 8787 is taken](../reference/troubleshooting.md#port-8787-is-taken-by-an-old-single-project-server).
4. `the hub is running an older build`: see [The hub is running an older build](../reference/troubleshooting.md#the-hub-is-running-an-older-build).
5. A worker cannot find `python`, `node`, or another tool: see [A worker cannot find python, node, or a tool](../reference/troubleshooting.md#a-worker-cannot-find-python-node-or-a-tool-that-your-shell-has).
6. Access from another machine: the hub binds beyond `127.0.0.1` only with `OCTOGENT_ALLOW_REMOTE_ACCESS=1` and an `OCTOGENT_ACCESS_TOKEN` of at least 32 characters, both set where the hub starts (`hub.env` for the service). See [Run the hub](../reference/cli.md#run-the-hub).
