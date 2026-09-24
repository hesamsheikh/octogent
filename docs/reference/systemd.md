# Running the Hub as a systemd User Service

On Linux, systemd can run the [hub](../guides/hub.md) for you. It then starts when you log in (or at boot, with lingering), comes back after a crash, and logs to the journal as well as to `~/.octogent/hub/logs/server.log`.

## Install

1. Build the checkout first; the service runs the built CLI:

   ```bash
   cd ~/src/octogent && pnpm build
   ```

2. Optionally write `~/.octogent/hub.env` now (see [Environment](#environment)); the unit always refers to it, so it can also be added later.
3. Install from a normal login shell, one where `which claude` (or `which codex`) works:

   ```bash
   octogent hub install-service
   ```

   This writes `~/.config/systemd/user/octogent-hub.service` (`$XDG_CONFIG_HOME` is honored), runs `systemctl --user daemon-reload` and `systemctl --user enable --now octogent-hub.service`, and tells you when lingering is off.
4. Check it:

   ```bash
   systemctl --user status octogent-hub
   octogent hub status
   ```

Without systemd (macOS, most containers, or a `su`/`sudo` shell with no user manager), the command fails with a message and writes nothing; start the hub with `octogent hub start` there instead. If a hub is already running when you install, for example one that `octogent` started, the service's own hub steps aside, and `octogent hub restart` moves the hub under systemd once its workers are idle.

## What the unit contains

```ini
[Unit]
Description=Octogent hub
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
ExecStart=/home/ada/src/octogent/bin/octogent hub start --foreground
WorkingDirectory=/home/ada
Environment="PATH=/home/ada/.nvm/versions/node/v22.9.0/bin:/home/ada/.local/bin:/usr/bin:/bin"
Environment="OCTOGENT_HOME=/home/ada/.octogent"
EnvironmentFile=-/home/ada/.octogent/hub.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

- `ExecStart` is the launcher of the checkout that ran `install-service`.
- `WorkingDirectory` is your home directory, so the long-lived hub does not hold any project directory open.
- `PATH` is the installing shell's `PATH` with the running Node's directory in front. systemd reads no shell profile, yet the launcher needs `node` and the hub's agents need `claude`, `codex`, and `git`.
- `OCTOGENT_HOME` is the state root the hub serves. The CLI also uses it to recognize the unit as its own hub's.
- `EnvironmentFile=-…` is always present; the `-` makes a missing `hub.env` fine.
- `Restart=on-failure` restarts a crashed hub after 3 seconds, and systemd gives up after 5 failed starts within 2 minutes (a port that stays taken, say).

Run `octogent hub install-service` again after moving the checkout, switching Node versions (nvm) or changing `PATH`, then `octogent hub restart` to apply it. A new or edited `hub.env` only needs `octogent hub restart`. [`examples/octogent-hub.service`](../../examples/octogent-hub.service) is the same unit, for installing by hand.

## Environment

The service's hub never sees your shell's variables. Put the ones it needs in `~/.octogent/hub.env`, one `KEY=value` per line, and keep the file private when it holds a token:

```bash
cat > ~/.octogent/hub.env <<'EOF'
OCTOGENT_HUB_PROJECT_IDLE_MS=3600000
OCTOGENT_ALLOW_REMOTE_ACCESS=1
OCTOGENT_ACCESS_TOKEN=replace-with-at-least-32-random-characters
EOF
chmod 600 ~/.octogent/hub.env
octogent hub install-service    # adds the EnvironmentFile line if it was missing
octogent hub restart
```

A variable set in `hub.env` overrides the same variable set in the unit. Workers get only the baseline described in [Worker environment](cli.md#worker-environment), whatever the hub itself was started with.

## Everyday commands

- `octogent hub status`, `stop`, and `restart` work as usual. With the unit installed, every start of the hub (`hub start`, `hub restart`, the automatic start, bare `octogent`) runs `systemctl --user start octogent-hub`, so the only hub is the one systemd supervises. If systemctl refuses, the CLI warns and starts a detached hub instead.
- `octogent hub stop` stops the service's hub as well. The hub exits cleanly, so systemd leaves it stopped until the next start, login, or boot.
- `systemctl --user restart octogent-hub` works too, but it does not check for live workers the way `octogent hub restart` does.

## Starting on boot

systemd user services run only while you have a login session, unless lingering is on:

```bash
loginctl enable-linger "$USER"
```

Without lingering, the hub starts at your first login and stops when your last session ends. `install-service` checks with `loginctl show-user` and prints this advice when lingering is off.

## Viewing logs

```bash
journalctl --user -u octogent-hub -f
tail -f ~/.octogent/hub/logs/server.log
```

## Removing the service

```bash
octogent hub install-service --remove
```

This disables the service, deletes the unit file, and reloads systemd. A hub that is running keeps running, since it may have live workers; stop it with `octogent hub stop` when they are done.

## Troubleshooting

### `status=127`, or the launcher cannot find `node`

The unit's `PATH` names the Node directory from install time, and an nvm upgrade removes it. Run `octogent hub install-service` again from a shell that has the new Node, then `octogent hub restart`.

### "the hub cannot start without the tools listed above"

`claude` or `codex` is not on the unit's `PATH`. Reinstall from a shell where `which claude` (or `which codex`) works, or add the directory with a `PATH=` line in `hub.env`.

### Port already in use

The journal shows `port 8787 is taken by pid …`: a single-project server (`octogent --standalone`, or one from before the hub) holds the port. Stop it, or set `OCTOGENT_HUB_PORT` in `hub.env`. After 5 failed starts, systemd stops trying until you clear the state:

```bash
systemctl --user reset-failed octogent-hub
systemctl --user start octogent-hub
```

### No systemd

On macOS or in a container, run `octogent hub start` (a detached hub) or have your own supervisor run `octogent hub start --foreground`. A loop or cron job that polls `GET /api/hub/health` can restart it when it stops answering.
