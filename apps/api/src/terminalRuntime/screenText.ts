import { stripVTControlCharacters } from "node:util";

const ESC = String.fromCharCode(27);
const ERASE_LINE_PARTS = new RegExp(`(${ESC}\\[[012]?K)`);
const ERASE_LINE = new RegExp(`^${ESC}\\[[012]?K$`);
const WIDE_CHARACTER =
  /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3ffff}]/u;

// Raw mode serves `--raw` and reads of saved screens. Stripped mode is the teardown
// fallback that stays on disk when the emulator render (screenRender.ts) cannot finish.
export const screenTail = (text: string, lines = 40, raw = false): string => {
  if (raw) {
    const rows = text.split("\n");
    const trailingNewline = rows.at(-1) === "";
    if (trailingNewline) rows.pop();
    return rows.slice(-lines).join("\n") + (trailingNewline && text ? "\n" : "");
  }

  const output: string[] = [];
  let row: (string | null)[] = [];
  let cursor = 0;
  const flush = () => {
    const line = row.join("").trimEnd();
    if (output.at(-1) !== line) output.push(line);
    row = [];
    cursor = 0;
  };
  const clearCell = (column: number) => {
    if (row[column] === null && column > 0) row[column - 1] = " ";
    if (row[column + 1] === null) row[column + 1] = " ";
    row[column] = " ";
  };
  // Erase-line must survive stripping: a shorter CR repaint otherwise leaves stale text.
  for (const part of text.split(ERASE_LINE_PARTS)) {
    if (ERASE_LINE.test(part)) {
      if (part === "\x1b[2K") row = Array(cursor).fill(" ");
      else if (part === "\x1b[1K") row.fill(" ", 0, cursor + 1);
      else row.length = cursor;
      continue;
    }
    for (const character of stripVTControlCharacters(part)) {
      if (character === "\r") cursor = 0;
      else if (character === "\n") flush();
      else if (character === "\b") cursor = Math.max(0, cursor - 1);
      else if (/\p{Mark}/u.test(character)) {
        const previous = row[cursor - 1] === null ? cursor - 2 : cursor - 1;
        if (previous >= 0) row[previous] = (row[previous] ?? "") + character;
      } else if (
        character === "\t" ||
        (character >= " " && (character < "\x7f" || character > "\x9f"))
      ) {
        // CR addresses terminal columns; CJK glyphs occupy two, combining marks occupy none.
        const width = WIDE_CHARACTER.test(character) ? 2 : 1;
        clearCell(cursor);
        if (width === 2) clearCell(cursor + 1);
        row[cursor] = character;
        if (width === 2) row[cursor + 1] = null;
        cursor += width;
      }
    }
  }
  if (row.length) flush();
  return output.slice(-lines).join("\n");
};
