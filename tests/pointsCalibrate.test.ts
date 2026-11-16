/**
 * Phase 9, Step 4: `bun run calibrate -- --points` (scripts/calibrate.ts). The D53 verdict, the candidate list, the
 * choice from the training seasons alone, and the report, tested with hand-made comparisons and with small synthetic
 * seasons labeled 2022 to 2026.
 */
import { describe, expect, test } from "bun:test";
import { createRng } from "../engine/rng";
import { defaultOddsParams } from "../engine";
import type { SeasonState } from "../engine/types";
import type { CellComparison, ReliabilityBin } from "../scripts/backtest";
import { scoreMethod } from "../scripts/backtest";
import {
  ALL_PLACES,
  MIN_BAND_PAIRS,
  POINTS_MATERIAL_DIFFERENCE,
  RELIABILITY_TOLERANCE,
  affectsWinPodium,
  checkAllPlaces,
  checkPointsAdoption,
  comparePointsCandidate,
  evaluatePoints,
  evaluateSetting,
  formatPoints,
  pointsCandidates,
  selectPointsCandidate,
  type CalibrationSeasons,
  type PointsAdoptionInput,
} from "../scripts/calibrate";
import { makeState } from "./helpers";

// ---------- small synthetic seasons, 2022 to 2026 ----------

const CODES = ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10", "D11", "D12", "D13", "D14"];
const TEAMS14 = Object.fromEntries(Array.from({ length: 7 }, (_, t) => [`team${t + 1}`, [CODES[2 * t]!, CODES[2 * t + 1]!]]));
const STRENGTH: Record<string, number> = Object.fromEntries(CODES.map((c, i) => [c, 3 - i * 0.55]));

function syntheticSeason(seed: number, season: number, rounds = 11): SeasonState {
  const rng = createRng(seed);
  const results: Record<string, { order: string[]; dnf: string[] }> = {};
  for (let r = 1; r <= rounds; r++) {
    const order = CODES.map((d) => ({ d, key: STRENGTH[d]! + rng.gumbel() }))
      .sort((a, b) => b.key - a.key)
      .map((x) => x.d);
    results[`${r}:race`] = { order, dnf: order.filter(() => rng.next() < 0.05) };
  }
  return makeState({ season, rounds, completed: rounds, teams: TEAMS14, results });
}

function seasonsOf(seed = 1): CalibrationSeasons {
  const all = [2022, 2023, 2024, 2025, 2026].map((y, i) => syntheticSeason(seed * 100 + i, y));
  return { training: all.slice(0, 3), validation: all[3]!, confirmation: all[4]!, all };
}

const SIMS = 250;

// ---------- hand-made comparisons for the verdict ----------

const cmp = (meanDiff: number, se: number): CellComparison => ({ meanDiff, se, clear: false });
const seasonsMap = (v: Record<number, [number, number]>) => new Map(Object.entries(v).map(([y, [d, s]]) => [Number(y), cmp(d, s)]));

/** A candidate that passes everything. */
function passing(over: Partial<PointsAdoptionInput> = {}): PointsAdoptionInput {
  return {
    validationComp: cmp(-0.012, 0.004),
    confirmationComp: cmp(0.002, 0.005),
    perSeasonComp: seasonsMap({ 2022: [-0.008, 0.003], 2023: [-0.006, 0.003], 2024: [0.002, 0.003], 2025: [-0.012, 0.004] }),
    earlyComp: seasonsMap({ 2022: [-0.001, 0.004], 2023: [0.002, 0.005], 2024: [0.001, 0.003], 2025: [-0.005, 0.004], 2026: [0.003, 0.005] }),
    winPodiumComp: seasonsMap({ 2022: [0.001, 0.01], 2023: [-0.002, 0.01], 2024: [0.003, 0.01], 2025: [0, 0.01], 2026: [0.004, 0.01] }),
    reliability: bins([[100, 0.55, 0.56], [80, 0.2, 0.22]]),
    ...over,
  };
}

/** Reliability bins as [pairs, forecast mean, happened]. */
function bins(rows: [number, number, number][]): ReliabilityBin[] {
  return rows.map(([n, p, y], i) => ({ from: i / 10, to: (i + 1) / 10, n, meanPredicted: p, observed: y }));
}

describe("the D53 verdict", () => {
  test("the thresholds are the ones written down", () => {
    expect(POINTS_MATERIAL_DIFFERENCE).toBe(0.004);
    expect(RELIABILITY_TOLERANCE).toBe(0.05);
    expect(MIN_BAND_PAIRS).toBeGreaterThan(0);
  });

  test("a candidate that passes every rule is adopted, with no reasons", () => {
    const v = checkPointsAdoption(passing());
    expect(v.adopt).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.historySeasonsImproved).toBe(3);
    expect(v.winPodiumPass).toBe(true);
    expect(v.reliabilityPass).toBe(true);
  });

  test("0.004 per pair is enough on validation; 0.003 is not", () => {
    expect(checkPointsAdoption(passing({ validationComp: cmp(-0.0045, 0.001) })).adopt).toBe(true);
    const v = checkPointsAdoption(passing({ validationComp: cmp(-0.003, 0.001) }));
    expect(v.adopt).toBe(false);
    expect(v.validationMargin).toBe(false);
  });

  test("no when the candidate is the default: zero difference everywhere", () => {
    const zero = cmp(0, 0);
    const v = checkPointsAdoption({
      validationComp: zero,
      confirmationComp: zero,
      perSeasonComp: seasonsMap({ 2022: [0, 0], 2023: [0, 0], 2024: [0, 0], 2025: [0, 0] }),
      earlyComp: seasonsMap({ 2022: [0, 0], 2023: [0, 0], 2024: [0, 0], 2025: [0, 0], 2026: [0, 0] }),
      winPodiumComp: null,
      reliability: bins([[100, 0.5, 0.5]]),
    });
    expect(v.adopt).toBe(false);
    expect(v.validationBeats2SE).toBe(false);
    expect(v.historySeasonsImproved).toBe(0);
  });

  test("no when it wins on training only: validation and history do not follow", () => {
    const v = checkPointsAdoption(
      passing({
        validationComp: cmp(0.001, 0.004),
        perSeasonComp: seasonsMap({ 2022: [-0.02, 0.004], 2023: [-0.02, 0.004], 2024: [-0.02, 0.004], 2025: [0.001, 0.004] }),
      }),
    );
    expect(v.adopt).toBe(false);
    expect(v.validationBeats2SE).toBe(false);
    expect(v.historySeasonsImproved).toBe(3); // the history rule alone would pass; validation is what fails
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  test("no when it improves fewer than 3 of the 4 history seasons", () => {
    const v = checkPointsAdoption(
      passing({ perSeasonComp: seasonsMap({ 2022: [-0.008, 0.003], 2023: [0.006, 0.003], 2024: [0.002, 0.003], 2025: [-0.012, 0.004] }) }),
    );
    expect(v.adopt).toBe(false);
    expect(v.historySeasonsImproved).toBe(2);
  });

  test("no when 2026 is worse by more than one standard error; equal to one is fine", () => {
    expect(checkPointsAdoption(passing({ confirmationComp: cmp(0.0101, 0.01) })).confirmationPass).toBe(false);
    expect(checkPointsAdoption(passing({ confirmationComp: cmp(0.01, 0.01) })).confirmationPass).toBe(true);
  });

  test("no when the early season (rounds 3 to 5) is worse by more than 1 SE in any season", () => {
    const early = seasonsMap({ 2022: [-0.001, 0.004], 2023: [0.002, 0.005], 2024: [0.03, 0.005], 2025: [-0.005, 0.004], 2026: [0.003, 0.005] });
    const v = checkPointsAdoption(passing({ earlyComp: early }));
    expect(v.adopt).toBe(false);
    expect(v.earlyPass).toBe(false);
    expect(v.reasons.join(" ")).toContain("2024");
  });

  test("no when win and podium are worse by more than 1 SE in any season (a candidate that moves them)", () => {
    const wp = seasonsMap({ 2022: [0.001, 0.01], 2023: [-0.002, 0.01], 2024: [0.003, 0.01], 2025: [0.05, 0.01], 2026: [0, 0.01] });
    const v = checkPointsAdoption(passing({ winPodiumComp: wp }));
    expect(v.adopt).toBe(false);
    expect(v.winPodiumPass).toBe(false);
    expect(v.reasons.join(" ")).toContain("2025");
  });

  test("a candidate that cannot move win and podium has no win/podium rule to fail", () => {
    const v = checkPointsAdoption(passing({ winPodiumComp: null }));
    expect(v.winPodiumPass).toBeNull();
    expect(v.adopt).toBe(true);
  });

  test("no when a band of the pooled reliability table is off by more than 5 points", () => {
    const v = checkPointsAdoption(passing({ reliability: bins([[100, 0.55, 0.56], [80, 0.2, 0.28]]) }));
    expect(v.adopt).toBe(false);
    expect(v.reliabilityPass).toBe(false);
  });

  test("a band off by exactly 5 points passes; a thin band is not judged", () => {
    expect(checkPointsAdoption(passing({ reliability: bins([[100, 0.5, 0.55]]) })).reliabilityPass).toBe(true);
    const thin = bins([[100, 0.55, 0.56], [MIN_BAND_PAIRS - 1, 0.2, 0.9]]);
    expect(checkPointsAdoption(passing({ reliability: thin })).reliabilityPass).toBe(true);
    const enough = bins([[100, 0.55, 0.56], [MIN_BAND_PAIRS, 0.2, 0.9]]);
    expect(checkPointsAdoption(passing({ reliability: enough })).reliabilityPass).toBe(false);
  });

  test("an empty band (null numbers) is skipped, never compared", () => {
    const empty: ReliabilityBin[] = [{ from: 0, to: 0.1, n: 0, meanPredicted: null, observed: null }, ...bins([[100, 0.5, 0.5]])];
    expect(checkPointsAdoption(passing({ reliability: empty })).reliabilityPass).toBe(true);
  });
});

// ---------- the candidates ----------

describe("the candidates", () => {
  const list = pointsCandidates();
  const A = list.filter((c) => c.family === "A");
  const B = list.filter((c) => c.family === "B");

  test("the all-places number is named once and is 99", () => {
    expect(ALL_PLACES).toBe(99);
  });

  test("A is paceStages 5, 8, 10, all places with prior 0.5, 1, 3, minus the default itself", () => {
    expect(A).toHaveLength(4 * 3 - 1);
    expect(new Set(A.map((c) => c.params.paceStages))).toEqual(new Set([5, 8, 10, ALL_PLACES]));
    expect(new Set(A.map((c) => c.params.priorStrength))).toEqual(new Set([0.5, 1, 3]));
    expect(A.some((c) => c.params.paceStages === defaultOddsParams.paceStages && c.params.priorStrength === defaultOddsParams.priorStrength)).toBe(false);
    expect(A.every((c) => c.params.finishStages === undefined)).toBe(true);
  });

  test("B is finishStages 8, 10, all places with the same priors, and never touches paceStages", () => {
    expect(B).toHaveLength(3 * 3);
    expect(new Set(B.map((c) => c.params.finishStages))).toEqual(new Set([8, 10, ALL_PLACES]));
    expect(new Set(B.map((c) => c.params.priorStrength))).toEqual(new Set([0.5, 1, 3]));
    expect(B.every((c) => c.params.paceStages === undefined)).toBe(true);
  });

  test("labels are unique, say the family, and name the all-places number the way the report does", () => {
    expect(new Set(list.map((c) => c.label)).size).toBe(list.length);
    expect(list.every((c) => c.label.startsWith(`${c.family} `))).toBe(true);
    expect(list.filter((c) => c.label.includes("all places (99)"))).toHaveLength(3 + 3);
  });

  test("only a candidate that can move win and podium faces the win/podium rule", () => {
    const b1 = B.find((c) => c.params.finishStages === 8 && c.params.priorStrength === defaultOddsParams.priorStrength)!;
    expect(affectsWinPodium(b1.params)).toBe(false);
    expect(affectsWinPodium({ finishStages: 8, priorStrength: 0.5 })).toBe(true);
    expect(affectsWinPodium({ paceStages: 8 })).toBe(true);
    expect(affectsWinPodium({ priorStrength: 3 })).toBe(true);
    expect(affectsWinPodium({ paceStages: defaultOddsParams.paceStages })).toBe(false);
    expect(affectsWinPodium({})).toBe(false);
  });
});

describe("the all-places number is safe", () => {
  test("a field larger than the number is refused; 14 and 22 are fine", () => {
    const seasons = seasonsOf();
    expect(() => checkAllPlaces(seasons, 99)).not.toThrow();
    expect(() => checkAllPlaces(seasons, 10)).toThrow(RangeError);
    expect(() => checkAllPlaces(seasons, 14)).not.toThrow();
  });
});

// ---------- choosing ----------

describe("selectPointsCandidate: from the training seasons alone", () => {
  test("the lowest pooled training difference wins, if it is below zero", () => {
    expect(selectPointsCandidate(new Map([["a", -0.01], ["b", -0.03], ["c", 0.02]]))).toBe("b");
  });

  test("none when nothing beats the default; a tie goes to the one listed first", () => {
    expect(selectPointsCandidate(new Map([["a", 0], ["b", 0.01]]))).toBeNull();
    expect(selectPointsCandidate(new Map([["a", -0.02], ["b", -0.02]]))).toBe("a");
  });
});

// ---------- the pipeline on small seasons ----------

describe("a candidate against the default, season by season", () => {
  const seasons = seasonsOf();
  const baseline = evaluateSetting(seasons, {}, "current defaults", SIMS);

  test("the default against itself has no difference and is not adopted", () => {
    const c = comparePointsCandidate(baseline, baseline, {});
    expect(c.validationComp.meanDiff).toBe(0);
    expect(c.trainingComp.meanDiff).toBe(0);
    expect(c.confirmationComp.meanDiff).toBe(0);
    expect(c.verdict.adopt).toBe(false);
  });

  test("a finishStages candidate at the default prior leaves win and podium exactly as they were", () => {
    const params = { finishStages: 8 };
    const cand = evaluateSetting(seasons, params, "B finishStages=8", SIMS);
    for (const y of [2022, 2023, 2024, 2025, 2026]) {
      const a = scoreMethod(cand.bySeason.get(y)!.mainRecords, "model");
      const b = scoreMethod(baseline.bySeason.get(y)!.mainRecords, "model");
      expect(a.winLogLoss).toBe(b.winLogLoss);
      expect(a.podiumLogLoss).toBe(b.podiumLogLoss);
      expect(a.pointsBrier).not.toBe(b.pointsBrier);
    }
    const c = comparePointsCandidate(cand, baseline, params);
    expect(c.winPodiumComp).toBeNull();
    expect(c.verdict.winPodiumPass).toBeNull();
  });

  test("a candidate that changes paceStages carries the win/podium comparison for all five seasons", () => {
    const params = { paceStages: 8 };
    const cand = evaluateSetting(seasons, params, "A paceStages=8", SIMS);
    const c = comparePointsCandidate(cand, baseline, params);
    expect(c.winPodiumComp).not.toBeNull();
    expect([...c.winPodiumComp!.keys()].sort()).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect([...c.perSeasonComp.keys()].sort()).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect([...c.earlyComp.keys()].sort()).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(c.finishMae.validation).toBeDefined();
  });
});

describe("evaluatePoints and its report", () => {
  const seasons = seasonsOf(2);
  const result = evaluatePoints(seasons, SIMS);
  const text = formatPoints(result);

  test("every candidate gets a comparison and a verdict, A and B", () => {
    expect(result.candidates).toHaveLength(pointsCandidates().length);
    expect(result.candidates.every((c) => typeof c.comparison.verdict.adopt === "boolean")).toBe(true);
  });

  test("the choice is made on the training seasons alone: a different 2026 changes no selection", () => {
    const other = seasonsOf(2);
    const swapped = syntheticSeason(99999, 2026);
    const changed: CalibrationSeasons = { ...other, confirmation: swapped, all: [...other.all.slice(0, 4), swapped] };
    const r2 = evaluatePoints(changed, SIMS);
    expect(r2.selected.A?.label ?? null).toBe(result.selected.A?.label ?? null);
    expect(r2.selected.B?.label ?? null).toBe(result.selected.B?.label ?? null);
  });

  test("the selection in each family is the lowest training difference in it, or none", () => {
    for (const family of ["A", "B"] as const) {
      const inFamily = result.candidates.filter((c) => c.candidate.family === family);
      const best = inFamily.reduce((m, c) => (c.comparison.trainingComp.meanDiff < m.comparison.trainingComp.meanDiff ? c : m));
      const chosen = result.selected[family];
      if (best.comparison.trainingComp.meanDiff < 0) expect(chosen?.label).toBe(best.candidate.label);
      else expect(chosen).toBeNull();
    }
  });

  test("the report prints the default, every candidate, the reliability tables, and 2026 last", () => {
    expect(text).toContain("current defaults");
    for (const c of result.candidates) expect(text).toContain(c.candidate.label);
    expect(text).toContain("Reliability");
    expect(text).toContain("all places (99)");
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    const conf = text.indexOf("Confirmation (2026, printed last)");
    expect(conf).toBeGreaterThan(text.indexOf("Validation"));
    expect(conf).toBeGreaterThan(text.lastIndexOf("Reliability"));
    expect(text.slice(conf)).toContain("Verdict");
  });

  test("the report ends with a plain verdict, and says which family it prefers when both pass", () => {
    const last = text.trim().split("\n").at(-1)!;
    expect(last).toMatch(/^(Verdict|Recommendation)/);
    expect(text).toContain("D52");
  });
});
