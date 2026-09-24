import { describe, expect, it } from "vitest";

import { deriveOctopusVisuals } from "../src/app/octopusVisuals";

describe("deriveOctopusVisuals", () => {
  it("keeps the existing seeded canvas look deterministic for known ids", () => {
    expect(deriveOctopusVisuals({ tentacleId: "api" })).toEqual({
      color: "#00c8ff",
      animation: "float",
      expression: "normal",
      accessory: "none",
      hairColor: undefined,
    });
    expect(deriveOctopusVisuals({ tentacleId: "docs-knowledge" })).toEqual({
      color: "#39ff14",
      animation: "walk",
      expression: "surprised",
      accessory: "curly",
      hairColor: undefined,
    });
    expect(deriveOctopusVisuals({ tentacleId: "api" })).toEqual(
      deriveOctopusVisuals({ tentacleId: "api" }),
    );
  });

  it("lets stored appearance and color win field by field", () => {
    expect(
      deriveOctopusVisuals({
        tentacleId: "docs-knowledge",
        color: "#123456",
        octopus: {
          animation: "bounce",
          expression: null,
          accessory: "mohawk",
          hairColor: "#abcdef",
        },
      }),
    ).toEqual({
      color: "#123456",
      animation: "bounce",
      expression: "happy",
      accessory: "mohawk",
      hairColor: "#abcdef",
    });
  });

  it("usually gives different ids different looks", () => {
    expect(deriveOctopusVisuals({ tentacleId: "api" })).not.toEqual(
      deriveOctopusVisuals({ tentacleId: "docs-knowledge" }),
    );
  });
});
