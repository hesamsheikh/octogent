import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node-pty", () => ({
  spawn: vi.fn(),
}));

import { createApiServer } from "../src/createApiServer";
import { generateAccessToken } from "../src/createApiServer/remoteAuth";

describe("API startup authentication", () => {
  const temporaryDirectories: string[] = [];
  const servers: ReturnType<typeof createApiServer>[] = [];

  afterEach(async () => {
    for (const server of servers) {
      await server.stop();
    }
    servers.length = 0;

    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  const createServer = (accessToken: string | null) => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-startup-security-"));
    temporaryDirectories.push(workspaceCwd);
    const server = createApiServer({ workspaceCwd, accessToken });
    servers.push(server);
    return server;
  };

  it("refuses an explicit wildcard bind without an access token", async () => {
    const server = createServer(null);

    await expect(server.start(0, "0.0.0.0")).rejects.toThrow(/non-loopback.*access token/i);
    expect(server.server.listening).toBe(false);
  });

  it("refuses a non-loopback bind with a short access token", async () => {
    const server = createServer("short-token");

    await expect(server.start(0, "0.0.0.0")).rejects.toThrow(/at least 32 characters/i);
    expect(server.server.listening).toBe(false);
  });

  it("allows a non-loopback bind with a generated access token", async () => {
    const server = createServer(generateAccessToken());

    const address = await server.start(0, "0.0.0.0");

    expect(address.host).toBe("0.0.0.0");
    expect(address.port).toBeGreaterThan(0);
  });
});
