import { describe, expect, test } from "bun:test";
import { DEFAULT_COUNTBACK, addPosition, compareStanding, emptyCounts, type PositionCounts } from "../engine/countback";

const counts = (race: number[] = [], quali: number[] = []): PositionCounts => ({ race, quali });

describe("addPosition", () => {
  test("grows the array and counts per position", () => {
    const c: number[] = [];
    addPosition(c, 1);
    addPosition(c, 3);
    addPosition(c, 3);
    expect(c).toEqual([1, 0, 2]);
  });

  test("rejects positions < 1 and non-integers", () => {
    for (const bad of [0, -1, 1.5, NaN]) expect(() => addPosition([], bad)).toThrow(RangeError);
  });

  test("emptyCounts returns independent arrays", () => {
    const a = emptyCounts();
    const b = emptyCounts();
    addPosition(a.race, 1);
    expect(b.race).toEqual([]);
  });
});

describe("compareStanding (negative = a ranks ahead)", () => {
  test("more points wins", () => {
    expect(compareStanding({ points: 10, counts: counts() }, { points: 9, counts: counts([5]) })).toBeLessThan(0);
    expect(compareStanding({ points: 9, counts: counts([5]) }, { points: 10, counts: counts() })).toBeGreaterThan(0);
  });

  test("equal points: more wins first", () => {
    expect(compareStanding({ points: 10, counts: counts([1]) }, { points: 10, counts: counts([0, 3]) })).toBeLessThan(0);
  });

  test("equal wins: more P2, then P3, and so on", () => {
    const a = { points: 10, counts: counts([1, 2, 0]) };
    const b = { points: 10, counts: counts([1, 1, 5]) };
    expect(compareStanding(a, b)).toBeLessThan(0);
    const c = { points: 10, counts: counts([1, 1, 2]) };
    expect(compareStanding(c, b)).toBeGreaterThan(0);
  });

  test("arrays of different length are padded with zeros", () => {
    const a = { points: 10, counts: counts([1]) };
    const b = { points: 10, counts: counts([1, 0, 0, 1]) };
    expect(compareStanding(a, b)).toBeGreaterThan(0);
  });

  test("equal race counts: qualifying counts decide", () => {
    const a = { points: 10, counts: counts([1], [0, 1]) };
    const b = { points: 10, counts: counts([1], [1]) };
    expect(compareStanding(a, b)).toBeGreaterThan(0);
  });

  test("everything equal returns 0", () => {
    expect(compareStanding({ points: 10, counts: counts([1], [1]) }, { points: 10, counts: counts([1], [1]) })).toBe(0);
  });

  test("race counts outrank qualifying counts", () => {
    const a = { points: 10, counts: counts([0, 1], [9]) };
    const b = { points: 10, counts: counts([1], []) };
    expect(compareStanding(a, b)).toBeGreaterThan(0);
  });

  test("default options exclude sprints (FIA A2.1.4.c)", () => {
    expect(DEFAULT_COUNTBACK.includeSprint).toBe(false);
  });
});
