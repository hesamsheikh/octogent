import { describe, expect, it } from "vitest";
import { renderScreen } from "../src/terminalRuntime/screenRender";

describe("renderScreen", () => {
  it("renders a cursor-addressed permission dialog the way it appears on screen", async () => {
    const painted = [
      "claude --permission-mode default\r\n",
      "\x1b[2J\x1b[H",
      "AAAA",
      "\x1b[2;1HAllow reads outside the working directories?",
      "\x1b[3;1H> 1. Yes",
      "\x1b[4;1H  3. No, ask again next time",
      "\x1b[2B\rEsc to cancel · Tab to amend",
      "\x1b[1;1HRead(../notes.md)",
    ].join("");

    expect((await renderScreen(painted, { lines: 40, cols: 80, rows: 10 })).split("\n")).toEqual([
      "Read(../notes.md)",
      "Allow reads outside the working directories?",
      "> 1. Yes",
      "  3. No, ask again next time",
      "",
      "Esc to cancel · Tab to amend",
    ]);
  });

  it("keeps rows outside a scroll region in place", async () => {
    const painted = "header\x1b[5;1Hstatus bar\x1b[2;4r\x1b[2;1Ha\r\nb\r\nc\r\nd";
    expect(await renderScreen(painted, { lines: 40, cols: 40, rows: 5 })).toBe(
      "header\nb\nc\nd\nstatus bar",
    );
  });

  it("keeps wide CJK characters in order through cursor overwrites", async () => {
    expect(await renderScreen("中文AB\x1b[1;3H字\r\n权限确认\r\nabcde\r中文", { lines: 40 })).toBe(
      "中字AB\n权限确认\n中文e",
    );
  });

  it("shows the alternate screen while it is active and the main screen after it exits", async () => {
    const alternate = "shell prompt\r\n\x1b[?1049h\x1b[2J\x1b[Hfull-screen app";
    expect(await renderScreen(alternate, { lines: 40 })).toBe("full-screen app");
    expect(await renderScreen(`${alternate}\x1b[?1049l`, { lines: 40 })).toBe("shell prompt");
  });

  it("returns the tail of scrolled output without trailing blank rows", async () => {
    const output = `${Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\r\n")}\r\n\r\n`;
    expect(await renderScreen(output, { lines: 3, cols: 40, rows: 10 })).toBe(
      "line 47\nline 48\nline 49",
    );
    expect(await renderScreen("", { lines: 5 })).toBe("");
  });

  it("wraps at the given width and falls back to 120 columns", async () => {
    const long = "x".repeat(130);
    expect(await renderScreen(long, { lines: 5 })).toBe(`${"x".repeat(120)}\n${"x".repeat(10)}`);
    expect(await renderScreen(long, { lines: 5, cols: 200, rows: 10 })).toBe(long);
  });
});
