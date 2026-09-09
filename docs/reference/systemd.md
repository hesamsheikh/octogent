# Running Octogent as a systemd User Service

This guide shows how to keep Octogent running in the background on a Linux machine using a systemd user service. A ready-to-edit unit file lives at [`examples/octogent.service`](../../examples/octogent.service).

## Installation

1. Find the absolute path of the `octogent` launcher. systemd does not load your shell profile, so the unit cannot rely on `PATH`:

   ```bash
   which octogent
   ```

2. Copy the example unit into your user unit directory:

   ```bash
   mkdir -p ~/.config/systemd/user
   cp examples/octogent.service ~/.config/systemd/user/octogent.service
   ```

3. Edit `~/.config/systemd/user/octogent.service`:

   - Replace `ExecStart=/absolute/path/to/octogent` with the path from step 1.
   - Replace `WorkingDirectory=%h/your-project` with the project directory the dashboard should manage.
   - Optionally uncomment the `Environment=` lines for `OCTOGENT_ALLOW_REMOTE_ACCESS=1` or `OCTOGENT_API_PORT` (see the [CLI reference](cli.md) for all supported variables).

4. Reload units and start the service:

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now octogent
   ```

5. Check that it is running:

   ```bash
   systemctl --user status octogent
   ```

## Starting on boot

By default, systemd user services only run while you have an active login session. To start Octogent at boot and keep it running after you log out, enable lingering for your user:

```bash
loginctl enable-linger "$USER"
```

Without lingering, the service starts at your first login and stops when your last session ends.

## Viewing logs

Service output goes to the systemd journal:

```bash
journalctl --user -u octogent -f
```

Drop `-f` to page through history instead of following live output.

## systemd vs. a daemon script

Both approaches keep Octogent alive; pick based on your environment:

- **systemd user service** (this guide): the process is supervised directly — crashes are restarted within seconds (`Restart=on-failure`, `RestartSec=3`), logs land in the journal, and start/stop/status use standard `systemctl --user` commands. Prefer this on any Linux host with systemd.
- **Daemon script** (cron or a loop polling `GET /api/health`, see the [API reference](api.md)): works where systemd user services are unavailable (containers, macOS, minimal images) and can layer on custom health logic beyond process liveness. The tradeoff is slower restart detection (polling interval instead of immediate supervision) and log handling you have to wire up yourself.

## Troubleshooting

### `status=127` or "command not found" with nvm

nvm installs Node and global packages under `~/.nvm/versions/node/<version>/bin`, which is added to `PATH` by your shell profile — systemd never sees it. Two things must resolve:

1. `ExecStart` must be the absolute path printed by `which octogent`.
2. The launcher script itself starts with `#!/usr/bin/env node`, so `node` must also be findable. Uncomment the `Environment=PATH=...` line in the unit and set it to include the directory printed by `which node`.

After editing the unit, run `systemctl --user daemon-reload` and restart the service. Note that an `nvm use`/`nvm install` that switches Node versions changes these paths, so update the unit after upgrading Node.

### Port already in use

If the journal shows a bind error, another process (often a manually started `octogent`) already holds the port (default: `8787`). Either stop the other process, or set a different port by uncommenting `Environment=OCTOGENT_API_PORT=...` in the unit, then `daemon-reload` and restart.
