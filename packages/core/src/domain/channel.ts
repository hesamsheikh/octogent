export type ChannelMessage = {
  messageId: string;
  fromTerminalId: string;
  toTerminalId: string;
  content: string;
  timestamp: string;
  /** Written into the target's terminal — not proof that the agent received it. */
  delivered: boolean;
  /** When the message was first written into the terminal. */
  deliveredAt?: string;
  /** When the agent's next prompt-submit hook confirmed the delivery. */
  acknowledgedAt?: string;
  /** How many times the message was written into the terminal. */
  deliveryAttempts?: number;
  /** Why delivery was given up, e.g. "not acknowledged". */
  failed?: string;
};
