/**
 * Phase 3 Step 10: forecastRace, the single-session version of the season simulation (used by the backtest).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forecastRace, simulateSeason } from "../engine/simulate";
import { fitStrengths } from "../engine/strength";
import type { SeasonState } from "../engine/types";
import { makeState } from "./helpers";

const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);
const teams4 = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
const order4 = ["AAA", "BBB", "CCC", "DDD"];
const state = makeState({
  rounds: 8, completed: 4, teams: teams4,
  results: Object.fromEntries([1, 2, 3, 4].map((r) => [`${r}:race`, order4])),
});
const quick = { nSims: 4000, seed: 1 };

describe("forecastRace", () => {
  test("is reproducible by seed, and a different seed gives different numbers", () => {
    expect(forecastRace(state, quick)).toEqual(forecastRace(state, quick));
    expect(forecastRace(state, { ...quick, seed: 2 }).win).not.toEqual(forecastRace(state, quick).win);
  });

  test("without retirements win probabilities sum to 1 and podium probabilities to 3", () => {
    const f = forecastRace(state, { ...quick, includeDnf: false });
    expect(sum(Object.values(f.win))).toBeCloseTo(1, 12);
    expect(sum(Object.values(f.podium))).toBeCloseTo(3, 12);
  });

  test("with retirements the probabilities add up to a little less, never more", () => {
    const f = forecastRace(state, { ...quick, includeDnf: true });
    expect(sum(Object.values(f.win))).toBeLessThanOrEqual(1 + 1e-12);
    expect(sum(Object.values(f.podium))).toBeLessThanOrEqual(3 + 1e-12);
  });

  test("every probability is between 0 and 1", () => {
    const f = forecastRace(state, quick);
    for (const p of [...Object.values(f.win), ...Object.values(f.podium)]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  test("the driver who always won is the favourite, and the one who always came last the outsider", () => {
    const f = forecastRace(state, quick);
    expect(f.win.AAA!).toBeGreaterThan(f.win.BBB!);
    expect(f.win.BBB!).toBeGreaterThan(f.win.DDD!);
    expect(f.podium.AAA!).toBeGreaterThan(f.podium.DDD!);
  });

  test("a podium chance is never lower than the win chance", () => {
    const f = forecastRace(state, quick);
    for (const d of order4) expect(f.podium[d]!).toBeGreaterThanOrEqual(f.win[d]!);
  });

  test("formWeight 0 makes the drivers equal (within 3 standard errors)", () => {
    const n = 20_000;
    const f = forecastRace(state, { nSims: n, seed: 3, formWeight: 0, includeDnf: false });
    const se = Math.sqrt((0.25 * 0.75) / n);
    for (const d of order4) expect(Math.abs(f.win[d]! - 0.25)).toBeLessThan(3 * se);
  });

  test("only the given field takes part", () => {
    const f = forecastRace(state, { ...quick, includeDnf: false }, ["AAA", "BBB", "CCC"]);
    expect(Object.keys(f.win).sort()).toEqual(["AAA", "BBB", "CCC"]);
    expect(sum(Object.values(f.win))).toBeCloseTo(1, 12);
    expect(sum(Object.values(f.podium))).toBeCloseTo(3, 12);
  });

  test("the default field is the drivers who are still racing", () => {
    const withLeaver = makeState({
      rounds: 4, completed: 2, teams: teams4,
      results: { "1:race": order4, "2:race": ["AAA", "BBB", "CCC"] }, // DDD is not in the latest round
    });
    expect(Object.keys(forecastRace(withLeaver, quick).win).sort()).toEqual(["AAA", "BBB", "CCC"]);
  });

  test("a driver with no results yet can be in the field, and gets a chance", () => {
    const f = forecastRace(state, { ...quick, includeDnf: false }, [...order4, "NEW"]);
    expect(f.win.NEW!).toBeGreaterThan(0);
    expect(sum(Object.values(f.win))).toBeCloseTo(1, 12);
  });

  test("the state is not changed, and the result reports the seed and the number of simulations", () => {
    const before = JSON.stringify(state);
    const f = forecastRace(state, { nSims: 100, seed: 9 });
    expect(JSON.stringify(state)).toBe(before);
    expect(f).toMatchObject({ nSims: 100, seed: 9 });
  });

  test("nonsense parameters are refused", () => {
    expect(() => forecastRace(state, { nSims: 0 })).toThrow(RangeError);
    expect(() => forecastRace(state, { formWeight: 2 })).toThrow(RangeError);
  });

  test("agrees with the season simulation when one race decides the title", () => {
    // Level on points, one race left: whoever wins the race wins the title. BBB won the latest rounds, so he is faster.
    const decider = makeState({
      rounds: 5, completed: 4, teams: { red: ["AAA"], blue: ["BBB"] },
      results: { "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"], "3:race": ["BBB", "AAA"], "4:race": ["BBB", "AAA"] },
    });
    const params = { nSims: 20_000, seed: 5, includeDnf: false, recencyHalfLife: 1 };
    const race = forecastRace(decider, params);
    const title = simulateSeason(decider, undefined, params);
    const se = Math.sqrt(0.25 / 20_000); // standard error of a probability near one half
    expect(race.win.BBB!).toBeGreaterThan(0.55);
    expect(Math.abs(race.win.BBB! - title.driverWins.BBB! / 20_000)).toBeLessThan(4 * se);
  });

  test("matches the Plackett-Luce formula when there is no noise and no retirements: P(win) = exp(theta) / sum of exp(theta)", () => {
    const real = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
    const params = { nSims: 200_000, seed: 11, includeDnf: false, strengthSigma: 0 };
    const field = real.drivers.filter((d) => d.active).map((d) => d.code);
    const { theta } = fitStrengths(real); // the forecast uses the default strength settings
    const total = sum(field.map((d) => Math.exp(theta[d]!)));
    const f = forecastRace(real, params, field);
    for (const d of field) {
      const exact = Math.exp(theta[d]!) / total;
      const se = Math.sqrt((exact * (1 - exact)) / params.nSims);
      expect(Math.abs(f.win[d]! - exact)).toBeLessThan(4 * se + 1e-9);
    }
    // the chance of finishing second follows the same formula, conditioned on who won
    const second = (d: string) => sum(field.filter((w) => w !== d).map((w) => (Math.exp(theta[w]!) / total) * (Math.exp(theta[d]!) / (total - Math.exp(theta[w]!)))));
    for (const d of ["ANT", "NOR", "BOT"]) {
      const exactPodiumLowerBound = Math.exp(theta[d]!) / total + second(d);
      expect(f.podium[d]!).toBeGreaterThan(exactPodiumLowerBound - 0.01);
    }
  });

  test("works on the real Round 16 data", () => {
    const real = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
    const f = forecastRace(real, { nSims: 4000, seed: 1 });
    expect(Object.keys(f.win)).not.toContain("TSU");
    const top = Object.entries(f.win).sort((a, b) => b[1] - a[1])[0]!;
    expect(["ANT", "HAM", "NOR"]).toContain(top[0]);
  });
});

describe("forecastRace: the chance of points and the average finish (Phase 8, Step 5)", () => {
  const round16 = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
  const racing = round16.drivers.filter((d) => d.active).map((d) => d.code);
  const gridOf = Object.fromEntries(racing.map((code, i) => [code, i + 1]));

  test("win and podium are exactly what they were before these fields existed (golden values)", () => {
    const f = forecastRace(state, quick);
    expect(f.win).toEqual({ AAA: 0.764, BBB: 0.176, CCC: 0.04975, DDD: 0.01025 });
    expect(f.podium).toEqual({ AAA: 0.99825, BBB: 0.976, CCC: 0.82475, DDD: 0.201 });

    const g = forecastRace(round16, { nSims: 3000, seed: 7 }, undefined, gridOf);
    expect(g.win["ANT"]).toBeCloseTo(0.5593333333333333, 12);
    expect(g.podium["ANT"]).toBeCloseTo(0.8983333333333333, 12);
    expect(g.win["LEC"]).toBeCloseTo(0.068, 12);
    expect(g.podium["LEC"]).toBeCloseTo(0.281, 12);
    expect(g.win["HAM"]).toBeCloseTo(0.06633333333333333, 12);
    expect(g.podium["HAM"]).toBeCloseTo(0.30133333333333334, 12);
  });

  test("the new fields cover exactly the drivers of the field, like win and podium", () => {
    const f = forecastRace(state, quick, ["BBB", "DDD"]);
    expect(Object.keys(f.top10).sort()).toEqual(["BBB", "DDD"]);
    expect(Object.keys(f.meanPosition).sort()).toEqual(["BBB", "DDD"]);
  });

  test("without retirements: the four drivers all finish in the points, and the average places add up to 1+2+3+4", () => {
    const f = forecastRace(state, { ...quick, includeDnf: false });
    for (const c of order4) expect(f.top10[c]).toBe(1);
    expect(sum(Object.values(f.meanPosition))).toBeCloseTo(10, 12);
  });

  test("the win chances of the field add up to 1, as before (no retirements)", () => {
    const f = forecastRace(round16, { nSims: 2000, seed: 3, includeDnf: false }, undefined, gridOf);
    expect(sum(Object.values(f.win))).toBeCloseTo(1, 12);
    expect(sum(Object.values(f.top10))).toBeCloseTo(10, 12); // ten places in the points, always filled
    expect(sum(Object.values(f.podium))).toBeCloseTo(3, 12);
  });

  test("with retirements the points places are not always filled: the sum is below 10, never above", () => {
    const f = forecastRace(round16, { nSims: 2000, seed: 3, includeDnf: true }, undefined, gridOf);
    const total = sum(Object.values(f.top10));
    expect(total).toBeLessThanOrEqual(10 + 1e-12);
    expect(total).toBeGreaterThan(8);
  });

  test("for every driver: win <= podium <= points <= 1", () => {
    for (const includeDnf of [true, false]) {
      const f = forecastRace(round16, { nSims: 2000, seed: 5, includeDnf }, undefined, gridOf);
      for (const c of racing) {
        expect(f.win[c]!).toBeLessThanOrEqual(f.podium[c]! + 1e-12);
        expect(f.podium[c]!).toBeLessThanOrEqual(f.top10[c]! + 1e-12);
        expect(f.top10[c]!).toBeLessThanOrEqual(1);
        expect(f.win[c]!).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("the average finishing place lies between 1 and the size of the field", () => {
    const f = forecastRace(round16, { nSims: 2000, seed: 5 }, undefined, gridOf);
    for (const c of racing) {
      expect(f.meanPosition[c]!).toBeGreaterThanOrEqual(1);
      expect(f.meanPosition[c]!).toBeLessThanOrEqual(racing.length);
    }
  });

  test("a retirement counts as last place: the average places add up to 1+2+...+N without retirements, and to more with them", () => {
    const n = racing.length;
    const triangle = (n * (n + 1)) / 2;
    const without = forecastRace(round16, { nSims: 2000, seed: 5, includeDnf: false }, undefined, gridOf);
    expect(sum(Object.values(without.meanPosition))).toBeCloseTo(triangle, 9);
    const withDnf = forecastRace(round16, { nSims: 2000, seed: 5, includeDnf: true }, undefined, gridOf);
    expect(sum(Object.values(withDnf.meanPosition))).toBeGreaterThan(triangle);
    expect(sum(Object.values(withDnf.meanPosition))).toBeLessThanOrEqual(n * n);
  });

  test("the driver who always won has the lowest average place", () => {
    const f = forecastRace(state, quick);
    expect(f.meanPosition["AAA"]!).toBeLessThan(f.meanPosition["BBB"]!);
    expect(f.meanPosition["BBB"]!).toBeLessThan(f.meanPosition["DDD"]!);
  });

  test("a driver on pole has a lower average place than the same driver at the back", () => {
    const pole = forecastRace(round16, { nSims: 3000, seed: 9 }, undefined, { ...gridOf, LEC: 1 });
    const back = forecastRace(round16, { nSims: 3000, seed: 9 }, undefined, { ...gridOf, LEC: racing.length });
    expect(pole.meanPosition["LEC"]!).toBeLessThan(back.meanPosition["LEC"]!);
    expect(pole.top10["LEC"]!).toBeGreaterThan(back.top10["LEC"]!);
  });

  test("is reproducible by seed, new fields included", () => {
    expect(forecastRace(round16, { nSims: 500, seed: 4 }, undefined, gridOf)).toEqual(forecastRace(round16, { nSims: 500, seed: 4 }, undefined, gridOf));
  });
});
