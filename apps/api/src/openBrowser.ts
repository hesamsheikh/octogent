import { spawn } from "node:child_process";

/** Best effort: opens the URL in the desktop browser unless OCTOGENT_NO_OPEN or CI says not to. */
export const maybeOpenBrowser = (url: string, env: NodeJS.ProcessEnv = process.env) => {
  if (env.OCTOGENT_NO_OPEN === "1" || env.CI === "1") {
    return;
  }

  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd", args: ["/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };

  try {
    const child = spawn(command.file, command.args, {
      stdio: "ignore",
      detached: true,
    });
    // A missing opener (a headless box without xdg-open) is not worth a crash.
    child.on("error", () => {});
    child.unref();
  } catch {
    // Best-effort browser open.
  }
};
