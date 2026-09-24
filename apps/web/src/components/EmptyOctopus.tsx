import { useEffect, useRef } from "react";
import type { OctopusAccessory, OctopusAnimation, OctopusExpression } from "../app/octopusVisuals";

export type { OctopusAccessory, OctopusAnimation, OctopusExpression } from "../app/octopusVisuals";

/*
 * Pixel-art octopus rendered via Canvas 2D.
 * Shape based on classic pixel ghost/invader: outlined dome, square eyes,
 * jagged 3-tooth tentacle bottom.
 *
 * Sprite is 16 × 14 pixels. Canvas height is padded by BOUNCE_PAD rows
 * so bounce/float animations have vertical room without clipping.
 */

const DEFAULT_SCALE = 14; // CSS pixels per sprite pixel
const BOUNCE_PAD = 2; // extra canvas rows reserved for vertical animations
// Extra rows above the sprite for overlays (ZZZ, accessories).
const ZZZ_PAD = 7; // sleepy ZZZ needs 7 rows
const ACCESSORY_PAD = 4; // tallest hair (mohawk/curly) reaches row -3
const ZZZ_COLOR = "#7ec8e3"; // soft sky-blue for the floating z glyphs
const HAIR_COLOR = "#4a2c0a"; // dark brown

const B = "B"; // body (accent fill)
const O = "O"; // outline (dark)
const E = "E"; // eye (dark)
const _ = ""; // transparent

// ─── HEAD construction ───────────────────────────────────────────────────────
// Rows 0-2 and 6-9 are identical across all expressions.
// Rows 3-5 carry the expression detail; buildHead() assembles the full array.

// prettier-ignore
const HEAD_TOP: string[][] = [
  [_, _, _, _, O, O, O, O, O, O, O, O, _, _, _, _], // 0
  [_, _, _, O, B, B, B, B, B, B, B, B, O, _, _, _], // 1
  [_, _, O, B, B, B, B, B, B, B, B, B, B, O, _, _], // 2
];

// Angry variant — outer brow pixel at col 4 (left) and col 11 (right) in row 2.
// Combined with FACE_ANGRY row 3 inner pixels (col 5 / col 10), this forms a
// diagonal V-slash brow: outer-high → inner-low on each side.
// prettier-ignore
const HEAD_TOP_ANGRY: string[][] = [
  [_, _, _, _, O, O, O, O, O, O, O, O, _, _, _, _], // 0
  [_, _, _, O, B, B, B, B, B, B, B, B, O, _, _, _], // 1
  [_, _, O, B, O, B, B, B, B, B, B, O, B, O, _, _], // 2  cols 4 and 11 → outer brow start
];

// prettier-ignore
const HEAD_BODY: string[][] = [
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 6
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 7
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 8
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 9
];

// Happy — open mouth: solid black rectangle in rows 7-8, cols 5-10.
// prettier-ignore
const HEAD_BODY_HAPPY: string[][] = [
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 6
  [_, O, B, B, B, O, O, O, O, O, O, O, B, B, O, _], // 7  top of open mouth (cols 5-10)
  [_, O, B, B, B, O, O, O, O, O, O, O, B, B, O, _], // 8  bottom of open mouth (cols 5-10)
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 9
];

// Angry — open mouth, narrower than happy to read as a shout/snarl.
// prettier-ignore
const HEAD_BODY_ANGRY: string[][] = [
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 6
  [_, O, B, B, B, B, O, O, O, O, O, B, B, B, O, _], // 7  top of open mouth (cols 6-10)
  [_, O, B, B, B, B, O, O, O, O, O, B, B, B, O, _], // 8  bottom of open mouth (cols 6-10)
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 9
];

// Normal — 2×2 square eyes (rows 4-5).
// prettier-ignore
const FACE_NORMAL: string[][] = [
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 3
  [_, O, B, B, E, E, B, B, B, B, E, E, B, B, O, _], // 4  eyes
  [_, O, B, B, E, E, B, B, B, B, E, E, B, B, O, _], // 5  eyes
];

// Happy — upward-curved eyes (^_^ style): bottom row lit, top row clear.
// The open space above the pupil makes the eye read as curving upward = smile.
// prettier-ignore
const FACE_HAPPY: string[][] = [
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 3
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 4  clear = top of eye open
  [_, O, B, B, E, E, B, B, B, B, E, E, B, B, O, _], // 5  bottom row lit = eyes curve up
];

// Sleepy — heavy eyelid (solid outline stripe) with tiny pupils peeking below.
// prettier-ignore
const FACE_SLEEPY: string[][] = [
  [_, O, B, B, B, B, B, B, B, B, B, B, B, B, O, _], // 3
  [_, O, B, B, O, O, B, B, B, B, O, O, B, B, O, _], // 4  closed eyelid (outline color)
  [_, O, B, B, E, B, B, B, B, B, B, E, B, B, O, _], // 5  tiny pupils peeking
];

// Angry — brow diagonal continues: outer pixel lands at col 4/11 here too,
// making a 2-pixel-wide brow that reads clearly as a hard scowl.
// prettier-ignore
const FACE_ANGRY: string[][] = [
  [_, O, B, O, O, B, B, B, B, B, B, O, O, B, O, _], // 3  both cols 3-4 left brow and 11-12 right brow
  [_, O, B, B, E, E, B, B, B, B, E, E, B, B, O, _], // 4  eyes
  [_, O, B, B, E, E, B, B, B, B, E, E, B, B, O, _], // 5  eyes
];

// Surprised — eyes extend up into row 3, making them taller (3-row tall eyes).
// prettier-ignore
const FACE_SURPRISED: string[][] = [
  [_, O, B, B, E, E, B, B, B, B, E, E, B, B, O, _], // 3  eyes start early
  [_, O, B, B, E, E, B, B, B, B, E, E, B, B, O, _], // 4  eyes
  [_, O, B, B, E, E, B, B, B, B, E, E, B, B, O, _], // 5  eyes
];

function buildHead(
  face: string[][],
  topRows: string[][] = HEAD_TOP,
  bodyRows: string[][] = HEAD_BODY,
): string[][] {
  return [...topRows, ...face, ...bodyRows];
}

// ─── Tentacle / tail variants ────────────────────────────────────────────────

// Static tentacle split — always drawn.
// prettier-ignore
const TENTACLE_TOP: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  three equal splits
];

// 3-tooth rectangular bottom — neutral (square ghost-style bumps).
// prettier-ignore
const TAIL_NEUTRAL: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 11
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 12
  [_, _, O, O, _, _, _, O, O, _, _, _, O, O, _, _], // 13  bottom caps
];

// Legs bend right — top row stays anchored, lower rows shift 1px right.
// prettier-ignore
const TAIL_RIGHT: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 11  straight (pivot)
  [_, _, O, B, B, O, _, O, B, B, O, _, O, B, B, O], // 12  bent 1px right
  [_, _, _, O, O, _, _, _, O, O, _, _, _, O, O, _], // 13  caps follow bend
];

// Legs bend left — top row stays anchored, lower rows shift 1px left.
// prettier-ignore
const TAIL_LEFT: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 11  straight (pivot)
  [O, B, B, O, _, O, B, B, O, _, O, B, B, O, _, _], // 12  bent 1px left
  [_, O, O, _, _, _, O, O, _, _, _, O, O, _, _, _], // 13  caps follow bend
];

// Sway: center → right → center → left → repeat
const SWAY_FRAMES_TAILS = [TAIL_NEUTRAL, TAIL_RIGHT, TAIL_NEUTRAL, TAIL_LEFT];

// Walk-up: all three legs extend and retract in unison.
// short (1 row + cap) → medium (2 rows + cap) → extended (3 rows + cap) → medium → repeat
// prettier-ignore
const WALKUP_0: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  all start
  [_, _, O, O, _, _, _, O, O, _, _, _, O, O, _, _], // 11  all cap
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 12  empty
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 13  empty
];
// prettier-ignore
const WALKUP_1: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  all start
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 11  all continue
  [_, _, O, O, _, _, _, O, O, _, _, _, O, O, _, _], // 12  all cap
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 13  empty
];
// prettier-ignore
const WALKUP_2: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  all start
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 11  all continue
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 12  all continue
  [_, _, O, O, _, _, _, O, O, _, _, _, O, O, _, _], // 13  all cap
];
// prettier-ignore
const WALKUP_3: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  all start
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 11  all continue
  [_, _, O, O, _, _, _, O, O, _, _, _, O, O, _, _], // 12  all cap
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 13  empty
];
const WALKUP_FRAMES = [WALKUP_0, WALKUP_1, WALKUP_2, WALKUP_3];

// ─── Bounce / float types (needed by walk frames below) ─────────────────────

type SpriteFrame = {
  bottom: string[][];
  /** Shift the sprite down by this many pixels (0..BOUNCE_PAD). */
  yOffset?: number;
};

// Walk: lateral stepping — legs bend at a "knee" with feet kicking sideways.
// Outer legs (L/R) oppose the middle leg direction. Body bobs via yOffset.

// Neutral stance — all legs straight down, caps centered.
// prettier-ignore
const WALK_S0: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  anchor
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 11  legs straight
  [_, _, O, O, _, _, _, O, O, _, _, _, O, O, _, _], // 12  caps centered
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 13  empty
];

// Outer legs kick right, middle kicks left — knee narrows (OBO), cap follows.
// prettier-ignore
const WALK_S1: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  anchor
  [_, _, O, B, O, _, O, B, O, _, _, _, O, B, O, _], // 11  bent: L→R, M→L, R→R
  [_, _, _, O, O, _, O, O, _, _, _, _, _, O, O, _], // 12  caps follow bend
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 13  empty
];

// Outer legs kick left, middle kicks right — mirror of S1.
// prettier-ignore
const WALK_S3: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  anchor
  [_, O, B, O, _, _, _, O, B, O, _, O, B, O, _, _], // 11  bent: L→L, M→R, R→L
  [_, O, O, _, _, _, _, _, O, O, _, O, O, _, _, _], // 12  caps follow bend
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 13  empty
];

const JOG_FRAMES: SpriteFrame[] = [
  { bottom: WALK_S0, yOffset: 1 }, // neutral (dip)
  { bottom: WALK_S1, yOffset: 0 }, // step right
  { bottom: WALK_S0, yOffset: 1 }, // neutral (dip)
  { bottom: WALK_S3, yOffset: 0 }, // step left
];

// Walk: wave stride — motion ripples across tentacles left → right.
// Three leg states: neutral (straight), mid (knee bends, foot stays), bent (full step).
// The stepping leg cycles L → M → R. The leg before the stepper shows the mid state,
// creating a smooth wave: neutral → mid → bent → neutral.

// Frame 0: L=bent, M=neutral, R=mid (trailing from previous cycle)
// prettier-ignore
const WALK_WAVE_0: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  upper legs
  [_, _, _, B, B, _, _, B, B, _, _, _, _, B, B, _], // 11  L bent knee, M center, R mid knee
  [_, _, _, O, B, O, O, B, B, O, _, O, B, B, O, _], // 12  L bent(narrow), M neutral, R mid(full)
  [_, _, _, _, O, O, _, O, O, _, _, _, O, O, _, _], // 13  caps follow
];

// Frame 1: M=bent, L=mid (trailing), R=neutral
// prettier-ignore
const WALK_WAVE_1: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  upper legs
  [_, _, _, B, B, _, _, _, B, B, _, _, B, B, _, _], // 11  L mid knee, M bent knee, R center
  [_, O, B, B, O, _, _, _, O, B, O, O, B, B, O, _], // 12  L mid(full), M bent(narrow), R neutral
  [_, _, O, O, _, _, _, _, _, O, O, _, O, O, _, _], // 13  caps follow
];

// Frame 2: R=bent, M=mid (trailing), L=neutral
// prettier-ignore
const WALK_WAVE_2: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  upper legs
  [_, _, B, B, _, _, _, _, B, B, _, _, _, B, B, _], // 11  L center, M mid knee, R bent knee
  [_, O, B, B, O, _, O, B, B, O, _, _, _, O, B, O], // 12  L neutral, M mid(full), R bent(narrow)
  [_, _, O, O, _, _, _, O, O, _, _, _, _, _, O, O], // 13  caps follow
];

const WALK_FRAMES: SpriteFrame[] = [
  { bottom: WALK_WAVE_0 },
  { bottom: WALK_WAVE_1 },
  { bottom: WALK_WAVE_2 },
];

// ─── Bounce / float animations ───────────────────────────────────────────────
// Canvas height includes BOUNCE_PAD extra rows; yOffset shifts the sprite down
// so it can move upward without clipping. Sequence: squat → rise → apex → fall.

const BOUNCE_STRAIGHT = [...TENTACLE_TOP, ...TAIL_NEUTRAL];

// Crouch — outer legs splay outward (L bends left, R bends right), coiling to jump.
// prettier-ignore
const BOUNCE_CROUCH: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  anchor
  [_, O, B, O, _, _, O, B, B, O, _, _, O, B, O, _], // 11  L→left, M straight, R→right
  [_, O, O, _, _, _, _, O, O, _, _, _, _, O, O, _], // 12  caps follow splay
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 13  empty
];

// Apex — legs tuck short (retracted), airborne.
// prettier-ignore
const BOUNCE_TUCKED: string[][] = [
  [_, O, B, B, O, _, O, B, B, O, _, O, B, B, O, _], // 10  anchor
  [_, _, O, O, _, _, _, O, O, _, _, _, O, O, _, _], // 11  caps only (short legs)
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 12  empty
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], // 13  empty
];

const BOUNCE_FRAMES: SpriteFrame[] = [
  { bottom: BOUNCE_CROUCH, yOffset: 2 }, // crouch (splay + low)
  { bottom: BOUNCE_STRAIGHT, yOffset: 1 }, // launch (straighten + rise)
  { bottom: BOUNCE_TUCKED, yOffset: 0 }, // apex (tucked + highest)
  { bottom: BOUNCE_STRAIGHT, yOffset: 1 }, // fall (straight + descend)
];

// Float: slow buoyancy — dwell longer at top and bottom.
const FLOAT_FRAMES: SpriteFrame[] = [
  { bottom: BOUNCE_STRAIGHT, yOffset: 0 },
  { bottom: BOUNCE_STRAIGHT, yOffset: 0 },
  { bottom: BOUNCE_STRAIGHT, yOffset: 1 },
  { bottom: BOUNCE_STRAIGHT, yOffset: 2 },
  { bottom: BOUNCE_STRAIGHT, yOffset: 2 },
  { bottom: BOUNCE_STRAIGHT, yOffset: 1 },
];

// ─── Frame timing ────────────────────────────────────────────────────────────

const JOG_FRAME_MS = 220;
const WALK_FRAME_MS = 320;
const SWAY_FRAME_MS = 350;
const FLOAT_FRAME_MS = 420;

// ─── Types ───────────────────────────────────────────────────────────────────

const SPRITE_W = 16;
// HEAD_TOP(3) + face(3) + HEAD_BODY(4) + TENTACLE_TOP(1) + TAIL_NEUTRAL(3) = 14
const SPRITE_H =
  HEAD_TOP.length +
  FACE_NORMAL.length +
  HEAD_BODY.length +
  TENTACLE_TOP.length +
  TAIL_NEUTRAL.length;

// ─── Accessories ──────────────────────────────────────────────────────────────
// Drawn as smooth vector shapes on the canvas (not pixel art) so they look
// good at any scale. All drawing is relative to the dome center/top.

const HEADS: Record<OctopusExpression, string[][]> = {
  normal: buildHead(FACE_NORMAL),
  happy: buildHead(FACE_HAPPY, HEAD_TOP, HEAD_BODY_HAPPY),
  sleepy: buildHead(FACE_SLEEPY),
  angry: buildHead(FACE_ANGRY, HEAD_TOP_ANGRY, HEAD_BODY_ANGRY),
  surprised: buildHead(FACE_SURPRISED),
};

// ─── Drawing ─────────────────────────────────────────────────────────────────

function drawSprite(
  ctx: CanvasRenderingContext2D,
  accentColor: string,
  frame: SpriteFrame,
  head: string[][],
  scale: number,
  topPad: number,
) {
  ctx.clearRect(0, 0, SPRITE_W * scale, (topPad + SPRITE_H + BOUNCE_PAD) * scale);

  const yOff = (frame.yOffset ?? 0) + topPad;
  const layers = [...head, ...frame.bottom];
  for (let y = 0; y < layers.length; y++) {
    const row = layers[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (!cell) continue;
      ctx.fillStyle = cell === E || cell === O ? "#000000" : accentColor;
      ctx.fillRect(x * scale, (y + yOff) * scale, scale, scale);
    }
  }
}

// Three 3×5 Z glyphs staggered rising right→left above the sprite.
// Each Z: top-bar / 3-step diagonal (top-right→bottom-left) / bottom-bar.
// Phase 0: Z1 only · Phase 1: all three · Phase 2-3: hidden.
function drawZZZ(ctx: CanvasRenderingContext2D, scale: number, zzzPhase: number) {
  if (zzzPhase >= 3) return; // phases 3-4 are the blank pause

  ctx.fillStyle = ZZZ_COLOR;

  // Z1 — lowest, right side. Rows 2-6, cols 13-15.
  // prettier-ignore
  const Z1: Array<[number, number]> = [
    [13, 2],
    [14, 2],
    [15, 2],
    [15, 3],
    [14, 4],
    [13, 5],
    [13, 6],
    [14, 6],
    [15, 6],
  ];

  // Z2 — middle height. Rows 1-5, cols 9-11.
  // prettier-ignore
  const Z2: Array<[number, number]> = [
    [9, 1],
    [10, 1],
    [11, 1],
    [11, 2],
    [10, 3],
    [9, 4],
    [9, 5],
    [10, 5],
    [11, 5],
  ];

  // Z3 — highest, left side. Rows 0-4, cols 5-7.
  // prettier-ignore
  const Z3: Array<[number, number]> = [
    [5, 0],
    [6, 0],
    [7, 0],
    [7, 1],
    [6, 2],
    [5, 3],
    [5, 4],
    [6, 4],
    [7, 4],
  ];

  const pixels = zzzPhase === 0 ? Z1 : zzzPhase === 1 ? [...Z1, ...Z2] : [...Z1, ...Z2, ...Z3];
  for (const [x, y] of pixels) {
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }
}

// Draw accessory as smooth vector shapes on top of the pixel sprite.
// Dome top-center is at sprite pixel (8, 0) — used as anchor for all accessories.
function drawAccessory(
  ctx: CanvasRenderingContext2D,
  accessory: OctopusAccessory,
  scale: number,
  yOff: number,
  hColor: string,
) {
  if (accessory === "none") return;

  // Dome geometry in canvas pixels
  const domeL = 4 * scale; // dome outline left edge (col 4)
  const domeR = 12 * scale; // dome outline right edge (col 12)
  const domeCX = 8 * scale; // dome center x
  const domeTop = yOff * scale; // dome top y (row 0 of sprite)
  const domeW = domeR - domeL;

  ctx.save();
  ctx.fillStyle = hColor;

  switch (accessory) {
    case "long": {
      // Long hair — dome cap, two wide straight strands, zigzag bangs with center part.
      // Shaped like the pixel-art wig: covers top, frames face, strands reach tentacle area.
      const hairTop = domeTop - scale * 1.5;
      const strandEnd = domeTop + scale * 10.5;
      const bangY = domeTop + scale * 2.5; // bang line, just above face/eyes
      // Strand edges — inner edges align with dome outline
      const lOut = scale * 0.5;
      const lIn = domeL; // col 4
      const rIn = domeR; // col 12
      const rOut = scale * 15.5;

      // Single path for the entire hair shape
      ctx.beginPath();
      // Top center
      ctx.moveTo(domeCX, hairTop);
      // Arc over to left
      ctx.quadraticCurveTo(lOut, hairTop, lOut, domeTop + scale * 2);
      // Left strand straight down
      ctx.lineTo(lOut, strandEnd);
      // Left strand bottom
      ctx.lineTo(lIn, strandEnd);
      // Left inner edge up to bangs
      ctx.lineTo(lIn, bangY);
      // Bangs — zigzag W with center part
      ctx.lineTo(lIn + scale * 1.5, bangY + scale * 1.8);
      ctx.lineTo(domeCX - scale * 0.5, bangY + scale * 0.5);
      ctx.lineTo(domeCX, bangY + scale * 1.2); // center part dip
      ctx.lineTo(domeCX + scale * 0.5, bangY + scale * 0.5);
      ctx.lineTo(rIn - scale * 1.5, bangY + scale * 1.8);
      // Right inner edge from bangs down
      ctx.lineTo(rIn, bangY);
      ctx.lineTo(rIn, strandEnd);
      // Right strand bottom
      ctx.lineTo(rOut, strandEnd);
      // Right strand straight up
      ctx.lineTo(rOut, domeTop + scale * 2);
      // Arc back to top center
      ctx.quadraticCurveTo(rOut, hairTop, domeCX, hairTop);
      ctx.closePath();

      // Outline first (drawn behind fill via stroke order)
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = scale * 0.6;
      ctx.stroke();
      // Fill on top
      ctx.fill();
      break;
    }
    case "mohawk": {
      // Spiky ridge along the dome center — three pointed triangles.

      const baseY = domeTop + scale * 0.3;
      const spikes: Array<[number, number, number]> = [
        [domeCX - domeW * 0.15, domeTop - scale * 2, domeW * 0.2], // left spike
        [domeCX, domeTop - scale * 3.2, domeW * 0.22], // center spike (tallest)
        [domeCX + domeW * 0.18, domeTop - scale * 2.2, domeW * 0.2], // right spike
      ];
      for (const [cx, tipY, halfW] of spikes) {
        ctx.beginPath();
        ctx.moveTo(cx - halfW, baseY);
        ctx.lineTo(cx, tipY);
        ctx.lineTo(cx + halfW, baseY);
        ctx.closePath();
        ctx.fill();
      }
      // Base strip connecting the spikes
      ctx.beginPath();
      ctx.ellipse(domeCX, baseY, domeW * 0.35, scale * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "side-sweep": {
      // Asymmetric bangs flowing to the left.

      ctx.beginPath();
      // Start from right side of dome
      ctx.moveTo(domeCX + domeW * 0.2, domeTop + scale * 0.5);
      // Sweep up and over to the left
      ctx.quadraticCurveTo(domeCX, domeTop - scale * 2, domeL - scale * 1.5, domeTop - scale * 0.5);
      // Bang tip curves down
      ctx.quadraticCurveTo(
        domeL - scale * 2,
        domeTop + scale * 1.5,
        domeL - scale * 1,
        domeTop + scale * 3,
      );
      // Curve back along the dome edge
      ctx.quadraticCurveTo(domeL - scale * 0.2, domeTop + scale * 2, domeL, domeTop + scale * 0.5);
      // Follow dome top back to start
      ctx.quadraticCurveTo(
        domeCX,
        domeTop + scale * 0.2,
        domeCX + domeW * 0.2,
        domeTop + scale * 0.5,
      );
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "curly": {
      // Curly poof — many small bumpy circles forming a textured cloud.
      // Smaller radius so individual curls are visible, packed densely.
      const r = domeW * 0.18;
      const centers: Array<[number, number]> = [
        // Bottom row — wide, covers head sides
        [domeCX - domeW * 0.5, domeTop + scale * 1.2],
        [domeCX - domeW * 0.25, domeTop + scale * 1.2],
        [domeCX, domeTop + scale * 1.2],
        [domeCX + domeW * 0.25, domeTop + scale * 1.2],
        [domeCX + domeW * 0.5, domeTop + scale * 1.2],
        // Row 2
        [domeCX - domeW * 0.5, domeTop + scale * 0.3],
        [domeCX - domeW * 0.2, domeTop + scale * 0.3],
        [domeCX + domeW * 0.2, domeTop + scale * 0.3],
        [domeCX + domeW * 0.5, domeTop + scale * 0.3],
        // Row 3
        [domeCX - domeW * 0.4, domeTop - scale * 0.3],
        [domeCX - domeW * 0.12, domeTop - scale * 0.3],
        [domeCX + domeW * 0.12, domeTop - scale * 0.3],
        [domeCX + domeW * 0.4, domeTop - scale * 0.3],
        // Row 3
        [domeCX - domeW * 0.3, domeTop - scale * 1.1],
        [domeCX, domeTop - scale * 1.1],
        [domeCX + domeW * 0.3, domeTop - scale * 1.1],
        // Row 4
        [domeCX - domeW * 0.18, domeTop - scale * 1.8],
        [domeCX + domeW * 0.18, domeTop - scale * 1.8],
        // Top
        [domeCX, domeTop - scale * 2.4],
      ];
      for (const [cx, cy] of centers) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }

  ctx.restore();
}

// ─── Animation builder ───────────────────────────────────────────────────────

function buildFrameSequence(animation: OctopusAnimation): SpriteFrame[] {
  switch (animation) {
    case "swim-up":
      return WALKUP_FRAMES.map((bottom) => ({ bottom }));
    case "walk":
      return WALK_FRAMES;
    case "jog":
      return JOG_FRAMES;
    case "bounce":
      return BOUNCE_FRAMES;
    case "float":
      return FLOAT_FRAMES;
    default:
      return SWAY_FRAMES_TAILS.map((tail) => ({ bottom: [...TENTACLE_TOP, ...tail] }));
  }
}

function animationFrameMs(animation: OctopusAnimation): number {
  if (animation === "jog" || animation === "swim-up") return JOG_FRAME_MS;
  if (animation === "walk") return WALK_FRAME_MS;
  if (animation === "float") return FLOAT_FRAME_MS;
  return SWAY_FRAME_MS;
}

const IDLE_FRAME: SpriteFrame = { bottom: [...TENTACLE_TOP, ...TAIL_NEUTRAL] };

// ─── Component ───────────────────────────────────────────────────────────────

type OctopusGlyphProps = {
  animation?: OctopusAnimation;
  expression?: OctopusExpression;
  accessory?: OctopusAccessory;
  /** Hair color override. Default: dark brown. */
  hairColor?: string;
  /** Override the pixel scale (CSS px per sprite pixel). Default: 14. */
  scale?: number;
  className?: string;
  color?: string;
  testId?: string;
};

export const OctopusGlyph = ({
  animation = "sway",
  expression = "normal",
  accessory = "none",
  hairColor = HAIR_COLOR,
  scale = DEFAULT_SCALE,
  className,
  color,
  testId,
}: OctopusGlyphProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const zzzPhaseRef = useRef(0);

  // Extra canvas rows above the sprite for overlays (ZZZ, accessories).
  const topPad = Math.max(
    expression === "sleepy" ? ZZZ_PAD : 0,
    accessory !== "none" ? ACCESSORY_PAD : 0,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    const accentColor =
      color ??
      (getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim() ||
        "#d4a017");

    const head = HEADS[expression];

    const drawFrame = (frame: SpriteFrame, zzzPhase: number) => {
      drawSprite(ctx, accentColor, frame, head, scale, topPad);
      if (expression === "sleepy") drawZZZ(ctx, scale, zzzPhase);
      const yOff = (frame.yOffset ?? 0) + topPad;
      drawAccessory(ctx, accessory, scale, yOff, hairColor);
    };

    // Idle with no ZZZ: static, no interval.
    if (animation === "idle" && expression !== "sleepy") {
      frameRef.current = 0;
      drawFrame(IDLE_FRAME, 0);
      return;
    }

    // Idle sleepy: sprite is static but ZZZ blinks — use sway timing for ZZZ cycle.
    const frames = animation === "idle" ? null : buildFrameSequence(animation);
    const ms = animation === "idle" ? SWAY_FRAME_MS : animationFrameMs(animation);

    frameRef.current = 0;
    zzzPhaseRef.current = 0;
    drawFrame(frames?.[0] ?? IDLE_FRAME, 0);

    const id = setInterval(() => {
      if (frames) {
        frameRef.current = (frameRef.current + 1) % frames.length;
      }
      zzzPhaseRef.current = (zzzPhaseRef.current + 1) % 5;
      drawFrame(frames?.[frameRef.current] ?? IDLE_FRAME, zzzPhaseRef.current);
    }, ms);

    return () => clearInterval(id);
  }, [animation, expression, accessory, hairColor, color, scale, topPad]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={SPRITE_W * scale}
      height={(topPad + SPRITE_H + BOUNCE_PAD) * scale}
      data-testid={testId}
    />
  );
};
