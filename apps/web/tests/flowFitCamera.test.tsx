import { describe, expect, it } from "vitest";

import { computeFitCamera, project } from "../src/app/flow/layout";

const VIEWPORT = { width: 1200, height: 700 };

describe("computeFitCamera", () => {
  it("frames a wide fleet so no node projects outside the viewport", () => {
    // Eight tentacles fanned vertically plus a deep agent chain to the right —
    // the shape that clipped the topmost octopus under the fixed camera.
    const nodes = [
      { x: 0, y: 0, z: 0 },
      ...Array.from({ length: 8 }, (_, index) => ({
        x: 240,
        y: (index - 3.5) * 120,
        z: -180,
      })),
      { x: 820, y: 0, z: -110 },
    ];

    const camera = computeFitCamera(nodes, VIEWPORT);

    for (const node of nodes) {
      const { sx, sy } = project(node, camera);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(VIEWPORT.width);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it("anchors the leftmost node at the left margin instead of centering", () => {
    const nodes = [
      { x: 0, y: 0, z: 0 },
      { x: 400, y: 0, z: 0 },
    ];

    const camera = computeFitCamera(nodes, VIEWPORT);
    expect(project(nodes[0] ?? { x: 0, y: 0, z: 0 }, camera).sx).toBeCloseTo(280, 5);
  });

  it("centers the scene vertically", () => {
    const nodes = [
      { x: 0, y: -300, z: 0 },
      { x: 0, y: 300, z: 0 },
    ];

    const camera = computeFitCamera(nodes, VIEWPORT);
    const top = project(nodes[0] ?? { x: 0, y: 0, z: 0 }, camera);
    const bottom = project(nodes[1] ?? { x: 0, y: 0, z: 0 }, camera);

    expect((top.sy + bottom.sy) / 2).toBeCloseTo(VIEWPORT.height / 2, 5);
  });

  it("never zooms in past 1 for a small fleet", () => {
    const camera = computeFitCamera([{ x: 0, y: 0, z: 0 }], VIEWPORT);
    expect(camera.zoom).toBe(1);
  });

  it("stops zooming out at the floor for an oversized fleet", () => {
    const nodes = [
      { x: -6000, y: 0, z: 0 },
      { x: 6000, y: 0, z: 0 },
    ];
    expect(computeFitCamera(nodes, VIEWPORT).zoom).toBe(0.45);
  });

  it("falls back to a sane camera when there is nothing to frame", () => {
    const camera = computeFitCamera([], VIEWPORT);
    expect(camera.zoom).toBe(1);
    expect(camera.panX).toBe(280);
  });
});
