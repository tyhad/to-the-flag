import { describe, expect, test } from "bun:test";
import {
  GP_POINTS,
  SPRINT_POINTS,
  gpPoints,
  sessionMaxPoints,
  sprintPoints,
  teamSessionMaxPoints,
  zoneSize,
  type DistanceTier,
} from "../engine/points";

// Written out by hand from DATA_CONTRACT.md section 4 (FIA 2026 A2.1 / A2.2).
// Rows are P1..P10; columns are the tiers.
const TABLE: Record<DistanceTier, number[]> = {
  lt25: [6, 4, 3, 2, 1, 0, 0, 0, 0, 0],
  ge25: [13, 10, 8, 6, 5, 4, 3, 2, 1, 0],
  ge50: [19, 14, 12, 10, 8, 6, 4, 3, 2, 1],
  full: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
};
const TOTALS: Record<DistanceTier, number> = { lt25: 16, ge25: 52, ge50: 79, full: 101 };
const TIERS = Object.keys(TABLE) as DistanceTier[];
const SPRINT = [8, 7, 6, 5, 4, 3, 2, 1];

describe("gpPoints", () => {
  for (const tier of TIERS) {
    test(`every cell of tier ${tier}`, () => {
      TABLE[tier].forEach((expected, i) => {
        expect(gpPoints(i + 1, tier)).toBe(expected);
      });
    });
  }

  test("tier defaults to full", () => {
    expect(gpPoints(1)).toBe(25);
    expect(gpPoints(10)).toBe(1);
  });

  for (const tier of TIERS) {
    test(`column total of ${tier} is ${TOTALS[tier]}`, () => {
      const sum = Array.from({ length: 10 }, (_, i) => gpPoints(i + 1, tier)).reduce((a, b) => a + b, 0);
      expect(sum).toBe(TOTALS[tier]);
    });
  }

  test("positions beyond the zone return 0", () => {
    for (const tier of TIERS) {
      expect(gpPoints(11, tier)).toBe(0);
      expect(gpPoints(22, tier)).toBe(0);
      expect(gpPoints(24, tier)).toBe(0);
    }
  });

  test("positions < 1 or non-integers throw RangeError", () => {
    for (const bad of [0, -1, 1.5, 0.5, NaN, Infinity, -Infinity]) {
      expect(() => gpPoints(bad)).toThrow(RangeError);
    }
  });

  test("unknown tier throws RangeError", () => {
    expect(() => gpPoints(1, "half" as DistanceTier)).toThrow(RangeError);
  });

  test("tables are exposed with 10 rows per tier", () => {
    for (const tier of TIERS) expect(GP_POINTS[tier]).toHaveLength(10);
  });
});

describe("sprintPoints", () => {
  test("every cell", () => {
    SPRINT.forEach((expected, i) => {
      expect(sprintPoints(i + 1)).toBe(expected);
    });
  });

  test("total is 36", () => {
    const sum = Array.from({ length: 8 }, (_, i) => sprintPoints(i + 1)).reduce((a, b) => a + b, 0);
    expect(sum).toBe(36);
    expect(SPRINT_POINTS.reduce((a, b) => a + b, 0)).toBe(36);
  });

  test("positions beyond the zone return 0", () => {
    expect(sprintPoints(9)).toBe(0);
    expect(sprintPoints(10)).toBe(0);
    expect(sprintPoints(22)).toBe(0);
  });

  test("positions < 1 or non-integers throw RangeError", () => {
    for (const bad of [0, -3, 2.5, NaN, Infinity]) {
      expect(() => sprintPoints(bad)).toThrow(RangeError);
    }
  });
});

describe("session constants", () => {
  test("sessionMaxPoints", () => {
    expect(sessionMaxPoints("race")).toBe(25);
    expect(sessionMaxPoints("sprint")).toBe(8);
  });

  test("teamSessionMaxPoints (P1 + P2)", () => {
    expect(teamSessionMaxPoints("race")).toBe(43);
    expect(teamSessionMaxPoints("sprint")).toBe(15);
  });

  test("zoneSize", () => {
    expect(zoneSize("race")).toBe(10);
    expect(zoneSize("sprint")).toBe(8);
  });
});
