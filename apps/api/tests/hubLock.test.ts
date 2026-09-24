import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { HUB_LOCK_STALE_MS, resolveHubLockPath, tryAcquireHubLock } from "../src/hubLock";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const makeLockPath = () => {
  const directory = mkdtempSync(join(tmpdir(), "octogent-hub-lock-"));
  temporaryDirectories.push(directory);
  return resolveHubLockPath(directory);
};

const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid as number;

const API_ROOT = resolve(import.meta.dirname, "..");

// Each child races for the lock once and reports whether it won; holding it
// briefly keeps a slow starter from winning after an early winner released.
const raceInChild = (lockPath: string): Promise<boolean> =>
  new Promise((resolveRace, rejectRace) => {
    const script = `
      import { tryAcquireHubLock } from "./src/hubLock.ts";
      const lock = tryAcquireHubLock(${JSON.stringify(lockPath)});
      process.stdout.write(lock ? "won" : "lost");
      setTimeout(() => lock?.release(), 1500);
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { cwd: API_ROOT, stdio: ["ignore", "pipe", "ignore"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", rejectRace);
    child.on("exit", () => resolveRace(output === "won"));
  });

describe("hub lock", () => {
  it("lives next to hub.json", () => {
    expect(resolveHubLockPath("/state")).toBe(join("/state", "hub.lock"));
  });

  it("admits one holder at a time and frees the lock on release", () => {
    const lockPath = makeLockPath();
    const first = tryAcquireHubLock(lockPath);
    expect(first).not.toBeNull();
    expect(tryAcquireHubLock(lockPath)).toBeNull();

    first?.release();
    expect(existsSync(lockPath)).toBe(false);
    expect(tryAcquireHubLock(lockPath)).not.toBeNull();
  });

  it("has exactly one winner when several processes race for it", async () => {
    const lockPath = makeLockPath();
    const results = await Promise.all(Array.from({ length: 5 }, () => raceInChild(lockPath)));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("reclaims a lock older than the stale window", () => {
    const lockPath = makeLockPath();
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: "someone-else" }));
    const past = (Date.now() - HUB_LOCK_STALE_MS - 5_000) / 1000;
    utimesSync(lockPath, past, past);

    const lock = tryAcquireHubLock(lockPath);

    expect(lock).not.toBeNull();
    expect(readFileSync(lockPath, "utf8")).not.toContain("someone-else");
  });

  it("reclaims a fresh lock whose holder has exited", () => {
    // A CLI killed mid-start would otherwise make every other CLI wait out
    // the whole stale window.
    const lockPath = makeLockPath();
    writeFileSync(lockPath, JSON.stringify({ pid: deadPid(), token: "crashed" }));

    expect(tryAcquireHubLock(lockPath)).not.toBeNull();
  });

  it("keeps a fresh lock whose content is unreadable", () => {
    // Its holder may be between creating and writing it.
    const lockPath = makeLockPath();
    writeFileSync(lockPath, "");

    expect(tryAcquireHubLock(lockPath)).toBeNull();
  });

  it("does not delete a lock that was reclaimed from it", () => {
    const lockPath = makeLockPath();
    const stale = tryAcquireHubLock(lockPath);
    const past = (Date.now() - HUB_LOCK_STALE_MS - 5_000) / 1000;
    utimesSync(lockPath, past, past);
    const successor = tryAcquireHubLock(lockPath);
    expect(successor).not.toBeNull();

    stale?.release();

    expect(existsSync(lockPath)).toBe(true);
    expect(tryAcquireHubLock(lockPath)).toBeNull();
  });
});
