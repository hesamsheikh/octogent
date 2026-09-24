// Opt in explicitly so an unset or mistyped value cannot cut off worker dialogue.
export const resolveTerminalReleaseAfterTurn = (rawValue: string | undefined): boolean =>
  rawValue?.trim() === "1";
