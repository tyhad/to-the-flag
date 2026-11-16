/**
 * Phase 9, Step 3: `finishStages`, a separate pace fit for the finish part of the race forecast (`top10` and
 * `meanPosition`). Default 0 means "same as paceStages", the v2 behavior; win and podium never change.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeDrivers, defaultOddsParams, deriveSeed, finishSeed, forecastRace, simulateSeason } from "../engine";
import type { SeasonState } from "../engine/types";

const real = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const field = activeDrivers(real);
/** A made-up grid in the order of the field, so the grid term is on. */
const grid = Object.fromEntries(field.map((c, i) => [c, i + 1]));
const base = { nSims: 3000, seed: 7 };

describe("finishStages: the setting", () => {
  test("defaults to 0, the v2 behavior, and is listed with the other defaults", () => {
    expect(defaultOddsParams.finishStages).toBe(0);
    expect(defaultOddsParams.paceStages).toBe(5);
  });

  test("a whole number of 0 or more; anything else is refused like the other parameters", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => forecastRace(real, { ...base, finishStages: bad }, field, grid)).toThrow(RangeError);
    }
    for (const ok of [0, 1, 8, 10, 99]) {
      expect(() => forecastRace(real, { ...base, nSims: 50, finishStages: ok }, field, grid)).not.toThrow();
    }
  });

  test("the season simulation refuses it too, but does not use it", () => {
    expect(() => simulateSeason(real, undefined, { nSims: 20, finishStages: -1 })).toThrow(RangeError);
    const a = simulateSeason(real, undefined, { nSims: 200 });
    const b = simulateSeason(real, undefined, { nSims: 200, finishStages: 8 });
    expect(b.seed).toBe(a.seed);
    expect(b.driverWins).toEqual(a.driverWins);
    expect(b.driverPointSums).toEqual(a.driverPointSums);
    expect(b.params.finishStages).toBe(8);
  });

  test("it never changes the default seed: a run with and without it start from the same seed", () => {
    const params = { ...defaultOddsParams, nSims: 100 };
    expect(deriveSeed(real, undefined, { ...params, finishStages: 8 })).toBe(deriveSeed(real, undefined, params));
    expect(deriveSeed(real, undefined, { ...params, finishStages: 0 })).toBe(deriveSeed(real, undefined, params));
  });
});

describe("forecastRace with finishStages", () => {
  const plain = forecastRace(real, base, field, grid);

  test("0 gives exactly today's numbers, field by field", () => {
    expect(forecastRace(real, { ...base, finishStages: 0 }, field, grid)).toEqual(plain);
  });

  test("a value equal to paceStages is the same as 0: there is no second fit", () => {
    expect(forecastRace(real, { ...base, finishStages: 5 }, field, grid)).toEqual(plain);
    expect(forecastRace(real, { ...base, paceStages: 8, finishStages: 8 }, field, grid)).toEqual(forecastRace(real, { ...base, paceStages: 8 }, field, grid));
  });

  test("with any other value, win and podium are identical to the run without it", () => {
    for (const finishStages of [3, 8, 10, 99]) {
      const f = forecastRace(real, { ...base, finishStages }, field, grid);
      expect(f.win).toEqual(plain.win);
      expect(f.podium).toEqual(plain.podium);
      expect(f.seed).toBe(plain.seed);
      expect(f.nSims).toBe(plain.nSims);
    }
  });

  test("top10 and meanPosition change", () => {
    const f = forecastRace(real, { ...base, finishStages: 8 }, field, grid);
    expect(f.top10).not.toEqual(plain.top10);
    expect(f.meanPosition).not.toEqual(plain.meanPosition);
  });

  test("they are what a plain forecast with paceStages = finishStages gives under the derived seed", () => {
    const f = forecastRace(real, { ...base, finishStages: 8 }, field, grid);
    const second = forecastRace(real, { ...base, paceStages: 8, seed: finishSeed(base.seed) }, field, grid);
    expect(f.top10).toEqual(second.top10);
    expect(f.meanPosition).toEqual(second.meanPosition);
  });

  test("the second pass has its own seed, not the first one's", () => {
    expect(finishSeed(7)).not.toBe(7);
    expect(finishSeed(7)).toBe(finishSeed(7));
    expect(finishSeed(7)).not.toBe(finishSeed(8));
  });

  test("two runs with the same seed agree, and another seed gives other numbers", () => {
    const a = forecastRace(real, { ...base, finishStages: 8 }, field, grid);
    expect(forecastRace(real, { ...base, finishStages: 8 }, field, grid)).toEqual(a);
    const c = forecastRace(real, { ...base, seed: 8, finishStages: 8 }, field, grid);
    expect(c.top10).not.toEqual(a.top10);
  });

  test("the second pass simulates as many races as the first: every top10 is a whole count over nSims", () => {
    const f = forecastRace(real, { ...base, nSims: 1234, finishStages: 8 }, field, grid);
    expect(f.nSims).toBe(1234);
    for (const code of field) {
      expect(Math.abs(f.top10[code]! * 1234 - Math.round(f.top10[code]! * 1234))).toBeLessThan(1e-6);
      expect(Math.abs(f.meanPosition[code]! * 1234 - Math.round(f.meanPosition[code]! * 1234))).toBeLessThan(1e-6);
    }
  });

  test("the second pass uses the same grid and the same field", () => {
    const front = forecastRace(real, { ...base, finishStages: 8 }, field, grid);
    expect(Object.keys(front.top10).sort()).toEqual([...field].sort());
    const flipped = Object.fromEntries(field.map((c, i) => [c, field.length - i]));
    const other = forecastRace(real, { ...base, finishStages: 8 }, field, flipped);
    expect(other.top10).not.toEqual(front.top10);
  });

  test("with no grid it is the same story: win and podium unchanged", () => {
    const noGrid = forecastRace(real, base, field);
    const f = forecastRace(real, { ...base, finishStages: 8 }, field);
    expect(f.win).toEqual(noGrid.win);
    expect(f.podium).toEqual(noGrid.podium);
    expect(f.top10).not.toEqual(noGrid.top10);
  });

  test("finishStages 99 is the all-places fit: the same top10 and meanPosition as paceStages 0 and finishStages 0", () => {
    const all = forecastRace(real, { ...base, finishStages: 99 }, field, grid);
    // the second pass runs on the derived seed, so the all-places run is given that seed to be compared with
    const zero = forecastRace(real, { ...base, paceStages: 0, finishStages: 0, seed: finishSeed(base.seed) }, field, grid);
    expect(all.top10).toEqual(zero.top10);
    expect(all.meanPosition).toEqual(zero.meanPosition);
  });

  test("any value of at least the field size is the same all-places fit, through forecastRace", () => {
    const all = forecastRace(real, { ...base, finishStages: 99 }, field, grid);
    const exact = forecastRace(real, { ...base, finishStages: field.length }, field, grid);
    expect(exact.top10).toEqual(all.top10);
    expect(exact.meanPosition).toEqual(all.meanPosition);
    expect(field.length).toBeLessThan(99);
  });
});
