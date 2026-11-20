/** Phase 11, Step 2: the carryover evaluation (protocol D64), tested on hand-made comparisons. */
import { describe, expect, test } from "bun:test";
import {
  CARRYOVER_MATERIAL_DIFFERENCE,
  carryoverCandidates,
  checkCarryoverAdoption,
  evaluateCarryover,
  formatCarryover,
  selectCarryover,
  type CarryoverCandidateResult,
} from "../scripts/calibrate";
import { EARLY_ROUNDS, earlyWindow, walkForward } from "../scripts/backtest";
import type { CellComparison } from "../scripts/backtest";
import type { SeasonState } from "../engine/types";
import { makeState } from "./helpers";

const comp = (meanDiff: number, se = 0.01): CellComparison => ({ meanDiff, se, clear: false });

/** A comparison map over the three judged seasons. */
const seasons = (early: number[], whole = [0, 0, 0]): { early: Map<number, CellComparison>; whole: Map<number, CellComparison> } => ({
  early: new Map([2023, 2024, 2025].map((y, i) => [y, comp(early[i]!)])),
  whole: new Map([2023, 2024, 2025].map((y, i) => [y, comp(whole[i]!)])),
});

describe("checkCarryoverAdoption (D64)", () => {
  test("a candidate that equals v2 is not adopted", () => {
    const s = seasons([0, 0, 0]);
    const verdict = checkCarryoverAdoption({ validationEarly: comp(0), pooledEarly: comp(0), perSeasonEarly: s.early, perSeasonWhole: s.whole });
    expect(verdict.adopt).toBe(false);
    expect(verdict.validationPass).toBe(false);
    expect(verdict.pooledPass).toBe(false);
    expect(verdict.seasonsImproved).toBe(0);
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(3);
  });

  test("a candidate that wins only on 2025 is not adopted", () => {
    const s = seasons([0.002, 0.001, -0.02]);
    const verdict = checkCarryoverAdoption({
      validationEarly: comp(-0.02, 0.005),
      pooledEarly: comp(0.0005),
      perSeasonEarly: s.early,
      perSeasonWhole: s.whole,
    });
    expect(verdict.validationPass).toBe(true);
    expect(verdict.pooledPass).toBe(false);
    expect(verdict.seasonsImproved).toBe(1);
    expect(verdict.adopt).toBe(false);
    expect(verdict.reasons.some((r) => r.includes("Pooled 2023-2025"))).toBe(true);
  });

  test("a candidate that fails the whole-season check is not adopted", () => {
    const s = seasons([-0.002, -0.002, -0.02], [0, 0.05, 0]);
    const verdict = checkCarryoverAdoption({
      validationEarly: comp(-0.02, 0.005),
      pooledEarly: comp(-0.01, 0.003),
      perSeasonEarly: s.early,
      perSeasonWhole: s.whole,
    });
    expect(verdict.validationPass).toBe(true);
    expect(verdict.pooledPass).toBe(true);
    expect(verdict.seasonsImproved).toBe(3);
    expect(verdict.wholeSeasonPass).toBe(false);
    expect(verdict.adopt).toBe(false);
    expect(verdict.reasons.some((r) => r.includes("Whole season 2024"))).toBe(true);
  });

  test("a candidate that passes every rule is adopted, and the margin is the D64 one", () => {
    const s = seasons([-0.002, -0.002, -0.02]);
    const pass = {
      validationEarly: comp(-0.02, 0.005),
      pooledEarly: comp(-0.01, 0.003),
      perSeasonEarly: s.early,
      perSeasonWhole: s.whole,
    };
    expect(checkCarryoverAdoption(pass).adopt).toBe(true);
    expect(checkCarryoverAdoption(pass).reasons).toEqual([]);
    // 1 SE is not enough on 2025, and neither is a win smaller than the material difference
    expect(checkCarryoverAdoption({ ...pass, validationEarly: comp(-0.004, 0.005) }).adopt).toBe(false);
    expect(checkCarryoverAdoption({ ...pass, validationEarly: comp(-0.02, 0.02) }).adopt).toBe(false);
    expect(CARRYOVER_MATERIAL_DIFFERENCE).toBe(0.005);
  });
});

describe("selectCarryover (D64 rule 5)", () => {
  /** A candidate result with the given training and 2025 early differences. */
  function result(carryover: number, sameTeamOnly: boolean, training: number, validation: number): CarryoverCandidateResult {
    const bySeason = new Map(
      [2023, 2024, 2025, 2026].map((y) => [y, { early: comp(y === 2025 ? validation : training), whole: comp(0) }]),
    );
    return {
      candidate: { carryover, sameTeamOnly, label: `${carryover}, ${sameTeamOnly ? "same team only" : "all teams"}` },
      bySeason,
      trainingEarly: comp(training),
      pooledEarly: comp(training),
      verdict: checkCarryoverAdoption({
        validationEarly: comp(validation),
        pooledEarly: comp(training),
        perSeasonEarly: seasons([training, training, validation]).early,
        perSeasonWhole: seasons([0, 0, 0]).whole,
      }),
    };
  }

  test("the best on 2025 but not on the tuning seasons is not chosen", () => {
    const bestOn2025 = result(0.25, false, 0.001, -0.02);
    const bestOnTraining = result(0.5, false, -0.002, -0.001);
    expect(selectCarryover([bestOn2025, bestOnTraining])).toBe(bestOnTraining);
  });

  test("nothing is chosen when no candidate beats v2 on the tuning seasons", () => {
    expect(selectCarryover([result(0.25, false, 0, 0), result(0.5, true, 0.001, -0.02)])).toBeNull();
  });

  test("a tie goes to the earlier candidate", () => {
    const a = result(0.25, false, -0.002, 0);
    const b = result(0.5, false, -0.002, 0);
    expect(selectCarryover([a, b])).toBe(a);
  });
});

describe("evaluateCarryover", () => {
  const teams = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
  const order = ["AAA", "BBB", "CCC", "DDD"];
  /** A small season: `rounds` races, every one in `finishOrder`. */
  function season(year: number, finishOrder = order): SeasonState {
    return makeState({
      season: year,
      rounds: 6,
      completed: 6,
      teams,
      results: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${i + 1}:race`, finishOrder])),
    });
  }

  test("the early window is the first five races, and the whole season is everything", () => {
    const records = walkForward(season(2025), { nSims: 5 }, 1);
    expect(EARLY_ROUNDS).toBe(5);
    expect(records.length).toBe(6);
    expect(earlyWindow(records).map((r) => r.round)).toEqual([1, 2, 3, 4, 5]);
  });

  test("a season without its previous season is skipped with a reason, never a crash", () => {
    const result = evaluateCarryover({ all: [season(2024)] }, 10);
    expect(result.candidates).toEqual([]);
    expect(result.selected).toBeNull();
    expect(result.skipped.map((s) => s.season)).toEqual([2023, 2024, 2025, 2026]);
    expect(result.skipped[1]!.reason).toContain("no 2023 data");
    expect(formatCarryover(result)).toContain("2024 skipped: no 2023 data");
  });

  test("with 2023, 2024 and 2025 it scores the six candidates against v2, and 2026 is only a row", () => {
    const all = [season(2022), season(2023), season(2024), season(2025, ["BBB", "AAA", "CCC", "DDD"])];
    const result = evaluateCarryover({ all }, 20);
    expect(result.seasons).toEqual([2023, 2024, 2025]);
    expect(result.skipped.map((s) => s.season)).toEqual([2026]);
    expect(result.candidates.length).toBe(carryoverCandidates().length);
    for (const c of result.candidates) {
      expect([...c.bySeason.keys()]).toEqual([2023, 2024, 2025]);
      expect(Number.isFinite(c.trainingEarly.meanDiff)).toBe(true);
      expect(Number.isFinite(c.pooledEarly.se));
    }
    const text = formatCarryover(result);
    expect(text).toContain("Train 23-24");
    expect(text).toContain("2026 is informational");
  });
});
