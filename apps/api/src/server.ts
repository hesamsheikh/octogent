import { existsSync } from "node:fs";
import { createApiServer } from "./createApiServer";

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
};

const allowRemoteAccess = process.env.OCTOGENT_ALLOW_REMOTE_ACCESS === "1";
const host = process.env.HOST ?? (allowRemoteAccess ? "0.0.0.0" : "127.0.0.1");
const port = parsePort(process.env.OCTOGENT_API_PORT ?? process.env.PORT, 8787);
const workspaceCwd = process.env.OCTOGENT_WORKSPACE_CWD ?? process.cwd();
const projectStateDir = process.env.OCTOGENT_PROJECT_STATE_DIR;
const promptsDir = process.env.OCTOGENT_PROMPTS_DIR;
const webDistDir = process.env.OCTOGENT_WEB_DIST_DIR;

// Validate startup environment
const validateStartupEnv = () => {
  const rawPort = process.env.OCTOGENT_API_PORT ?? process.env.PORT;
  if (rawPort !== undefined) {
    const parsed = Number.parseInt(rawPort, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      console.error(`Invalid port "${rawPort}": must be an integer between 1 and 65535.`);
      process.exit(1);
    }
  }

  if (process.env.OCTOGENT_WORKSPACE_CWD && !existsSync(process.env.OCTOGENT_WORKSPACE_CWD)) {
    console.error(
      `OCTOGENT_WORKSPACE_CWD directory does not exist: ${process.env.OCTOGENT_WORKSPACE_CWD}`,
    );
    process.exit(1);
  }

  if (process.env.OCTOGENT_WEB_DIST_DIR && !existsSync(process.env.OCTOGENT_WEB_DIST_DIR)) {
    console.warn(
      `OCTOGENT_WEB_DIST_DIR directory does not exist: ${process.env.OCTOGENT_WEB_DIST_DIR} — web UI will be unavailable.`,
    );
  }
};

validateStartupEnv();

const apiServer = createApiServer({
  workspaceCwd,
  projectStateDir,
  promptsDir,
  webDistDir,
  allowRemoteAccess,
});

const shutdown = async () => {
  await apiServer.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

apiServer
  .start(port, host)
  .then(({ port: activePort }) => {
    console.log(`Octogent API listening on http://${host}:${activePort}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
