#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const tempRoot = mkdtempSync(join(tmpdir(), "octogent-public-install-"));
const packDir = join(tempRoot, "pack");
const installDir = join(tempRoot, "install");
const workspaceDir = join(tempRoot, "workspace");
const homeDir = join(tempRoot, "home");
const binDir = join(tempRoot, "bin");
const npmCacheDir = join(tempRoot, "npm-cache");

mkdirSync(packDir, { recursive: true });
mkdirSync(installDir, { recursive: true });
mkdirSync(workspaceDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(npmCacheDir, { recursive: true });

const canonicalWorkspaceDir = realpathSync(workspaceDir);

const runtimeEnv = {
  ...process.env,
  HOME: homeDir,
  npm_config_cache: npmCacheDir,
};
const npmEnv = {
  ...process.env,
  npm_config_logs_dir: join(npmCacheDir, "_logs"),
};

npmEnv.npm_config_verify_deps_before_run = undefined;

const formatCommand = (command, args) => [command, ...args].join(" ");

const runChecked = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${formatCommand(command, args)}`,
        result.stdout ? `stdout:\n${result.stdout.trimEnd()}` : "",
        result.stderr ? `stderr:\n${result.stderr.trimEnd()}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return result.stdout.trim();
};

const writeProviderStub = () => {
  if (process.platform === "win32") {
    writeFileSync(join(binDir, "codex.cmd"), "@echo off\r\nexit /b 0\r\n", "utf8");
    return;
  }

  const stubPath = join(binDir, "codex");
  writeFileSync(stubPath, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(stubPath, 0o755);
};

const assertFile = (filePath, description) => {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${description}: ${filePath}`);
  }
};

const main = async () => {
  let serverProcess;
  let keepArtifacts = false;

  try {
    writeProviderStub();

    console.log("Building package artifacts...");
    runChecked(process.execPath, [join(repoRoot, "scripts", "build.mjs")], {
      cwd: repoRoot,
      env: process.env,
    });

    console.log("Packing npm tarball...");
    const packed = JSON.parse(
      runChecked("npm", ["pack", "--json", "--pack-destination", packDir], {
        cwd: repoRoot,
        env: npmEnv,
      }),
    );
    const tarballFilename = packed[0]?.filename;
    if (typeof tarballFilename !== "string" || tarballFilename.length === 0) {
      throw new Error("`npm pack --json` did not return a tarball filename.");
    }
    const tarballPath = join(packDir, tarballFilename);

    console.log("Installing packed CLI into a clean temp project...");
    runChecked("npm", ["init", "-y"], {
      cwd: installDir,
      env: npmEnv,
    });
    runChecked("npm", ["install", tarballPath], {
      cwd: installDir,
      env: npmEnv,
    });

    const octogentBin =
      process.platform === "win32"
        ? join(installDir, "node_modules", ".bin", "octogent.cmd")
        : join(installDir, "node_modules", ".bin", "octogent");

    console.log("Initializing a fresh workspace with the packaged CLI...");
    runChecked(octogentBin, ["init", "octogent-smoke"], {
      cwd: workspaceDir,
      env: runtimeEnv,
    });

    console.log("Launching packaged Octogent in the initialized workspace...");

    let stdout = "";
    let stderr = "";

    serverProcess = spawn(octogentBin, [], {
      cwd: workspaceDir,
      env: {
        ...runtimeEnv,
        OCTOGENT_NO_OPEN: "1",
        PATH: `${binDir}${delimiter}${runtimeEnv.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    serverProcess.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const runtimeMetadataPath = join(homeDir, ".octogent", "projects");

    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (serverProcess.exitCode !== null) {
        break;
      }

      const projectConfigPath = join(workspaceDir, ".octogent", "project.json");
      if (existsSync(projectConfigPath)) {
        const projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf8"));
        const candidateRuntimePath = join(
          runtimeMetadataPath,
          projectConfig.projectId,
          "state",
          "runtime.json",
        );

        if (existsSync(candidateRuntimePath)) {
          const runtimeMetadata = JSON.parse(readFileSync(candidateRuntimePath, "utf8"));
          try {
            const response = await fetch(runtimeMetadata.apiBaseUrl);
            if (response.ok) {
              const html = await response.text();
              if (!html.includes("<title>Octogent</title>")) {
                throw new Error("Packaged UI responded, but the returned HTML was not Octogent.");
              }
              break;
            }
          } catch {
            // Server may still be binding even after runtime metadata is written.
          }
        }
      }

      await delay(250);
    }

    if (serverProcess.exitCode !== null) {
      throw new Error(
        [
          `Packaged CLI exited before startup completed (exit ${serverProcess.exitCode}).`,
          stdout ? `stdout:\n${stdout.trimEnd()}` : "",
          stderr ? `stderr:\n${stderr.trimEnd()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    const projectConfigPath = join(workspaceDir, ".octogent", "project.json");
    const gitignorePath = join(workspaceDir, ".gitignore");
    const projectsRegistryPath = join(homeDir, ".octogent", "projects.json");

    assertFile(projectConfigPath, "local project config");
    assertFile(gitignorePath, "workspace .gitignore");
    assertFile(projectsRegistryPath, "global projects registry");

    const projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf8"));
    const projectsRegistry = JSON.parse(readFileSync(projectsRegistryPath, "utf8"));
    const registeredProject = projectsRegistry.projects.find(
      (project) => project.id === projectConfig.projectId && project.path === canonicalWorkspaceDir,
    );

    if (!registeredProject) {
      throw new Error("Global projects registry did not include the fresh workspace.");
    }

    const runtimePath = join(
      homeDir,
      ".octogent",
      "projects",
      projectConfig.projectId,
      "state",
      "runtime.json",
    );
    assertFile(runtimePath, "runtime metadata");

    const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
    if (runtime.workspaceCwd !== canonicalWorkspaceDir) {
      throw new Error(
        `Runtime metadata pointed at ${runtime.workspaceCwd}, expected ${canonicalWorkspaceDir}.`,
      );
    }

    const gitignoreContent = readFileSync(gitignorePath, "utf8");
    if (!gitignoreContent.split(/\r?\n/).includes(".octogent")) {
      throw new Error("Workspace .gitignore did not include the .octogent entry.");
    }

    console.log("Public install smoke test passed.");
    console.log(`  Tarball:   ${tarballPath}`);
    console.log(`  Workspace: ${workspaceDir}`);
    console.log(`  API:       ${runtime.apiBaseUrl}`);
  } catch (error) {
    keepArtifacts = true;
    console.error("Public install smoke test failed.");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    console.error(`Artifacts preserved at: ${tempRoot}`);
    process.exitCode = 1;
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill("SIGTERM");
      await delay(500);
      if (serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
      }
    }

    if (!keepArtifacts) {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  }
};

void main();
