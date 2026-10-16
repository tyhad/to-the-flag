/**
 * Phase 4, Step 8: estimating `qualifyingNoise` on the training seasons.
 * The simulated qualifying is key = strength + qualifyingNoise * Gumbel; the estimate is the noise that makes the
 * real grids most likely, given the strengths fitted from the races before each one.
 */
import { describe, expect, test } from "bun:test";
import { createRng } from "../engine/rng";
import type { SeasonState } from "../engine/types";
import { QUALIFYING_NOISES, fitQualifyingNoise, gridLogLikelihood, type CalibrationSeasons } from "../scripts/calibrate";
import { makeState } from "./helpers";

const DRIVERS = ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"];
const TEAMS = { a: ["A1", "A2"], b: ["B1", "B2"], c: ["C1", "C2"], d: ["D1", "D2"] };
const PACE: Record<string, number> = { A1: 1.2, A2: 0.8, B1: 0.4, B2: 0, C1: -0.4, C2: -0.8, D1: -1.2, D2: -1.6 };

/** Races follow pace; the grid follows pace plus `tau` times Gumbel noise. */
function season(year: number, seed: number, tau: number, rounds = 14): SeasonState {
  const rng = createRng(seed);
  const results: Record<string, { order: string[]; grid: Record<string, number> }> = {};
  for (let r = 1; r <= rounds; r++) {
    const quali = DRIVERS.map((d) => ({ d, key: PACE[d]! + tau * rng.gumbel() })).sort((x, y) => y.key - x.key);
    const grid: Record<string, number> = {};
    quali.forEach((x, i) => (grid[x.d] = i + 1));
    const race = DRIVERS.map((d) => ({ d, key: PACE[d]! + rng.gumbel() })).sort((x, y) => y.key - x.key);
    results[`${r}:race`] = { order: race.map((x) => x.d), grid };
  }
  return makeState({ season: year, rounds, completed: rounds, teams: TEAMS, results });
}

function seasons(tau: number, base: number): CalibrationSeasons {
  const all = [2022, 2023, 2024, 2025, 2026].map((y, i) => season(y, base + i * 131, tau));
  return { training: all.slice(0, 3), validation: all[3]!, confirmation: all[4]!, all };
}

describe("gridLogLikelihood", () => {
  test("a grid in the order of the strengths is likelier with a small noise than a large one", () => {
    const sorted = [2, 1, 0, -1, -2];
    expect(gridLogLikelihood(sorted, 0.25)).toBeGreaterThan(gridLogLikelihood(sorted, 3));
  });

  test("a grid in the opposite order is likelier with a large noise", () => {
    const reversed = [-2, -1, 0, 1, 2];
    expect(gridLogLikelihood(reversed, 3)).toBeGreaterThan(gridLogLikelihood(reversed, 0.25));
  });

  test("equal strengths give the log of 1 / n!, whatever the noise", () => {
    const expected = -Math.log(24); // 4! orders
    expect(gridLogLikelihood([0, 0, 0, 0], 0.5)).toBeCloseTo(expected, 12);
    expect(gridLogLikelihood([0, 0, 0, 0], 2)).toBeCloseTo(expected, 12);
  });

  test("is a log probability: never above 0", () => {
    expect(gridLogLikelihood([5, 0, -5], 0.25)).toBeLessThanOrEqual(0);
  });
});

describe("fitQualifyingNoise", () => {
  test("the noises tried are a coarse grid", () => {
    expect([...QUALIFYING_NOISES]).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2, 3]);
  });

  test("a grid made with noise 1 gives an estimate near 1", () => {
    const fit = fitQualifyingNoise(seasons(1, 100));
    expect(fit.selected).toBeGreaterThanOrEqual(0.75);
    expect(fit.selected).toBeLessThanOrEqual(1.5);
  });

  test("a noisier qualifying gives a larger estimate", () => {
    const quiet = fitQualifyingNoise(seasons(0.5, 200)).selected;
    const loud = fitQualifyingNoise(seasons(2, 300)).selected;
    expect(loud).toBeGreaterThan(quiet);
  });

  test("the choice uses the training seasons only", () => {
    const a = seasons(1, 400);
    // make the validation and confirmation grids nonsense (reversed): the training choice must not move
    const flip = (s: SeasonState): SeasonState => ({ ...s, results: s.results.map((r) => ({ ...r, grid: DRIVERS.length + 1 - r.grid })) });
    const b: CalibrationSeasons = {
      ...a,
      validation: flip(a.validation),
      confirmation: flip(a.confirmation),
      all: [...a.training, flip(a.validation), flip(a.confirmation)],
    };
    expect(fitQualifyingNoise(b).selected).toBe(fitQualifyingNoise(a).selected);
  });

  test("each noise reports a training, validation and confirmation likelihood with its standard error", () => {
    const fit = fitQualifyingNoise(seasons(1, 500), [0.5, 1]);
    expect(fit.byNoise.map((r) => r.noise)).toEqual([0.5, 1]);
    for (const row of fit.byNoise) {
      for (const cell of [row.training, row.validation, row.confirmation]) {
        expect(cell.n).toBeGreaterThan(0);
        expect(Number.isFinite(cell.mean)).toBe(true);
        expect(cell.se).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
