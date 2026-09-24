import { describe, expect, it } from "vitest";
import { channelMessageStatus, formatChannelMessageLine } from "../src/cliChannel";

describe("channel list status", () => {
  it.each([
    [{ delivered: false }, "pending"],
    [{ delivered: true }, "delivered (awaiting receipt)"],
    [{ delivered: true, deliveryAttempts: 2 }, "delivered (awaiting receipt)"],
    [{ delivered: true, acknowledgedAt: "2026-09-21T08:00:02.000Z" }, "confirmed"],
    [
      { delivered: true, deliveryAttempts: 2, failed: "not acknowledged" },
      "failed: not acknowledged",
    ],
  ])("reports %j as %s", (message, status) => {
    expect(channelMessageStatus(message)).toBe(status);
  });

  it("formats one line per message", () => {
    expect(
      formatChannelMessageLine({
        messageId: "msg-1",
        fromTerminalId: "terminal-1",
        content: "continue",
        delivered: true,
        acknowledgedAt: "2026-09-21T08:00:02.000Z",
      }),
    ).toBe("  [msg-1] from=terminal-1 status=confirmed: continue");
    expect(
      formatChannelMessageLine({ messageId: "msg-2", fromTerminalId: "", content: "hi" }),
    ).toBe("  [msg-2] from=(unknown) status=pending: hi");
  });
});
