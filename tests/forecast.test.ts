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
