import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { evaluateRemoteAuth } from "./remoteAuth";
import { isAllowedHostHeader, isAllowedOriginHeader, readHeaderValue } from "./security";

type TerminalRuntime = ReturnType<typeof import("../terminalRuntime").createTerminalRuntime>;

type UpgradeGuardOptions = {
  isRemoteBinding: () => boolean;
  accessToken: string | null;
};

type CreateUpgradeHandlerOptions = UpgradeGuardOptions & {
  runtime: TerminalRuntime;
};

export type UpgradeDispatcher = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** The Host, Origin, and token checks every WebSocket upgrade must pass. */
export const isUpgradeAllowed = (
  request: IncomingMessage,
  { isRemoteBinding, accessToken }: UpgradeGuardOptions,
): boolean => {
  const originHeader = readHeaderValue(request.headers.origin);
  const hostHeader = readHeaderValue(request.headers.host);
  const remoteBinding = isRemoteBinding();
  if (!isAllowedHostHeader(hostHeader, remoteBinding)) {
    return false;
  }

  if (!isAllowedOriginHeader(originHeader, hostHeader, remoteBinding)) {
    return false;
  }

  const authDecision = evaluateRemoteAuth({
    remoteAddress: request.socket.remoteAddress,
    url: request.url ?? "/",
    headers: {
      "x-octogent-token": request.headers["x-octogent-token"],
      cookie: request.headers.cookie,
    },
    accessToken,
  });
  return authDecision.kind !== "deny";
};

/** Hands an already-checked upgrade to one project's runtime. */
export const createRuntimeUpgradeDispatcher =
  (runtime: TerminalRuntime): UpgradeDispatcher =>
  (request, socket, head) => {
    try {
      if (!runtime.handleUpgrade(request, socket, head)) {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  };

export const withUpgradeGuard =
  (guardOptions: UpgradeGuardOptions, dispatch: UpgradeDispatcher): UpgradeDispatcher =>
  (request, socket, head) => {
    if (!isUpgradeAllowed(request, guardOptions)) {
      socket.destroy();
      return;
    }
    dispatch(request, socket, head);
  };

export const createUpgradeHandler = ({ runtime, ...guardOptions }: CreateUpgradeHandlerOptions) =>
  withUpgradeGuard(guardOptions, createRuntimeUpgradeDispatcher(runtime));
