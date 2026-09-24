import { describe, expect, it } from "vitest";
import { screenTail } from "../src/terminalRuntime/screenText";

describe("screenTail", () => {
  it("removes CSI styling and OSC titles terminated by BEL or ST", () => {
    expect(
      screenTail(
        "\x1b]0;Claude\x07\x1b[?25l\x1b[31mRead outside?\x1b[0m\r\n\x1b]2;title\x1b\\1. Yes",
      ),
    ).toBe("Read outside?\n1. Yes");
  });
  it("applies carriage return overwrites and erase-line redraws", () => {
    expect(screenTail("Working 100%\rDone\x1b[K\r\nabcdef\rXY")).toBe("Done\nXYcdef");
  });
  it("collapses consecutive repaints before selecting the tail", () => {
    expect(screenTail("old\nworking\nworking\nworking\nlimit reached\n", 2)).toBe(
      "working\nlimit reached",
    );
  });
  it("preserves wide CJK and astral text through overwrites", () => {
    expect(screenTail("正在读取…\r权限确认\x1b[K\r\n1. 是 😀\n1. 是 😀")).toBe(
      "权限确认\n1. 是 😀",
    );
  });
  it("overwrites display cells without leaving half a wide character", () => {
    expect(screenTail("中文AB\rxy")).toBe("xy文AB");
    expect(screenTail("中文AB\rx")).toBe("x 文AB");
    expect(screenTail("abcde\r中文")).toBe("中文e");
    expect(screenTail("e\u0301clair\rE")).toBe("Eclair");
  });
  it("returns the untouched raw tail", () => {
    expect(screenTail("old\r\n\x1b[31mred\rblue\r\n", 1, true)).toBe("\x1b[31mred\rblue\r\n");
    expect(screenTail("")).toBe("");
  });
});
