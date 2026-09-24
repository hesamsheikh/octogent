import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type HubMetadata,
  clearHubMetadata,
  isProcessAlive,
  readHubMetadata,
  readLiveHubMetadata,
  resolveHubMetadataPath,
  writeHubMetadata,
} from "../src/hubMetadata";

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

const makeGlobalDir = () => {
  const directory = mkdtempSync(join(tmpdir(), "octogent-hub-meta-"));
  temporaryDirectories.push(directory);
  return directory;
};

// A pid that certainly belonged to a process which has since exited.
const deadPid = () => {
  const result = spawnSync(process.execPath, ["-e", ""]);
  return result.pid as number;
};

const startFakeHub = async (healthPid: number): Promise<string> => {
  const server = createServer((request, response) => {
    if (request.url === "/api/hub/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", pid: healthPid }));
      return;
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
};

const sampleMetadata = (overrides: Partial<HubMetadata> = {}): HubMetadata => ({
  apiBaseUrl: "http://127.0.0.1:8787",
  host: "127.0.0.1",
  port: 8787,
  pid: process.pid,
  startedAt: "2026-09-22T00:00:00.000Z",
  version: "0.1.0",
  ...overrides,
});

describe("hub metadata file", () => {
  it("round-trips through hub.json in the global state root", () => {
    const globalDir = makeGlobalDir();
    const metadata = sampleMetadata({ commit: "abc123", builtAt: "2026-09-21T10:00:00.000Z" });

    writeHubMetadata(metadata, globalDir);

    expect(resolveHubMetadataPath(globalDir)).toBe(join(globalDir, "hub.json"));
    expect(JSON.parse(readFileSync(join(globalDir, "hub.json"), "utf8"))).toEqual(metadata);
    expect(readHubMetadata(globalDir)).toEqual(metadata);
  });

  it("drops optional build fields that are not strings", () => {
    const globalDir = makeGlobalDir();
    writeFileSync(
      join(globalDir, "hub.json"),
      JSON.stringify({ ...sampleMetadata(), commit: 42, builtAt: null }),
    );

    expect(readHubMetadata(globalDir)).toEqual(sampleMetadata());
  });

  it("reads a missing file as no hub", () => {
    expect(readHubMetadata(makeGlobalDir())).toBeNull();
  });

  it("reads malformed JSON or a wrong shape as no hub", () => {
    const globalDir = makeGlobalDir();
    writeFileSync(join(globalDir, "hub.json"), "{not json");
    expect(readHubMetadata(globalDir)).toBeNull();

    writeFileSync(join(globalDir, "hub.json"), JSON.stringify({ ...sampleMetadata(), pid: "1" }));
    expect(readHubMetadata(globalDir)).toBeNull();
  });

  it("clears the file only for the hub that wrote it", () => {
    const globalDir = makeGlobalDir();
    writeHubMetadata(sampleMetadata({ pid: 1234 }), globalDir);

    clearHubMetadata(globalDir, { pid: 9999 });
    expect(existsSync(join(globalDir, "hub.json"))).toBe(true);

    clearHubMetadata(globalDir, { pid: 1234 });
    expect(existsSync(join(globalDir, "hub.json"))).toBe(false);

    // Clearing an absent file is a no-op.
    expect(() => clearHubMetadata(globalDir)).not.toThrow();
  });
});

describe("hub liveness", () => {
  it("knows its own pid is alive and an exited one is not", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(deadPid())).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
  });

  it("treats a hub whose pid is alive and whose health answers as live", async () => {
    const globalDir = makeGlobalDir();
    const apiBaseUrl = await startFakeHub(process.pid);
    writeHubMetadata(sampleMetadata({ apiBaseUrl }), globalDir);

    expect(await readLiveHubMetadata(globalDir)).toMatchObject({ apiBaseUrl, pid: process.pid });
  });

  it("treats a dead pid as stale even when something answers on the port", async () => {
    const globalDir = makeGlobalDir();
    const pid = deadPid();
    const apiBaseUrl = await startFakeHub(pid);
    writeHubMetadata(sampleMetadata({ apiBaseUrl, pid }), globalDir);

    expect(await readLiveHubMetadata(globalDir)).toBeNull();
  });

  it("treats a live pid whose health does not answer as stale", async () => {
    const globalDir = makeGlobalDir();
    const apiBaseUrl = await startFakeHub(process.pid);
    await new Promise<void>((resolve) => servers.pop()?.close(() => resolve()));
    writeHubMetadata(sampleMetadata({ apiBaseUrl }), globalDir);

    expect(await readLiveHubMetadata(globalDir)).toBeNull();
  });

  it("treats a hub answering with a different pid as stale", async () => {
    // The file names a process that is not the one serving the port (a
    // reused pid after a crash); stopping "it" would signal a stranger.
    const globalDir = makeGlobalDir();
    const apiBaseUrl = await startFakeHub(process.pid + 1);
    writeHubMetadata(sampleMetadata({ apiBaseUrl }), globalDir);

    expect(await readLiveHubMetadata(globalDir)).toBeNull();
  });

  it("reads missing or malformed metadata as no live hub", async () => {
    const globalDir = makeGlobalDir();
    expect(await readLiveHubMetadata(globalDir)).toBeNull();
    writeFileSync(join(globalDir, "hub.json"), "[]");
    expect(await readLiveHubMetadata(globalDir)).toBeNull();
  });
});
