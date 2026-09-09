import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";

import type { TerminalLifecycleState } from "@octogent/core";

export type TerminalHealthCounts = {
  ptySessions: number;
  terminals: Record<TerminalLifecycleState, number>;
  terminalEventClients: number;
};

export type HealthSnapshot = TerminalHealthCounts & {
  status: "ok";
  uptimeMs: number;
  version: string;
  eventLoopDelayP95Ms: number;
};

const FALLBACK_VERSION = "0.0.0";
const NANOSECONDS_PER_MILLISECOND = 1e6;

const readPackageVersion = (packageJsonPath: string): string | null => {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as unknown;
    if (parsed !== null && typeof parsed === "object" && "version" in parsed) {
      const version = (parsed as { version: unknown }).version;
      if (typeof version === "string" && version.length > 0) {
        return version;
      }
    }
  } catch {
    // A malformed package.json should not break health reporting.
  }
  return null;
};

// The API can run from src (dev) or a packaged layout, so the root version is
// located by walking up: the workspace root wins inside the monorepo, and the
// nearest versioned package.json covers a packaged install.
const resolveRootVersion = (startDir: string): string => {
  let nearestVersion: string | null = null;
  let current = startDir;

  while (true) {
    const version = readPackageVersion(join(current, "package.json"));
    if (version) {
      if (existsSync(join(current, "pnpm-workspace.yaml"))) {
        return version;
      }
      nearestVersion ??= version;
    }

    const parent = dirname(current);
    if (parent === current) {
      return nearestVersion ?? FALLBACK_VERSION;
    }
    current = parent;
  }
};

export const createHealthSnapshotSource = () => {
  const startedAtMs = Date.now();
  // Sampling begins as soon as the server is constructed so the p95 reflects
  // the whole process lifetime — a stuck event loop is exactly the silent
  // failure this endpoint exists to expose.
  const eventLoopDelayHistogram = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelayHistogram.enable();
  const version = resolveRootVersion(import.meta.dirname ?? process.cwd());

  return {
    readHealthSnapshot(counts: TerminalHealthCounts): HealthSnapshot {
      // Histogram percentiles are nanoseconds; report milliseconds with one
      // decimal so monitors get a stable, comparable unit.
      const p95Ms = eventLoopDelayHistogram.percentile(95) / NANOSECONDS_PER_MILLISECOND;
      return {
        status: "ok",
        uptimeMs: Date.now() - startedAtMs,
        version,
        eventLoopDelayP95Ms: Math.round(p95Ms * 10) / 10,
        ...counts,
      };
    },

    close() {
      eventLoopDelayHistogram.disable();
    },
  };
};
