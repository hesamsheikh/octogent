import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { isProcessAlive } from "./hubMetadata";
import { resolveGlobalOctogentDir } from "./projectPersistence";

/** Longer than a hub start ever takes; an older lock was left by a crash. */
export const HUB_LOCK_STALE_MS = 60_000;

export type HubLock = { release(): void };

type LockContent = { pid: number; token: string };

export const resolveHubLockPath = (globalDir = resolveGlobalOctogentDir()) =>
  join(globalDir, "hub.lock");

const readLockContent = (lockPath: string): LockContent | null => {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<LockContent>;
    return typeof parsed.pid === "number" && typeof parsed.token === "string"
      ? { pid: parsed.pid, token: parsed.token }
      : null;
  } catch {
    return null;
  }
};

const isStale = (lockPath: string, staleMs: number): boolean => {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
      return true;
    }
  } catch {
    // Gone between the failed create and now: free to retry.
    return true;
  }
  // Unreadable content is not proof of death: the holder may be between
  // creating the file and writing its pid, so only age can reclaim it.
  const content = readLockContent(lockPath);
  return content !== null && !isProcessAlive(content.pid);
};

/**
 * Takes `~/.octogent/hub.lock` with an exclusive create, so of several CLIs
 * that find no hub at once exactly one starts it. Returns null while another
 * live holder has it.
 *
 * Two CLIs reclaiming the same stale lock can in rare timing both win; the
 * hub port is the final arbiter then, since a second hub cannot bind it.
 */
export const tryAcquireHubLock = (
  lockPath: string,
  { staleMs = HUB_LOCK_STALE_MS }: { staleMs?: number } = {},
): HubLock | null => {
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd: number;
    try {
      fd = openSync(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (!isStale(lockPath, staleMs)) {
        return null;
      }
      rmSync(lockPath, { force: true });
      continue;
    }

    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, token } satisfies LockContent));
    } finally {
      closeSync(fd);
    }
    return {
      release() {
        // Only our own lock: after a reclaim the file belongs to someone else.
        if (readLockContent(lockPath)?.token === token) {
          rmSync(lockPath, { force: true });
        }
      },
    };
  }

  return null;
};
