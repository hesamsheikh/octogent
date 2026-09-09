import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node-pty", () => ({
  spawn: vi.fn(),
}));

import { startApiServerFromEnv } from "../src/server";

const reservePort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
};

describe("server.ts startup", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  const createEnv = async (): Promise<NodeJS.ProcessEnv> => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-server-entry-"));
    temporaryDirectories.push(workspaceCwd);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OCTOGENT_API_PORT: String(await reservePort()),
      OCTOGENT_WORKSPACE_CWD: workspaceCwd,
      HOST: undefined,
      OCTOGENT_ACCESS_TOKEN: undefined,
      OCTOGENT_ALLOW_REMOTE_ACCESS: undefined,
    };
    return env;
  };

  it("refuses the dev server entry point when remote access has no token", async () => {
    const env = await createEnv();
    env.OCTOGENT_ALLOW_REMOTE_ACCESS = "1";

    await expect(startApiServerFromEnv(env)).rejects.toThrow(/non-loopback.*access token/i);
  });

  it("refuses an explicit HOST=0.0.0.0 without a token", async () => {
    const env = await createEnv();
    env.HOST = "0.0.0.0";

    await expect(startApiServerFromEnv(env)).rejects.toThrow(/non-loopback.*access token/i);
  });
});
