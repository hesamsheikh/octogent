import { closeSync, openSync, readFileSync, readSync, statSync, watchFile } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const DEFAULT_TAIL_LINES = 100;

export const resolveServerLogPath = (
  projectStateDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const configuredPath = env.OCTOGENT_SERVER_LOG?.trim();
  if (configuredPath && configuredPath.toLowerCase() !== "off") {
    return isAbsolute(configuredPath) ? configuredPath : resolve(configuredPath);
  }
  return join(projectStateDir, "logs", "server.log");
};

export const parseServerLogsArgs = (args: string[]): { follow: boolean; lines: number } => {
  const linesIndex = args.indexOf("--lines");
  let lines = DEFAULT_TAIL_LINES;
  if (linesIndex !== -1) {
    const rawLines = args[linesIndex + 1];
    lines = Number(rawLines);
    if (!rawLines || !Number.isSafeInteger(lines) || lines < 1) {
      throw new Error("--lines must be a positive integer");
    }
  }
  return { follow: args.includes("--follow"), lines };
};

export const readServerLogTail = (logPath: string, lines: number): string => {
  const content = readFileSync(logPath, "utf8");
  const hasTrailingNewline = content.endsWith("\n");
  const entries = content.split("\n");
  if (hasTrailingNewline) {
    entries.pop();
  }
  const tail = entries.slice(-lines).join("\n");
  return tail ? `${tail}${hasTrailingNewline ? "\n" : ""}` : "";
};

const readRange = (logPath: string, start: number, end: number): Buffer => {
  const length = end - start;
  const buffer = Buffer.alloc(length);
  const descriptor = openSync(logPath, "r");
  try {
    readSync(descriptor, buffer, 0, length, start);
    return buffer;
  } finally {
    closeSync(descriptor);
  }
};

export const followServerLog = (logPath: string, write: (chunk: Buffer) => void): void => {
  let previous = statSync(logPath);
  let offset = previous.size;

  watchFile(logPath, { interval: 250 }, (current) => {
    try {
      const wasRotated = current.ino !== previous.ino || current.size < offset;
      if (wasRotated) {
        offset = 0;
      }
      if (current.size > offset) {
        write(readRange(logPath, offset, current.size));
        offset = current.size;
      }
      previous = current;
    } catch {
      // A rotation briefly moves the current file; the next poll catches up.
    }
  });
};
