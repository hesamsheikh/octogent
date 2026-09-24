// "delivered" alone only means the text reached the terminal; whether the agent
// took it shows up as its prompt-submit acknowledgement.
export const channelMessageStatus = (message: Record<string, unknown>): string => {
  if (typeof message.failed === "string" && message.failed.length > 0) {
    return `failed: ${message.failed}`;
  }
  if (typeof message.acknowledgedAt === "string") {
    return "confirmed";
  }
  // No status may contain another: scripts grep for "confirmed", and
  // "unconfirmed" matched it (it fooled a wait loop the day this shipped).
  return message.delivered === true ? "delivered (awaiting receipt)" : "pending";
};

export const formatChannelMessageLine = (message: Record<string, unknown>): string =>
  `  [${message.messageId}] from=${message.fromTerminalId || "(unknown)"} status=${channelMessageStatus(message)}: ${message.content}`;
