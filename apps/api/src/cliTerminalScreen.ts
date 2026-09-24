import { type Locale, t } from "@octogent/core";
import { parseTerminalInput } from "./terminalRuntime/terminalInput";

export type TerminalScreen = { text: string; savedAt: string | null; raw: boolean };

export const parseScreenArgs = (args: string[]) => {
  const terminalId = args[0];
  if (!terminalId || terminalId.startsWith("-")) return null;
  let lines = 40;
  let raw = false;
  for (let index = 1; index < args.length; index++) {
    if (args[index] === "--raw") raw = true;
    else if (args[index] === "--lines") {
      lines = Number(args[++index]);
      if (!Number.isInteger(lines) || lines < 1 || lines > 200) return null;
    } else return null;
  }
  return { terminalId, lines, raw };
};

export const parseInputArgs = (args: string[]) => {
  const terminalId = args[0];
  if (!terminalId || terminalId.startsWith("-")) return null;
  let text = "";
  let hasText = false;
  let enter = false;
  let keys: string[] = [];
  for (let index = 1; index < args.length; index++) {
    const token = args[index] ?? "";
    if (token === "--enter") enter = true;
    else if (token === "--keys") keys = (args[++index] ?? "").split(",");
    else if (token === "--" && !hasText && index + 2 === args.length) {
      text = args[++index] ?? "";
      hasText = true;
    } else if (!token.startsWith("--") && !hasText) {
      text = token;
      hasText = true;
    } else return null;
  }
  try {
    parseTerminalInput({ text, keys, enter });
  } catch {
    return null;
  }
  return { terminalId, text, keys, enter };
};

export const fetchTerminalScreen = async (
  apiBase: string,
  terminalId: string,
  lines: number,
  raw = false,
): Promise<TerminalScreen | null> => {
  const response = await fetch(
    `${apiBase}/api/terminals/${encodeURIComponent(terminalId)}/screen?lines=${lines}${raw ? "&raw=1" : ""}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as TerminalScreen;
};

export const formatScreen = (screen: TerminalScreen | null, locale: Locale): string => {
  if (!screen) return t(locale, "cli.screen.unavailable");
  return (
    (screen.savedAt ? `[${t(locale, "cli.screen.savedAt", { time: screen.savedAt })}]\n` : "") +
    screen.text
  );
};

export const runTerminalScreen = async (args: string[], apiBase: string, locale: Locale) => {
  const parsed = parseScreenArgs(args);
  if (!parsed) throw new Error(t(locale, "cli.error.screenArgs"));
  const screen = await fetchTerminalScreen(apiBase, parsed.terminalId, parsed.lines, parsed.raw);
  if (!screen) throw new Error(t(locale, "cli.screen.unavailable"));
  const text = formatScreen(screen, locale);
  // Raw mode preserves bytes, including the presence or absence of a final newline.
  process.stdout.write(text + (parsed.raw || text.endsWith("\n") ? "" : "\n"));
};

export const runTerminalInput = async (args: string[], apiBase: string, locale: Locale) => {
  const parsed = parseInputArgs(args);
  if (!parsed) throw new Error(t(locale, "cli.error.inputArgs"));
  const { terminalId, ...body } = parsed;
  const response = await fetch(`${apiBase}/api/terminals/${encodeURIComponent(terminalId)}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(t(locale, "cli.error.inputFailed", { status: response.status }));
  console.log(t(locale, "cli.input.sent", { id: terminalId }));
};
