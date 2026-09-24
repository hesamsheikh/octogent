import { createServer } from "node:http";

import {
  assertSecureRemoteBinding,
  isLoopbackAddress,
  resolveAccessToken,
} from "./createApiServer/remoteAuth";
import { withApiRequestGuard } from "./createApiServer/requestHandler";
import type { CreateApiServerOptions } from "./createApiServer/types";
import { withUpgradeGuard } from "./createApiServer/upgradeHandler";
import { createProjectContext } from "./createProjectContext";

/** A single-project server: one project context mounted at the root, no prefix. */
export const createApiServer = ({
  apiBaseUrl,
  accessToken: configuredAccessToken = resolveAccessToken(process.env),
  ...projectOptions
}: CreateApiServerOptions = {}) => {
  const accessToken = configuredAccessToken?.trim() || null;
  let resolvedApiBaseUrl = apiBaseUrl ?? "http://127.0.0.1:8787";
  let remoteBinding = false;
  const isRemoteBinding = () => remoteBinding;

  const project = createProjectContext({
    ...projectOptions,
    apiBaseUrl: () => resolvedApiBaseUrl,
    isRemoteBinding,
  });

  const guardOptions = { isRemoteBinding, accessToken };
  const server = createServer(withApiRequestGuard(guardOptions, project.handleRequest));
  server.on("upgrade", withUpgradeGuard(guardOptions, project.handleUpgrade));

  return {
    server,
    async start(port = 8787, host = "127.0.0.1") {
      await new Promise<void>((resolveStart, rejectStart) => {
        const onError = (error: Error) => rejectStart(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          const boundAddress = typeof address === "object" && address ? address.address : host;
          remoteBinding = !isLoopbackAddress(boundAddress);

          try {
            assertSecureRemoteBinding(boundAddress, accessToken);
            resolveStart();
          } catch (error) {
            server.close(() => rejectStart(error));
          }
        });
      });

      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      resolvedApiBaseUrl = `http://${host}:${resolvedPort}`;

      return { host, port: resolvedPort };
    },
    async stop() {
      await project.stop();
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolveStop, rejectStop) => {
        server.close((error) => {
          if (error) {
            rejectStop(error);
            return;
          }
          resolveStop();
        });
        server.closeAllConnections();
      });
    },
  };
};
