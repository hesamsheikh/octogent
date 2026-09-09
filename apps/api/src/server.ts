import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LOCALE, type Locale, t } from "@octogent/core";
import { createApiServer } from "./createApiServer";
import { resolveAccessToken } from "./createApiServer/remoteAuth";
import { resolveListenHost } from "./listenHost";

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

const validateStartupEnv = (env: NodeJS.ProcessEnv, locale: Locale) => {
  const rawPort = env.OCTOGENT_API_PORT ?? env.PORT;
  if (rawPort !== undefined) {
    const parsed = Number.parseInt(rawPort, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(t(locale, "startup.invalidPort", { port: rawPort }));
    }
  }

  if (env.OCTOGENT_WORKSPACE_CWD && !existsSync(env.OCTOGENT_WORKSPACE_CWD)) {
    throw new Error(t(locale, "startup.workspaceCwdMissing", { dir: env.OCTOGENT_WORKSPACE_CWD }));
  }

  if (env.OCTOGENT_WEB_DIST_DIR && !existsSync(env.OCTOGENT_WEB_DIST_DIR)) {
    console.warn(t(locale, "startup.webDistMissing", { dir: env.OCTOGENT_WEB_DIST_DIR }));
  }
};

export const startApiServerFromEnv = async (env: NodeJS.ProcessEnv = process.env) => {
  const locale: Locale = (env.OCTOGENT_LOCALE as Locale) ?? DEFAULT_LOCALE;
  validateStartupEnv(env, locale);

  const host = resolveListenHost(env);
  const port = parsePort(env.OCTOGENT_API_PORT ?? env.PORT, 8787);
  const apiServer = createApiServer({
    workspaceCwd: env.OCTOGENT_WORKSPACE_CWD ?? process.cwd(),
    projectStateDir: env.OCTOGENT_PROJECT_STATE_DIR,
    promptsDir: env.OCTOGENT_PROMPTS_DIR,
    webDistDir: env.OCTOGENT_WEB_DIST_DIR,
    accessToken: resolveAccessToken(env),
  });

  let activePort: number;
  try {
    ({ port: activePort } = await apiServer.start(port, host));
  } catch (error) {
    await apiServer.stop();
    throw error;
  }

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

  console.log(t(locale, "startup.apiListening", { host, port: String(activePort) }));
  return apiServer;
};

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  startApiServerFromEnv().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
