# Installation

Octogent is a local Node.js project with a local API and web UI.

## Requirements

- Node.js `22+` (an [nvm](https://github.com/nvm-sh/nvm) install is fine; run `nvm use` in the shell you install from)
- `pnpm` `10+` — the repository is a pnpm workspace. Install it once with `npm install -g pnpm` (or `corepack enable`). Do **not** run `npm install` inside the clone: it cannot resolve the workspace packages and leaves a stray `package-lock.json` behind
- A C++ toolchain for `node-pty`'s native module on Linux: `python3`, `make`, `g++` (`sudo apt install build-essential python3` on Debian/Ubuntu). macOS ships prebuilt binaries. On Windows, install inside WSL — see [Windows: install inside WSL](#windows-install-inside-wsl)
- At least one agent CLI, installed and logged in: `claude` (`npm install -g @anthropic-ai/claude-code`, then run `claude` once to sign in) and/or `codex`
- `git` for worktree terminals
- `curl` for the Claude hook callback flow
- `gh` for GitHub pull request features (optional)

Codex and Claude Code terminals are both supported; pick per terminal with `octogent terminal create --agent-provider`.

## Local development install

```bash
pnpm install
pnpm dev
```

## Local global CLI install from a clone

```bash
git clone http://192.168.8.240/tao.chang/octogent.git   # or the GitHub fork
cd octogent
pnpm install
pnpm build
npm install -g .
octogent --help
```

What each step does, and what to check when it fails:

- `pnpm install` must end without an "Ignored build scripts: … node-pty" warning. If it shows one, the native PTY module was not compiled and Octogent will crash at startup with a missing `pty.node`. Run `pnpm approve-builds` (pick `node-pty`) and `pnpm install` again, or compile it directly:

  ```bash
  cd node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty && npx node-gyp rebuild && cd -
  ```

  Verify with `ls node_modules/.pnpm/node-pty@*/node_modules/node-pty/build/Release/pty.node`.
- `pnpm build` writes `dist/api` and `dist/web`. The global command runs straight from the clone, so this is also the step to repeat after every `git pull`.
- `npm install -g .` links `octogent` into the active Node's `bin` directory (with nvm: `~/.nvm/versions/node/<version>/bin/octogent`) as a symlink to the clone. Do not move or delete the clone afterwards; to relocate it, run `npm install -g .` again from the new path.
- `octogent --help` printing the command list means the install worked. Then run `octogent` inside a project directory.

If an earlier attempt used `npm install` in the clone, clean up first:

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules package-lock.json
```

## Windows: install inside WSL

Octogent runs its agents in POSIX shells (the hook callbacks, the agent launch command and the worker environment are all written for bash), so on Windows it is installed inside WSL 2, not natively. The dashboard still opens in the Windows browser: WSL 2 forwards `127.0.0.1` to Windows.

1. In PowerShell as administrator, if WSL has no distribution yet: `wsl --install -d Ubuntu`, then reboot and create the Linux user it asks for.
2. Open the distribution (`wsl`) and install everything **inside Linux** — a Windows `node`, `pnpm` or `claude` visible on the WSL `PATH` (under `/mnt/c/...` or `/mnt/d/...`) must not be the one used, because its native modules and paths are Windows ones:

   ```bash
   sudo apt update && sudo apt install -y build-essential python3 git curl
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.nvm/nvm.sh && nvm install 22
   npm install -g pnpm@10 @anthropic-ai/claude-code      # and/or: npm install -g @openai/codex
   which node pnpm claude                                 # all three must be under ~/.nvm, not /mnt/
   ```

3. Clone and build as in [Local global CLI install from a clone](#local-global-cli-install-from-a-clone), in the Linux home (`~/octogent`), not under `/mnt/c` — the Windows filesystem is slow from WSL and breaks file watching.
4. Sign the agent CLIs in **inside WSL** once (`claude`, `codex login`); the Windows logins are separate and are not used.
5. Keep your projects in the Linux filesystem too (`~/code/...`), and run `octogent` from there. Open the printed `http://127.0.0.1:8787/p/<slug>/` in the Windows browser.

If WSL's `PATH` picks Windows tools first, either put nvm first (it does so in a login shell) or stop WSL from appending the Windows `PATH` by adding to `/etc/wsl.conf`:

```ini
[interop]
appendWindowsPath = false
```

then `wsl --shutdown` from PowerShell.

Keep the hub alive. Windows stops a WSL distribution shortly after its last `wsl` session closes, and the hub (with every worker) stops with it. Keep one session open for the hub — a terminal tab running `wsl -- bash -c '. ~/.nvm/nvm.sh && octogent hub start --foreground'` — or have Windows run that same command at startup with a Task Scheduler task.

## npm registry install

Octogent is not published to the npm registry yet, so `npm install -g octogent` will fail with `404`.

## First run behavior

Running `octogent` inside a project directory (a git repository) will:

- start the hub on `127.0.0.1:8787` in the background if none is running (see [Running Octogent through the hub](../guides/hub.md))
- create `.octogent/` if it does not exist, with a stable project ID in `.octogent/project.json`
- register the project under `~/.octogent/projects.json`
- keep runtime state in `~/.octogent/projects/<project-id>/state/`
- open the project's page, `http://127.0.0.1:8787/p/<slug>/`, unless `OCTOGENT_NO_OPEN=1`
- show a Deck setup card until the first tentacle is created

`octogent init` additionally adds `.octogent` to `.gitignore` (creating `.gitignore` when it is missing) and writes a starter `.octogent/env`. `octogent --standalone` starts a single-project server instead, on the first open port from `8787`.

## Startup rules

- startup fails if neither `claude` nor another supported provider binary is available
- startup warns when optional integrations like `git`, `gh`, or `curl` are missing

## Next step

- [Quickstart](quickstart.md)
