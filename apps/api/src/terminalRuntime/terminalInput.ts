import { RuntimeInputError } from "./types";

const KEY_BYTES: Readonly<Record<string, string>> = {
  enter: "\r",
  esc: "\x1b",
  up: "\x1b[A",
  down: "\x1b[B",
  tab: "\t",
  "ctrl-c": "\x03",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
};
export const MAX_TERMINAL_INPUT_BYTES = 4096;

export const parseTerminalInput = (payload: unknown): { data: string; enter: boolean } => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RuntimeInputError("Expected an input object.");
  }
  const { text = "", keys = [], enter = false } = payload as Record<string, unknown>;
  if (typeof text !== "string" || typeof enter !== "boolean" || !Array.isArray(keys)) {
    throw new RuntimeInputError("Expected text, a boolean enter, and an array of keys.");
  }
  if (
    Buffer.byteLength(text, "utf8") > MAX_TERMINAL_INPUT_BYTES ||
    keys.length > MAX_TERMINAL_INPUT_BYTES
  ) {
    throw new RuntimeInputError("Terminal input exceeds 4096 bytes.");
  }
  let data = text;
  for (const key of keys) {
    if (typeof key !== "string" || !Object.hasOwn(KEY_BYTES, key)) {
      throw new RuntimeInputError("Unknown terminal key.");
    }
    data += KEY_BYTES[key];
  }
  if (Buffer.byteLength(data, "utf8") + Number(enter) > MAX_TERMINAL_INPUT_BYTES) {
    throw new RuntimeInputError("Terminal input exceeds 4096 bytes.");
  }
  if (!data && !enter) throw new RuntimeInputError("Terminal input is empty.");
  return { data, enter };
};
