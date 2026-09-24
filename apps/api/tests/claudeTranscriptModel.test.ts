import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readClaudeTranscriptModel } from "../src/terminalRuntime/claudeTranscript";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const write = (lines: unknown[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "octogent-transcript-model-"));
  tempDirs.push(dir);
  const path = join(dir, "t.jsonl");
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
  return path;
};

describe("readClaudeTranscriptModel", () => {
  it("returns the model of the latest assistant entry", () => {
    const path = write([
      { type: "user", message: { role: "user", content: "hi" } },
      { type: "assistant", message: { role: "assistant", model: "claude-haiku-4-5", content: [] } },
      { type: "assistant", message: { role: "assistant", model: "claude-sonnet-5", content: [] } },
    ]);
    expect(readClaudeTranscriptModel(path)).toBe("claude-sonnet-5");
  });

  it("returns null when no assistant entry names a model or the file is missing", () => {
    expect(
      readClaudeTranscriptModel(write([{ type: "user", message: { content: "hi" } }])),
    ).toBeNull();
    expect(readClaudeTranscriptModel("/nonexistent/transcript.jsonl")).toBeNull();
  });

  it("survives a half-written trailing line", () => {
    const path = write([
      { type: "assistant", message: { role: "assistant", model: "claude-opus-5", content: [] } },
    ]);
    writeFileSync(path, '{"type":"assistant","message":{"model":"claude-fab', { flag: "a" });
    expect(readClaudeTranscriptModel(path)).toBe("claude-opus-5");
  });
});
