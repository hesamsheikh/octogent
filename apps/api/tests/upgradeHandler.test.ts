import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { createUpgradeHandler } from "../src/createApiServer/upgradeHandler";

type RuntimeLike = {
  handleUpgrade: (request: IncomingMessage, socket: Socket, head: Buffer) => boolean;
};

describe("createUpgradeHandler", () => {
  it("rejects remote upgrades without a token even when Host claims localhost", () => {
    const runtime: RuntimeLike = {
      handleUpgrade: vi.fn(() => true),
    };
    const handler = createUpgradeHandler({
      runtime: runtime as never,
      isRemoteBinding: () => true,
      accessToken: null,
    });
    const socket = {
      destroy: vi.fn(),
    } as unknown as Socket;

    handler(
      {
        socket: { remoteAddress: "192.168.8.50" },
        headers: { host: "localhost:8787" },
        url: "/api/terminals/terminal-1/ws",
      } as IncomingMessage,
      socket,
      Buffer.alloc(0),
    );

    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(runtime.handleUpgrade).not.toHaveBeenCalled();
  });

  it("destroys socket when runtime upgrade handling throws", () => {
    const runtime: RuntimeLike = {
      handleUpgrade: () => {
        throw new Error("boom");
      },
    };
    const handler = createUpgradeHandler({
      runtime: runtime as never,
      isRemoteBinding: () => true,
      accessToken: null,
    });
    const socket = {
      destroy: vi.fn(),
    } as unknown as Socket;

    expect(() =>
      handler(
        {
          socket: { remoteAddress: "127.0.0.1" },
          headers: {
            host: "127.0.0.1:8787",
            origin: "http://127.0.0.1:5173",
          },
        } as IncomingMessage,
        socket,
        Buffer.alloc(0),
      ),
    ).not.toThrow();
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });
});
