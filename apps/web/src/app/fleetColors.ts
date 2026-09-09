// Shared bright palette for fleet views. The canvas and the flow view both
// color agents/tentacles from this so an octoboss-direct agent (no deck
// tentacle) is as legible as a deck one, and the two pages agree on color.
export const OCTOPUS_COLORS = [
  "#ff6b2b",
  "#ff2d6b",
  "#00ffaa",
  "#bf5fff",
  "#00c8ff",
  "#ffee00",
  "#39ff14",
  "#ff4df0",
  "#00fff7",
  "#ff9500",
] as const;

export const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

/** A deck color when present, otherwise a bright hash-derived palette color. */
export const tentacleColor = (tentacleId: string, deckColor?: string | null): string =>
  deckColor && deckColor.length > 0
    ? deckColor
    : (OCTOPUS_COLORS[hashString(tentacleId) % OCTOPUS_COLORS.length] as string);
