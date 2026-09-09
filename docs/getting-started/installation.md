# Installation

Octogent is a local Node.js project with a local API and web UI.

## Requirements

- Node.js `22+` (an [nvm](https://github.com/nvm-sh/nvm) install is fine; run `nvm use` in the shell you install from)
- `pnpm` `10+` — the repository is a pnpm workspace. Install it once with `npm install -g pnpm` (or `corepack enable`). Do **not** run `npm install` inside the clone: it cannot resolve the workspace packages and leaves a stray `package-lock.json` behind
- A C++ toolchain for `node-pty`'s native module on Linux: `python3`, `make`, `g++` (`sudo apt install build-essential python3` on Debian/Ubuntu). macOS and Windows ship prebuilt binaries
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

## npm registry install

Octogent is not published to the npm registry yet, so `npm install -g octogent` will fail with `404`.

## First run behavior

Running `octogent` inside a project directory will:

- create `.octogent/` if it does not exist
- add `.octogent` to `.gitignore` or create `.gitignore` when it is missing
- write a stable project ID to `.octogent/project.json`
- register the project under `~/.octogent/projects.json`
- move runtime state to `~/.octogent/projects/<project-id>/state/`
- choose an open local API port starting at `8787`
- open the browser unless `OCTOGENT_NO_OPEN=1`
- show a Deck setup card until the first tentacle is created

## Startup rules

- startup fails if neither `claude` nor another supported provider binary is available
- startup warns when optional integrations like `git`, `gh`, or `curl` are missing

## Next step

- [Quickstart](quickstart.md)
