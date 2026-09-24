import type { DeckOctopusAppearance } from "@octogent/core";
import { OCTOPUS_COLORS, hashString, tentacleColor } from "./fleetColors";

export { OCTOPUS_COLORS } from "./fleetColors";

export type OctopusAnimation = "idle" | "sway" | "walk" | "jog" | "swim-up" | "bounce" | "float";
// "sleepy" is reserved for idle/inactive tentacles — never assign it randomly on creation.
export type OctopusExpression = "normal" | "happy" | "sleepy" | "angry" | "surprised";
export type OctopusAccessory = "none" | "long" | "mohawk" | "side-sweep" | "curly";

export const ANIMATIONS: OctopusAnimation[] = ["sway", "walk", "jog", "bounce", "float", "swim-up"];
export const EXPRESSIONS: OctopusExpression[] = ["normal", "happy", "angry", "surprised"];
export const ACCESSORIES: OctopusAccessory[] = [
  "none",
  "none",
  "long",
  "mohawk",
  "side-sweep",
  "curly",
];

export const seededRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 16807 + 0) % 2147483647;
    return (state - 1) / 2147483646;
  };
};

export type OctopusVisuals = {
  color: string;
  animation: OctopusAnimation;
  expression: OctopusExpression;
  accessory: OctopusAccessory;
  hairColor?: string | undefined;
};

export type OctopusVisualSource = {
  tentacleId: string;
  octopus?: DeckOctopusAppearance | undefined;
  color?: string | null | undefined;
};

export const deriveOctopusVisuals = (source: OctopusVisualSource): OctopusVisuals => {
  const random = seededRandom(hashString(source.tentacleId));
  const stored = source.octopus;
  return {
    color: tentacleColor(source.tentacleId, source.color),
    animation:
      (stored?.animation as OctopusAnimation | null) ??
      (ANIMATIONS[Math.floor(random() * ANIMATIONS.length)] as OctopusAnimation),
    expression:
      (stored?.expression as OctopusExpression | null) ??
      (EXPRESSIONS[Math.floor(random() * EXPRESSIONS.length)] as OctopusExpression),
    accessory:
      (stored?.accessory as OctopusAccessory | null) ??
      (ACCESSORIES[Math.floor(random() * ACCESSORIES.length)] as OctopusAccessory),
    hairColor: stored?.hairColor ?? undefined,
  };
};
