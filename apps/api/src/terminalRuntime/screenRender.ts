import xtermHeadless from "@xterm/headless";

import { TERMINAL_DEFAULT_COLS, TERMINAL_DEFAULT_ROWS } from "./constants";

// The package is CommonJS without named exports Node's ESM loader can detect.
const { Terminal } = xtermHeadless;

// Rows beyond the visible screen that the replay keeps; above the 200-line API cap.
const RENDER_SCROLLBACK_ROWS = 1000;

type RenderScreenOptions = {
  lines: number;
  cols?: number;
  rows?: number;
};

/**
 * Replays raw PTY output through a headless terminal emulator and returns the
 * last `lines` rows as plain text. Agent TUIs paint dialogs with cursor
 * addressing and scroll regions, which only an emulator places correctly.
 */
export const renderScreen = async (
  output: string,
  { lines, cols = TERMINAL_DEFAULT_COLS, rows = TERMINAL_DEFAULT_ROWS }: RenderScreenOptions,
): Promise<string> => {
  const terminal = new Terminal({
    cols,
    rows,
    scrollback: RENDER_SCROLLBACK_ROWS,
    allowProposedApi: true,
  });
  try {
    await new Promise<void>((resolve) => terminal.write(output, resolve));
    const buffer = terminal.buffer.active;
    const rendered: string[] = [];
    for (let row = 0; row < buffer.length; row++) {
      rendered.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
    while (rendered.at(-1) === "") rendered.pop();
    return rendered.slice(-lines).join("\n");
  } finally {
    terminal.dispose();
  }
};
