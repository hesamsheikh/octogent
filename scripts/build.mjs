#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const formatCommand = (command, args) => [command, ...args].join(" ");

const canRun = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });

  return result.status === 0;
};

const resolvePnpmCommand = () => {
  if (canRun("pnpm", ["--version"])) {
    return { command: "pnpm", baseArgs: [] };
  }

  if (canRun("corepack", ["pnpm", "--version"])) {
    return { command: "corepack", baseArgs: ["pnpm"] };
  }

  throw new Error(
    "Unable to find pnpm. Install pnpm or enable Corepack for the packageManager field.",
  );
};

const runChecked = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${formatCommand(command, args)}`);
  }
};

const runPnpm = (pnpmCommand, args) => {
  runChecked(pnpmCommand.command, [...pnpmCommand.baseArgs, ...args]);
};

const main = () => {
  const pnpmCommand = resolvePnpmCommand();

  runPnpm(pnpmCommand, ["--filter", "@octogent/web", "build"]);
  runPnpm(pnpmCommand, [
    "--filter",
    "@octogent/web",
    "exec",
    "vite",
    "build",
    "--config",
    "vite.api.bundle.config.mts",
  ]);
  runChecked(process.execPath, [join(repoRoot, "scripts", "build-package.mjs")]);
};

try {
  main();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
}
