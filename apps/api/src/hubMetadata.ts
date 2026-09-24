import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveGlobalOctogentDir } from "./projectPersistence";

export type HubMetadata = {
  apiBaseUrl: string;
  host: string;
  port: number;
  pid: number;
  startedAt: string;
  version: string;
  commit?: string;
  /** Build time of the bundle the hub loaded, recorded when no commit is known. */
  builtAt?: string;
};

const HUB_METADATA_FILENAME = "hub.json";
const DEFAULT_HEALTH_TIMEOUT_MS = 1500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const resolveHubMetadataPath = (globalDir = resolveGlobalOctogentDir()) =>
  join(globalDir, HUB_METADATA_FILENAME);

export const readHubMetadata = (globalDir?: string): HubMetadata | null => {
  const filePath = resolveHubMetadataPath(globalDir);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.apiBaseUrl !== "string" ||
      typeof parsed.host !== "string" ||
      typeof parsed.port !== "number" ||
      !Number.isFinite(parsed.port) ||
      typeof parsed.pid !== "number" ||
      !Number.isFinite(parsed.pid) ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.version !== "string"
    ) {
      return null;
    }

    return {
      apiBaseUrl: parsed.apiBaseUrl,
      host: parsed.host,
      port: parsed.port,
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      version: parsed.version,
      ...(typeof parsed.commit === "string" ? { commit: parsed.commit } : {}),
      ...(typeof parsed.builtAt === "string" ? { builtAt: parsed.builtAt } : {}),
    };
  } catch {
    return null;
  }
};

export const writeHubMetadata = (metadata: HubMetadata, globalDir = resolveGlobalOctogentDir()) => {
  mkdirSync(globalDir, { recursive: true });
  const filePath = resolveHubMetadataPath(globalDir);
  // Every CLI call reads this file; one that caught it half-written would
  // decide no hub runs and try to start a second one.
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
};

/**
 * With `pid`, removes the file only while it still names that process: a hub
 * shutting down slowly must not delete the file its successor just wrote.
 */
export const clearHubMetadata = (globalDir?: string, options: { pid?: number } = {}) => {
  const filePath = resolveHubMetadataPath(globalDir);
  if (!existsSync(filePath)) {
    return;
  }
  if (options.pid !== undefined && readHubMetadata(globalDir)?.pid !== options.pid) {
    return;
  }
  rmSync(filePath, { force: true });
};

export const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export type HubHealth = { pid: number | null; version: string | null };

type ProbeOptions = { timeoutMs?: number };

/** GETs `/api/hub/health`; null when nothing hub-shaped answers in time. */
export const probeHubHealth = async (
  apiBaseUrl: string,
  { timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS }: ProbeOptions = {},
): Promise<HubHealth | null> => {
  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/api/hub/health`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) {
      return null;
    }
    return {
      pid: typeof payload.pid === "number" ? payload.pid : null,
      version: typeof payload.version === "string" ? payload.version : null,
    };
  } catch {
    return null;
  }
};

export const isHubMetadataLive = async (
  metadata: HubMetadata,
  options: ProbeOptions = {},
): Promise<boolean> => {
  if (!isProcessAlive(metadata.pid)) {
    return false;
  }
  const health = await probeHubHealth(metadata.apiBaseUrl, options);
  // A different pid answering means the file outlived its hub and the pid was
  // reused; trusting it would let `hub stop` signal an unrelated process.
  return health !== null && (health.pid === null || health.pid === metadata.pid);
};

/** hub.json, but only while its hub is alive and answering. */
export const readLiveHubMetadata = async (
  globalDir?: string,
  options: ProbeOptions = {},
): Promise<HubMetadata | null> => {
  const metadata = readHubMetadata(globalDir);
  if (!metadata) {
    return null;
  }
  return (await isHubMetadataLive(metadata, options)) ? metadata : null;
};
