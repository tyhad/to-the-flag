import { describe, expect, test } from "bun:test";
import { makeState } from "./helpers";
import { createRng } from "../engine/rng";
import { walkForward, scoreMethod, type RaceRecord, type CellComparison } from "../scripts/backtest";
import { checkAdoption } from "../scripts/calibrate";
import type { SeasonState } from "../engine/types";

const TEAMS = { alpha: ["AAA", "BBB"], beta: ["CCC", "DDD"] };

/** Generates a small synthetic season from known log-strengths using Plackett-Luce draws. */
function generateSyntheticSeason(
  seed: number,
  trueStrengths: Record<string, number>,
  rounds = 8,
): SeasonState {
  const rng = createRng(seed);
  const drivers = Object.keys(trueStrengths);
  const results: Record<string, string[]> = {};

  for (let r = 1; r <= rounds; r++) {
    const scored = drivers.map((d) => ({
      driver: d,
      score: trueStrengths[d]! + rng.gumbel(),
    }));
    scored.sort((a, b) => b.score - a.score);
    results[`${r}:race`] = scored.map((s) => s.driver);
  }

  return makeState({
    rounds,
    completed: rounds,
    teams: TEAMS,
    results,
  });
}

describe("calibrate harness", () => {
  test("the model on synthetic data generated from true strengths beats uniform", () => {
    // Distinct true strengths: AAA dominates, DDD is slow
    const trueStrengths = { AAA: 3.0, BBB: 1.5, CCC: -0.5, DDD: -2.5 };
    const season = generateSyntheticSeason(42, trueStrengths, 12);

    const records = walkForward(season, { nSims: 2000 }, 6);
    expect(records.length).toBeGreaterThan(0);

    const modelScores = scoreMethod(records, "model");
    const uniformScores = scoreMethod(records, "uniform");

    const modelTotalLoss = modelScores.winLogLoss + modelScores.podiumLogLoss;
    const uniformTotalLoss = uniformScores.winLogLoss + uniformScores.podiumLogLoss;

    expect(modelTotalLoss).toBeLessThan(uniformTotalLoss);
  });

  test("there is no future leakage (changing a later race does not change an earlier forecast)", () => {
    const trueStrengths = { AAA: 2.0, BBB: 1.0, CCC: 0.0, DDD: -1.0 };
    const season = generateSyntheticSeason(100, trueStrengths, 8);

    const recordsBefore = walkForward(season, { nSims: 1000 }, 6);
    const r6Before = recordsBefore.find((r) => r.round === 6);
    expect(r6Before).toBeDefined();

    // Mutate round 7 and round 8 by inverting finishing positions
    const mutated = {
      ...season,
      results: season.results.map((r) => {
        if (r.round >= 7) {
          // invert position: 1 -> 4, 2 -> 3, etc.
          return { ...r, position: 5 - r.position };
        }
        return r;
      }),
    };

    const recordsAfter = walkForward(mutated, { nSims: 1000 }, 6);
    const r6After = recordsAfter.find((r) => r.round === 6);
    expect(r6After).toBeDefined();

    expect(r6Before?.forecasts.model).toEqual(r6After?.forecasts.model!);
  });

  test("the adoption verdict is no for identical settings", () => {
    // Identical setting has 0 difference everywhere
    const zeroComp: CellComparison = { meanDiff: 0, se: 0, clear: false };
    const perSeasonComp = new Map<number, CellComparison>([
      [2022, zeroComp],
      [2023, zeroComp],
      [2024, zeroComp],
      [2025, zeroComp],
    ]);
    const earlyComp = new Map<number, CellComparison>([
      [2022, zeroComp],
      [2023, zeroComp],
      [2024, zeroComp],
      [2025, zeroComp],
      [2026, zeroComp],
    ]);

    const verdict = checkAdoption({
      validationComp: zeroComp,
      confirmationComp: zeroComp,
      perSeasonComp,
      earlyComp,
    });

    expect(verdict.adopt).toBe(false);
    expect(verdict.validationBeats2SE).toBe(false);
    expect(verdict.validationMargin).toBe(false);
    expect(verdict.historySeasonsImproved).toBe(0);
  });

  test("adoption verdict passes when all D30 criteria are satisfied", () => {
    // Validation beats default by > 2 SE and >= 0.005
    const valComp: CellComparison = { meanDiff: -0.012, se: 0.004, clear: true };
    // Improves 3 of 4 history seasons
    const perSeasonComp = new Map<number, CellComparison>([
      [2022, { meanDiff: -0.008, se: 0.003, clear: true }],
      [2023, { meanDiff: -0.006, se: 0.003, clear: false }],
      [2024, { meanDiff: 0.002, se: 0.003, clear: false }], // 1 season worse
      [2025, { meanDiff: -0.012, se: 0.004, clear: true }],
    ]);
    // 2026 confirmation is not worse by > 1 SE
    const confComp: CellComparison = { meanDiff: 0.002, se: 0.005, clear: false };
    // Early season (rounds 3-5) is not worse by > 1 SE for any season
    const earlyComp = new Map<number, CellComparison>([
      [2022, { meanDiff: -0.001, se: 0.004, clear: false }],
      [2023, { meanDiff: 0.002, se: 0.005, clear: false }],
      [2024, { meanDiff: 0.001, se: 0.003, clear: false }],
      [2025, { meanDiff: -0.005, se: 0.004, clear: false }],
      [2026, { meanDiff: 0.003, se: 0.005, clear: false }],
    ]);

    const verdict = checkAdoption({
      validationComp: valComp,
      confirmationComp: confComp,
      perSeasonComp,
      earlyComp,
    });

    expect(verdict.adopt).toBe(true);
    expect(verdict.historySeasonsImproved).toBe(3);
    expect(verdict.reasons).toEqual([]);
  });

  test("adoption verdict rejects when early season or confirmation degrades by > 1 SE", () => {
    const valComp: CellComparison = { meanDiff: -0.015, se: 0.004, clear: true };
    const perSeasonComp = new Map<number, CellComparison>([
      [2022, { meanDiff: -0.008, se: 0.003, clear: true }],
      [2023, { meanDiff: -0.006, se: 0.003, clear: false }],
      [2024, { meanDiff: -0.004, se: 0.003, clear: false }],
      [2025, { meanDiff: -0.015, se: 0.004, clear: true }],
    ]);

    // 2026 confirmation worse by > 1 SE (diff 0.010 > se 0.005)
    const badConf: CellComparison = { meanDiff: 0.010, se: 0.005, clear: false };
    const earlyComp = new Map<number, CellComparison>([
      [2022, { meanDiff: 0.001, se: 0.004, clear: false }],
      [2023, { meanDiff: 0.001, se: 0.004, clear: false }],
      [2024, { meanDiff: 0.001, se: 0.004, clear: false }],
      [2025, { meanDiff: 0.001, se: 0.004, clear: false }],
      [2026, { meanDiff: 0.001, se: 0.004, clear: false }],
    ]);

    const v1 = checkAdoption({
      validationComp: valComp,
      confirmationComp: badConf,
      perSeasonComp,
      earlyComp,
    });
    expect(v1.adopt).toBe(false);
    expect(v1.confirmationPass).toBe(false);

    // Early season on 2024 worse by > 1 SE
    const badEarly = new Map(earlyComp);
    badEarly.set(2024, { meanDiff: 0.020, se: 0.005, clear: false });

    const v2 = checkAdoption({
      validationComp: valComp,
      confirmationComp: { meanDiff: 0.001, se: 0.005, clear: false },
      perSeasonComp,
      earlyComp: badEarly,
    });
    expect(v2.adopt).toBe(false);
    expect(v2.earlyPass).toBe(false);
  });
});
