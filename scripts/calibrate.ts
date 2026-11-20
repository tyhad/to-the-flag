/**
 * Usage: bun scripts/calibrate.ts [--sims N] [--history <dir>] [--live <path>] [--grid-signal] [--points] [--carryover]
 *
 * `--grid-signal` runs only the Step 7 section (the grid term); `--qualifying-noise` only the Step 8 estimate of the
 * qualifying noise; `--points` only the Phase 9 section (the points chance and the expected finish, protocol D53);
 * `--carryover` only the Phase 11 section (the multi-season prior, protocol D64). Without a flag, Step 6 (the settings
 * grid) runs first, then Step 7, then Step 8.
 *
 * Evaluation harness for Model calibration across multiple seasons (Phase 4, Step 4).
 * Evaluates candidate settings against current defaults under protocol D30:
 * - Tune on 2022 to 2024 (training).
 * - Validate on 2025 (validation).
 * - Confirm once on 2026 (confirmation, labeled and printed last).
 * - Adoption rule:
 *   1. Validation season (2025) beats default by > 2 SE AND >= 0.005 per race.
 *   2. Improves at least 3 of the 4 history seasons (2022-2025).
 *   3. Not worse than 1 SE on 2026 confirmation.
 *   4. Not worse than 1 SE on early season (rounds 3 to 5) for every season.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSeasons, type SkippedSeason } from "../data/loadHistory";
import { loadSeason } from "../data/loadSeason";
import { defaultOddsParams, fitStrengths, type OddsParams, type SeasonState } from "../engine";
import {
  compareCells,
  compareLosses,
  earlyWindow,
  MATERIAL_DIFFERENCE,
  POINTS_EDGES,
  gridOf,
  outcomeOf,
  pairsOf,
  raceFinishMae,
  raceLosses,
  racePointsBrier,
  reliability,
  scoreMethod,
  stateBefore,
  walkForward,
  type CellComparison,
  type RaceRecord,
  type ReliabilityBin,
  type Scores,
} from "./backtest";

export const CALIBRATE_SIMS = 2000;
export const HISTORY_SEASONS = [2022, 2023, 2024, 2025] as const;

export interface CalibrationSeasons {
  /** Seasons 2022, 2023, 2024 */
  training: SeasonState[];
  /** Season 2025 */
  validation: SeasonState;
  /** Season 2026 (confirmation only) */
  confirmation: SeasonState;
  /** All seasons in order: 2022, 2023, 2024, 2025, 2026 */
  all: SeasonState[];
}

export function loadCalibrationSeasons(
  historyDir = join(import.meta.dir, "..", "..", "F1GStats", "history"),
  livePath = join(import.meta.dir, "..", "tests", "fixtures", "season-2026-r16.json"),
): CalibrationSeasons {
  const { loaded, skipped } = loadSeasons(historyDir, HISTORY_SEASONS);
  if (skipped.length > 0) {
    const reasons = skipped.map((s) => `${s.season} (${s.reason})`).join(", ");
    throw new Error(`Failed to load history seasons: ${reasons}. Run Step 1 fetch first.`);
  }

  const bySeason = new Map(loaded.map((s) => [s.season, s]));
  const s2022 = bySeason.get(2022)!;
  const s2023 = bySeason.get(2023)!;
  const s2024 = bySeason.get(2024)!;
  const s2025 = bySeason.get(2025)!;

  let s2026: SeasonState;
  if (existsSync(livePath)) {
    if (livePath.endsWith(".json")) {
      s2026 = JSON.parse(readFileSync(livePath, "utf8")) as SeasonState;
    } else {
      s2026 = loadSeason(livePath);
    }
  } else {
    throw new Error(`2026 data file not found at ${livePath}`);
  }

  return {
    training: [s2022, s2023, s2024],
    validation: s2025,
    confirmation: s2026,
    all: [s2022, s2023, s2024, s2025, s2026],
  };
}

export interface SeasonForecasts {
  season: number;
  mainRecords: RaceRecord[];
  earlyRecords: RaceRecord[];
  mainScores: Scores;
  earlyScores: Scores;
}

export interface SettingEval {
  label: string;
  params: Partial<OddsParams>;
  bySeason: Map<number, SeasonForecasts>;
  trainingRecords: RaceRecord[];
  trainingScores: Scores;
  validationRecords: RaceRecord[];
  validationScores: Scores;
  confirmationRecords: RaceRecord[];
  confirmationScores: Scores;
  earlyRecords: RaceRecord[];
  earlyScores: Scores;
}

export function evaluateSetting(
  seasons: CalibrationSeasons,
  params: Partial<OddsParams>,
  label: string,
  nSims = CALIBRATE_SIMS,
): SettingEval {
  const bySeason = new Map<number, SeasonForecasts>();
  const trainingRecords: RaceRecord[] = [];
  const earlyRecords: RaceRecord[] = [];

  for (const s of seasons.all) {
    const mainRecords = walkForward(s, { ...params, nSims }, 6);
    const early = walkForward(s, { ...params, nSims }, 3).filter((r) => r.round <= 5);

    const mainScores = scoreMethod(mainRecords, "model");
    const earlyScores = scoreMethod(early, "model");

    bySeason.set(s.season, {
      season: s.season,
      mainRecords,
      earlyRecords: early,
      mainScores,
      earlyScores,
    });

    if (s.season <= 2024) {
      trainingRecords.push(...mainRecords);
    }
    earlyRecords.push(...early);
  }

  const validationRecords = bySeason.get(2025)!.mainRecords;
  const confirmationRecords = bySeason.get(2026)!.mainRecords;

  return {
    label,
    params,
    bySeason,
    trainingRecords,
    trainingScores: scoreMethod(trainingRecords, "model"),
    validationRecords,
    validationScores: scoreMethod(validationRecords, "model"),
    confirmationRecords,
    confirmationScores: scoreMethod(confirmationRecords, "model"),
    earlyRecords,
    earlyScores: scoreMethod(earlyRecords, "model"),
  };
}

export interface AdoptionVerdict {
  adopt: boolean;
  validationBeats2SE: boolean;
  validationMargin: boolean;
  historySeasonsImproved: number;
  historySeasonsCount: number;
  confirmationPass: boolean;
  earlyPass: boolean;
  reasons: string[];
}

export function checkAdoption(
  comparison: {
    validationComp: CellComparison;
    confirmationComp: CellComparison;
    perSeasonComp: Map<number, CellComparison>;
    earlyComp: Map<number, CellComparison>;
  },
  historyYears: readonly number[] = [2022, 2023, 2024, 2025],
): AdoptionVerdict {
  const reasons: string[] = [];

  // 1. Validation season (2025):
  // Must beat default by > 2 standard errors (meanDiff < -2 * se) AND at least MATERIAL_DIFFERENCE (0.005)
  const val = comparison.validationComp;
  const validationBeats2SE = val.meanDiff < -2 * val.se;
  const validationMargin = val.meanDiff <= -MATERIAL_DIFFERENCE;
  if (!validationBeats2SE) {
    reasons.push(
      `Validation diff ${val.meanDiff.toFixed(4)} does not beat default by > 2 SE (${(-2 * val.se).toFixed(4)})`,
    );
  }
  if (!validationMargin) {
    reasons.push(`Validation diff ${val.meanDiff.toFixed(4)} is less than threshold -${MATERIAL_DIFFERENCE}`);
  }

  // 2. Improves at least 3 of the 4 history seasons
  let historySeasonsImproved = 0;
  for (const year of historyYears) {
    const comp = comparison.perSeasonComp.get(year);
    if (comp && comp.meanDiff < 0) {
      historySeasonsImproved++;
    }
  }
  const historySeasonsPass = historySeasonsImproved >= 3;
  if (!historySeasonsPass) {
    reasons.push(`Improves only ${historySeasonsImproved} of ${historyYears.length} history seasons (needs >= 3)`);
  }

  // 3. Not worse than 1 standard error on 2026 confirmation
  const conf = comparison.confirmationComp;
  const confirmationPass = conf.meanDiff <= conf.se;
  if (!confirmationPass) {
    reasons.push(`Worse by > 1 SE on 2026 confirmation (diff ${conf.meanDiff.toFixed(4)} > se ${conf.se.toFixed(4)})`);
  }

  // 4. Not worse than 1 standard error on rounds 3 to 5 of every season
  let earlyPass = true;
  for (const [year, comp] of comparison.earlyComp.entries()) {
    if (comp.meanDiff > comp.se) {
      earlyPass = false;
      reasons.push(`Early season on ${year} worse by > 1 SE (diff ${comp.meanDiff.toFixed(4)} > se ${comp.se.toFixed(4)})`);
    }
  }

  const adopt = validationBeats2SE && validationMargin && historySeasonsPass && confirmationPass && earlyPass;
  return {
    adopt,
    validationBeats2SE,
    validationMargin,
    historySeasonsImproved,
    historySeasonsCount: historyYears.length,
    confirmationPass,
    earlyPass,
    reasons,
  };
}

export interface CandidateComparison {
  eval: SettingEval;
  trainingComp: CellComparison;
  validationComp: CellComparison;
  confirmationComp: CellComparison;
  perSeasonComp: Map<number, CellComparison>;
  earlyComp: Map<number, CellComparison>;
  verdict: AdoptionVerdict;
}

export function compareCandidate(candidate: SettingEval, baseline: SettingEval): CandidateComparison {
  const trainingComp = compareCells(candidate.trainingRecords, baseline.trainingRecords);
  const validationComp = compareCells(candidate.validationRecords, baseline.validationRecords);
  const confirmationComp = compareCells(candidate.confirmationRecords, baseline.confirmationRecords);

  const perSeasonComp = new Map<number, CellComparison>();
  const earlyComp = new Map<number, CellComparison>();

  for (const [year, candForecast] of candidate.bySeason.entries()) {
    const baseForecast = baseline.bySeason.get(year)!;
    perSeasonComp.set(year, compareCells(candForecast.mainRecords, baseForecast.mainRecords));
    earlyComp.set(year, compareCells(candForecast.earlyRecords, baseForecast.earlyRecords));
  }

  const verdict = checkAdoption({
    validationComp,
    confirmationComp,
    perSeasonComp,
    earlyComp,
  });

  return {
    eval: candidate,
    trainingComp,
    validationComp,
    confirmationComp,
    perSeasonComp,
    earlyComp,
    verdict,
  };
}

/** No grid at all: Step 6 judges pace settings without the grid term, whatever the current defaults are. */
export const NO_GRID: Partial<OddsParams> = { gridWeight: 0, qualifyingNoise: 0 };
/** The v1 behavior, spelled out: Step 6 compares candidate settings against this, whatever the current defaults are. */
export const V1_PARAMS: Partial<OddsParams> = { recencyHalfLife: Number.POSITIVE_INFINITY, priorStrength: 3, paceStages: 0, ...NO_GRID };

// ---------- Step 7: the grid signal ----------

/** Weights of the grid term tried; 0 means "ignore the grid" and is the baseline (the v2 model). */
export const GRID_WEIGHTS = [0, 0.25, 0.5, 0.75, 1] as const;

/**
 * Picks the grid weight from the TRAINING seasons only: the one with the lowest pooled loss relative to ignoring
 * the grid. `trainingDiffs` maps each weight above 0 to (candidate loss - baseline loss) per race, so negative is
 * better. If no weight beats the baseline, the answer is 0 (ignore the grid). A tie goes to the smaller weight.
 */
export function selectGridWeight(trainingDiffs: ReadonlyMap<number, number>): number {
  let best = 0;
  let bestDiff = 0;
  for (const weight of [...trainingDiffs.keys()].sort((a, b) => a - b)) {
    const diff = trainingDiffs.get(weight)!;
    if (diff < bestDiff) {
      best = weight;
      bestDiff = diff;
    }
  }
  return best;
}

export interface GridSignalResult {
  /** the v2 model: the current defaults with `gridWeight` 0 */
  baseline: SettingEval;
  /** every weight above 0, compared with the baseline */
  candidates: { weight: number; comparison: CandidateComparison }[];
  /** the weight chosen on the training seasons; 0 means no weight beat ignoring the grid */
  selected: number;
  /** the D30 verdict for the selected weight; null when `selected` is 0 */
  verdict: AdoptionVerdict | null;
}

/**
 * Step 7 of the protocol. Every weight is scored on all seasons with the actual grid of each past race, but the
 * choice is made from the training seasons alone; validation, history and 2026 only judge that one choice.
 */
export function evaluateGridSignal(
  seasons: CalibrationSeasons,
  nSims = CALIBRATE_SIMS,
  weights: readonly number[] = GRID_WEIGHTS,
): GridSignalResult {
  const baseline = evaluateSetting(seasons, { gridWeight: 0 }, "gridWeight=0 (v2)", nSims);
  const candidates = weights
    .filter((w) => w > 0)
    .map((weight) => ({
      weight,
      comparison: compareCandidate(evaluateSetting(seasons, { gridWeight: weight }, `gridWeight=${weight}`, nSims), baseline),
    }));
  const selected = selectGridWeight(new Map(candidates.map((c) => [c.weight, c.comparison.trainingComp.meanDiff])));
  const chosen = candidates.find((c) => c.weight === selected);
  return { baseline, candidates, selected, verdict: chosen ? chosen.comparison.verdict : null };
}

// ---------- Step 8: how noisy is qualifying? ----------

/** Qualifying noise sizes tried (the Gumbel scale of the simulated qualifying, next to the race's scale of 1). */
export const QUALIFYING_NOISES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;
/** Strengths need at least two races behind them, as in the early-season check. */
export const FIRST_GRID_ROUND = 3;

/**
 * Log probability of a grid under the simulated qualifying: key = strength + noise * Gumbel, best key on pole. That is
 * a Plackett-Luce order with strengths divided by the noise: the sum over places of
 * `s/noise - ln(sum of exp(s/noise) over the drivers still unplaced)`. `strengthsPoleFirst` is in grid order.
 */
export function gridLogLikelihood(strengthsPoleFirst: readonly number[], noise: number): number {
  const scaled = strengthsPoleFirst.map((s) => s / noise);
  let total = 0;
  for (let k = 0; k < scaled.length; k++) {
    const max = Math.max(...scaled.slice(k));
    let rest = 0;
    for (let j = k; j < scaled.length; j++) rest += Math.exp(scaled[j]! - max);
    total += scaled[k]! - (max + Math.log(rest));
  }
  return total;
}

/** For each race from round 3 on: the strengths (fitted before that round) of the drivers, in the order they started. */
function gridStrengths(season: SeasonState): number[][] {
  const out: number[][] = [];
  for (let round = FIRST_GRID_ROUND; round <= season.asOfRound; round++) {
    const grid = gridOf(season, round);
    const drivers = Object.keys(grid).sort((a, b) => grid[a]! - grid[b]!);
    if (drivers.length < 2) continue;
    const { theta } = fitStrengths(stateBefore(season, round));
    out.push(drivers.map((d) => theta[d] ?? 0));
  }
  return out;
}

export interface LikelihoodCell {
  /** mean log likelihood of one grid */
  mean: number;
  /** standard error of that mean across grids */
  se: number;
  /** grids counted */
  n: number;
}

function cell(values: readonly number[]): LikelihoodCell {
  const n = values.length;
  if (n === 0) return { mean: Number.NaN, se: Number.NaN, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, se: Math.sqrt(variance / n), n };
}

export interface QualifyingNoiseFit {
  byNoise: { noise: number; training: LikelihoodCell; validation: LikelihoodCell; confirmation: LikelihoodCell }[];
  /** the noise with the highest mean log likelihood on the training seasons; a tie goes to the smaller noise */
  selected: number;
}

/** Estimates `qualifyingNoise` from the real grids. The choice uses the training seasons only. */
export function fitQualifyingNoise(seasons: CalibrationSeasons, noises: readonly number[] = QUALIFYING_NOISES): QualifyingNoiseFit {
  const train = seasons.training.flatMap(gridStrengths);
  const valid = gridStrengths(seasons.validation);
  const conf = gridStrengths(seasons.confirmation);
  const byNoise = [...noises]
    .sort((a, b) => a - b)
    .map((noise) => ({
      noise,
      training: cell(train.map((g) => gridLogLikelihood(g, noise))),
      validation: cell(valid.map((g) => gridLogLikelihood(g, noise))),
      confirmation: cell(conf.map((g) => gridLogLikelihood(g, noise))),
    }));
  let selected = byNoise[0]!.noise;
  let best = byNoise[0]!.training.mean;
  for (const row of byNoise) {
    if (row.training.mean > best) {
      best = row.training.mean;
      selected = row.noise;
    }
  }
  return { byNoise, selected };
}

// ---------- Phase 11, Step 2: the multi-season prior (protocol D64) ----------

/** D64 rule 1: the least improvement on 2025, per race, for the early window. */
export const CARRYOVER_MATERIAL_DIFFERENCE = 0.005;
/** The seasons that are evaluated; each needs the season before it (D65: the history folder). */
export const CARRYOVER_SEASONS = [2023, 2024, 2025, 2026] as const;
/** D64: the tuning seasons, which choose the candidate. */
export const CARRYOVER_TRAINING_SEASONS = [2023, 2024] as const;
/** D64: the validation season. */
export const CARRYOVER_VALIDATION_SEASON = 2025;
/** D62: the carryover sizes, crossed with the team rule. */
export const CARRYOVERS = [0.25, 0.5, 1] as const;

export interface CarryoverCandidate {
  carryover: number;
  sameTeamOnly: boolean;
  label: string;
}

/** D62: the six candidates against v2. */
export function carryoverCandidates(): CarryoverCandidate[] {
  return CARRYOVERS.flatMap((carryover) =>
    [false, true].map((sameTeamOnly) => ({
      carryover,
      sameTeamOnly,
      label: `${carryover}, ${sameTeamOnly ? "same team only" : "all teams"}`,
    })),
  );
}

export interface CarryoverVerdict {
  adopt: boolean;
  validationPass: boolean;
  pooledPass: boolean;
  seasonsImproved: number;
  seasonsCount: number;
  wholeSeasonPass: boolean;
  reasons: string[];
}

export interface CarryoverAdoptionInput {
  /** rounds 1-5 of 2025, candidate minus v2 */
  validationEarly: CellComparison;
  /** rounds 1-5 of 2023-2025, pooled, candidate minus v2 */
  pooledEarly: CellComparison;
  /** rounds 1-5 of 2023, 2024 and 2025 */
  perSeasonEarly: ReadonlyMap<number, CellComparison>;
  /** the whole seasons 2023, 2024 and 2025 */
  perSeasonWhole: ReadonlyMap<number, CellComparison>;
}

/**
 * D64, on the per-race win + podium log loss (a candidate must pass all of them):
 *  1. 2025, rounds 1-5: better than v2 by more than 1 SE and by at least `CARRYOVER_MATERIAL_DIFFERENCE`.
 *  2. The pooled rounds 1-5 of 2023-2025: better by more than 2 SE.
 *  3. At least 2 of the 3 seasons improve on rounds 1-5.
 *  4. The whole season is not worse by more than 1 SE in any of the 3 seasons.
 *  5. (Which candidate is judged is D64 rule 5: the best on 2023-2024, see `selectCarryover`.)
 * 2026 is never part of the verdict; it is reported for information.
 */
export function checkCarryoverAdoption(input: CarryoverAdoptionInput): CarryoverVerdict {
  const reasons: string[] = [];
  const val = input.validationEarly;
  const validationBeats1SE = val.meanDiff < -val.se;
  const validationMargin = val.meanDiff <= -CARRYOVER_MATERIAL_DIFFERENCE;
  if (!validationBeats1SE) reasons.push(`2025 rounds 1-5 diff ${val.meanDiff.toFixed(4)} does not beat v2 by > 1 SE (${(-val.se).toFixed(4)})`);
  if (!validationMargin) reasons.push(`2025 rounds 1-5 diff ${val.meanDiff.toFixed(4)} is less than the threshold -${CARRYOVER_MATERIAL_DIFFERENCE}`);

  const pooled = input.pooledEarly;
  const pooledPass = pooled.meanDiff < -2 * pooled.se;
  if (!pooledPass) reasons.push(`Pooled 2023-2025 rounds 1-5 diff ${pooled.meanDiff.toFixed(4)} does not beat v2 by > 2 SE (${(-2 * pooled.se).toFixed(4)})`);

  let seasonsImproved = 0;
  for (const comp of input.perSeasonEarly.values()) if (comp.meanDiff < 0) seasonsImproved++;
  const seasonsCount = input.perSeasonEarly.size;
  if (seasonsImproved < 2) reasons.push(`Improves only ${seasonsImproved} of ${seasonsCount} seasons on rounds 1-5 (needs >= 2)`);

  let wholeSeasonPass = true;
  for (const [year, comp] of input.perSeasonWhole) {
    if (comp.meanDiff > comp.se) {
      wholeSeasonPass = false;
      reasons.push(`Whole season ${year} worse by > 1 SE (diff ${comp.meanDiff.toFixed(4)} > SE ${comp.se.toFixed(4)})`);
    }
  }

  const adopt = validationBeats1SE && validationMargin && pooledPass && seasonsImproved >= 2 && wholeSeasonPass;
  return {
    adopt,
    validationPass: validationBeats1SE && validationMargin,
    pooledPass,
    seasonsImproved,
    seasonsCount,
    wholeSeasonPass,
    reasons,
  };
}

export interface CarryoverSeasonRecords {
  season: number;
  /** rounds 1-5 */
  early: RaceRecord[];
  whole: RaceRecord[];
}

export interface CarryoverCandidateResult {
  candidate: CarryoverCandidate;
  /** per season (2023-2026): rounds 1-5 and the whole season, candidate minus v2 */
  bySeason: Map<number, { early: CellComparison; whole: CellComparison }>;
  /** the pooled rounds 1-5 of the tuning seasons (2023-2024), which choose the candidate */
  trainingEarly: CellComparison;
  /** the pooled rounds 1-5 of 2023-2025 */
  pooledEarly: CellComparison;
  verdict: CarryoverVerdict;
}

export interface CarryoverResult {
  candidates: CarryoverCandidateResult[];
  /** the candidate with the lowest pooled rounds 1-5 loss on 2023-2024, or null when none beats v2 there */
  selected: CarryoverCandidateResult | null;
  /** the seasons that were compared */
  seasons: number[];
  skipped: SkippedSeason[];
}

/** D64 rule 5: the best on the tuning seasons only; a tie goes to the earlier candidate (the smaller carryover). */
export function selectCarryover(candidates: readonly CarryoverCandidateResult[]): CarryoverCandidateResult | null {
  let best: CarryoverCandidateResult | null = null;
  for (const c of candidates) {
    if (c.trainingEarly.meanDiff >= 0) continue;
    if (best === null || c.trainingEarly.meanDiff < best.trainingEarly.meanDiff) best = c;
  }
  return best;
}

/**
 * Every candidate is scored on 2023 to 2026 (each with its previous season attached), but the choice is made from
 * 2023-2024 alone; 2025 judges it and 2026 is informational. A season without its previous season is skipped with a
 * reason, never a crash.
 */
export function evaluateCarryover(seasons: { all: SeasonState[] }, nSims = CALIBRATE_SIMS): CarryoverResult {
  const bySeason = new Map(seasons.all.map((s) => [s.season, s]));
  const skipped: SkippedSeason[] = [];
  const evaluated: { season: number; state: SeasonState }[] = [];
  for (const year of CARRYOVER_SEASONS) {
    const state = bySeason.get(year);
    const previous = bySeason.get(year - 1);
    if (!state) skipped.push({ season: year, reason: "not loaded" });
    else if (!previous) skipped.push({ season: year, reason: `no ${year - 1} data, so there is nothing to carry` });
    else evaluated.push({ season: year, state: { ...state, prior: previous } });
  }

  const records = (params: Partial<OddsParams>) => {
    const out = new Map<number, CarryoverSeasonRecords>();
    for (const { season, state } of evaluated) {
      const whole = walkForward(state, { ...params, nSims }, 1);
      out.set(season, { season, early: earlyWindow(whole), whole });
    }
    return out;
  };
  const diff = (cand: readonly RaceRecord[], base: readonly RaceRecord[]) =>
    compareLosses(raceLosses(cand, "model"), raceLosses(base, "model"));

  // D64 needs 2023, 2024 and 2025; 2026 only adds a row.
  const complete = CARRYOVER_TRAINING_SEASONS.every((y) => evaluated.some((e) => e.season === y)) &&
    evaluated.some((e) => e.season === CARRYOVER_VALIDATION_SEASON);
  const candidates: CarryoverCandidateResult[] = [];
  if (complete) {
    const baseline = records({ priorCarryover: 0 });
    for (const candidate of carryoverCandidates()) {
      const cand = records({ priorCarryover: candidate.carryover, priorSameTeamOnly: candidate.sameTeamOnly });
      const bySeason = new Map<number, { early: CellComparison; whole: CellComparison }>();
      for (const { season } of evaluated) {
        bySeason.set(season, {
          early: diff(cand.get(season)!.early, baseline.get(season)!.early),
          whole: diff(cand.get(season)!.whole, baseline.get(season)!.whole),
        });
      }
      const pooled = (which: "early" | "whole", years: readonly number[]) =>
        diff(
          years.flatMap((y) => cand.get(y)![which]),
          years.flatMap((y) => baseline.get(y)![which]),
        );
      const judged = [...bySeason].filter(([year]) => year !== 2026);
      const trainingEarly = pooled("early", CARRYOVER_TRAINING_SEASONS);
      const pooledEarly = pooled("early", [...CARRYOVER_TRAINING_SEASONS, CARRYOVER_VALIDATION_SEASON]);
      candidates.push({
        candidate,
        bySeason,
        trainingEarly,
        pooledEarly,
        verdict: checkCarryoverAdoption({
          validationEarly: bySeason.get(CARRYOVER_VALIDATION_SEASON)!.early,
          pooledEarly,
          perSeasonEarly: new Map(judged.map(([year, c]) => [year, c.early])),
          perSeasonWhole: new Map(judged.map(([year, c]) => [year, c.whole])),
        }),
      });
    }
  }

  return { candidates, selected: selectCarryover(candidates), seasons: evaluated.map((e) => e.season), skipped };
}

export function formatCarryover(result: CarryoverResult): string {
  const lines: string[] = [];
  lines.push("=== Multi-season prior (Phase 11, protocol D64) ===");
  lines.push("Baseline: v2, with the previous season attached and priorCarryover 0 (the fit is exactly today's).");
  lines.push("Differences are per race (win + podium log loss), candidate minus v2, negative = better. The early window is");
  lines.push("rounds 1-5. 2026 is informational only: it started after a regulation reset, so the carryover should be 0 there (D63).");
  lines.push("");
  for (const s of result.skipped) lines.push(`  ${s.season} skipped: ${s.reason}`);
  if (result.skipped.length > 0) lines.push("");

  if (result.candidates.length === 0) {
    lines.push("Nothing to evaluate: D64 needs 2023, 2024 and 2025, each with the season before it in the history folder.");
    return lines.join("\n");
  }

  const years = result.seasons;
  lines.push("--- Rounds 1-5 (the early season) ---");
  lines.push(
    ...table([
      ["carryover", "teams", ...years.map(String), "Train 23-24", "Pooled 23-25"],
      ...result.candidates.map((c) => [
        String(c.candidate.carryover),
        c.candidate.sameTeamOnly ? "same team" : "all",
        ...years.map((y) => formatDiff(c.bySeason.get(y)!.early, 4)),
        formatDiff(c.trainingEarly, 4),
        formatDiff(c.pooledEarly, 4),
      ]),
    ]),
  );
  lines.push("");

  lines.push("--- Whole season (rule 4: not worse than 1 SE in any of 2023-2025) ---");
  lines.push(
    ...table([
      ["carryover", "teams", ...years.map(String)],
      ...result.candidates.map((c) => [
        String(c.candidate.carryover),
        c.candidate.sameTeamOnly ? "same team" : "all",
        ...years.map((y) => formatDiff(c.bySeason.get(y)!.whole, 4)),
      ]),
    ]),
  );
  lines.push("");

  lines.push("--- Chosen on the tuning seasons (2023-2024 only) ---");
  const chosen = result.selected;
  if (chosen === null) {
    lines.push("  none: no candidate beats v2 on the tuning seasons.");
    lines.push("Verdict: carryover NOT adopted; v2 stays, and Steps 4 and 5 are skipped.");
    return lines.join("\n");
  }
  lines.push(`  priorCarryover ${chosen.candidate.carryover}, ${chosen.candidate.sameTeamOnly ? "same team only" : "all teams"}`);
  lines.push("");
  if (chosen.verdict.adopt) {
    lines.push(
      `Verdict: ADOPTED (passes D64): 2025 rounds 1-5 ${formatDiff(chosen.bySeason.get(CARRYOVER_VALIDATION_SEASON)!.early, 4)}, ` +
        `pooled ${formatDiff(chosen.pooledEarly, 4)}, ${chosen.verdict.seasonsImproved} of ${chosen.verdict.seasonsCount} seasons better.`,
    );
  } else {
    lines.push("Verdict: NOT adopted. Reasons:");
    for (const reason of chosen.verdict.reasons) lines.push(`  - ${reason}`);
    lines.push("");
    lines.push("v2 stays; the carryover is recorded as rejected in docs/MODEL.md, and Steps 4 and 5 are skipped.");
  }
  return lines.join("\n");
}

/** Phase 11, Step 2. */
export function printCarryover(seasons: CalibrationSeasons, nSims: number): void {
  console.log(formatCarryover(evaluateCarryover(seasons, nSims)));
}

// ---------- Formatting & CLI ----------

const fmt = (x: number, digits = 3) => x.toFixed(digits);

function formatDiff(c: CellComparison, digits = 3): string {
  const sign = c.meanDiff > 0 ? "+" : "";
  return `${sign}${c.meanDiff.toFixed(digits)} (±${c.se.toFixed(digits)})`;
}

function table(rows: string[][], rightFrom = 1): string[] {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows.map((r) => "  " + r.map((cell, c) => (c < rightFrom ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join("  "));
}

export function runCalibrationCli(args: string[] = []): void {
  const simsArg = args.find((a, i) => args[i - 1] === "--sims");
  const nSims = simsArg ? Number(simsArg) : CALIBRATE_SIMS;

  const historyArg = args.find((a, i) => args[i - 1] === "--history");
  const liveArg = args.find((a, i) => args[i - 1] === "--live");

  console.log(`Loading calibration data (seasons 2022-2025 history + 2026 live)...`);
  const seasons = loadCalibrationSeasons(historyArg, liveArg);

  console.log(`Running evaluation with ${nSims} simulations per forecast...\n`);

  if (args.includes("--grid-signal")) {
    printGridSignal(seasons, nSims);
    return;
  }
  if (args.includes("--qualifying-noise")) {
    printQualifyingNoise(seasons);
    return;
  }
  if (args.includes("--points")) {
    printPoints(seasons, nSims);
    return;
  }
  if (args.includes("--carryover")) {
    printCarryover(seasons, nSims);
    return;
  }

  // Step 6 compares against v1, spelled out: the current defaults are v2, so `{}` would compare v2 with itself
  const defaultEval = evaluateSetting(seasons, V1_PARAMS, "v1 defaults", nSims);

  // Print Baselines Report
  console.log("=== Season Loss Summary (v1 defaults, win + podium log loss) ===");
  const seasonRows: string[][] = [
    ["Season", "Role", "Races", "Win Loss", "Podium Loss", "Total Loss"],
  ];
  for (const year of [2022, 2023, 2024, 2025, 2026]) {
    const s = defaultEval.bySeason.get(year)!;
    const role = year <= 2024 ? "Train" : year === 2025 ? "Valid" : "Confirm";
    seasonRows.push([
      String(year),
      role,
      String(s.mainScores.races),
      fmt(s.mainScores.winLogLoss),
      fmt(s.mainScores.podiumLogLoss),
      fmt(s.mainScores.winLogLoss + s.mainScores.podiumLogLoss),
    ]);
  }
  console.log(table(seasonRows).join("\n"));
  console.log("");

  // Grid of Settings: paceStages × recencyHalfLife × priorStrength (≈ 48 cells)
  interface GridItem {
    paceStages: number;
    recencyHalfLife: number;
    priorStrength: number;
    label: string;
  }
  const grid: GridItem[] = [];
  for (const ps of [0, 3, 5, 8]) {
    for (const hl of [8, 16, Number.POSITIVE_INFINITY]) {
      for (const prior of [0.5, 1, 2, 3]) {
        const hlLabel = Number.isFinite(hl) ? `hl=${hl}` : "no decay";
        const psLabel = ps === 0 ? "all" : `top${ps}`;
        grid.push({
          paceStages: ps,
          recencyHalfLife: hl,
          priorStrength: prior,
          label: `stages=${psLabel}, ${hlLabel}, prior=${prior}`,
        });
      }
    }
  }

  console.log("=== Candidate Settings Evaluation (Protocol D30) ===");
  const candidateRows: string[][] = [
    [
      "Setting",
      "Train (22-24)",
      "Valid (2025)",
      "Hist Imp",
      "Confirm (2026)",
      "Verdict",
    ],
  ];

  const adopted: GridItem[] = [];

  for (const item of grid) {
    // Skip the exact default (paceStages=0, no decay, prior=3) — that is the baseline
    const isBaseline =
      item.paceStages === 0 &&
      item.recencyHalfLife === Number.POSITIVE_INFINITY &&
      item.priorStrength === 3;
    if (isBaseline) continue;

    const candEval = evaluateSetting(
      seasons,
      {
        paceStages: item.paceStages,
        recencyHalfLife: item.recencyHalfLife,
        priorStrength: item.priorStrength,
        ...NO_GRID,
      },
      item.label,
      nSims,
    );
    const comp = compareCandidate(candEval, defaultEval);
    candidateRows.push([
      item.label,
      formatDiff(comp.trainingComp),
      formatDiff(comp.validationComp),
      `${comp.verdict.historySeasonsImproved}/4`,
      formatDiff(comp.confirmationComp),
      comp.verdict.adopt ? "ADOPT" : "reject",
    ]);
    if (comp.verdict.adopt) adopted.push(item);
  }

  console.log(table(candidateRows).join("\n"));
  console.log("");

  if (adopted.length === 0) {
    console.log("Verdict: NOTHING ADOPTED — v1 defaults unchanged.");
  } else {
    console.log(`Verdict: ${adopted.length} setting(s) passed D30:`);
    for (const a of adopted) console.log(`  ${a.label}`);
  }
  console.log("");
  console.log("Note: 2026 confirmation is printed last and only checked for non-regression (<= 1 SE).");
  console.log("");
  printGridSignal(seasons, nSims);
  console.log("");
  printQualifyingNoise(seasons);
}

/** Step 8: the qualifying noise. Estimated on training; validation and 2026 are shown for information. */
export function printQualifyingNoise(seasons: CalibrationSeasons): void {
  console.log("=== Qualifying Noise (Step 8) ===");
  console.log("Mean log likelihood of one real grid, given the strengths fitted before the race (higher = better), key =");
  console.log("strength + noise * Gumbel. Rounds 3 onward. The noise is chosen on 2022-2024 only; 2026 is printed last.\n");
  const fit = fitQualifyingNoise(seasons);
  const f = (c: LikelihoodCell) => `${c.mean.toFixed(3)} (±${c.se.toFixed(3)})`;
  const rows: string[][] = [["noise", "Train (22-24)", "Valid (2025)", "Confirm (2026)"]];
  for (const r of fit.byNoise) rows.push([String(r.noise), f(r.training), f(r.validation), f(r.confirmation)]);
  console.log(table(rows).join("\n"));
  console.log("");
  const edge = fit.selected === fit.byNoise[0]!.noise || fit.selected === fit.byNoise[fit.byNoise.length - 1]!.noise;
  console.log(`Chosen on training: qualifyingNoise ${fit.selected}.${edge ? " (at the edge of the grid tried: extend the grid before using it)" : ""}`);
}

/** Step 7: the grid term. Training and validation first, the 2026 confirmation last. */
export function printGridSignal(seasons: CalibrationSeasons, nSims: number): void {
  console.log("=== Grid Signal (Step 7, protocol D30) ===");
  console.log("Baseline: current defaults (v2) with gridWeight 0. Actual grid of every past race. Differences are per race,");
  console.log("candidate minus baseline (negative = better). The weight is chosen on 2022-2024 only.\n");
  const result = evaluateGridSignal(seasons, nSims);

  const rows: string[][] = [["gridWeight", "2022", "2023", "2024", "Train (22-24)", "Valid (2025)", "Hist Imp"]];
  for (const { weight, comparison: c } of result.candidates) {
    rows.push([
      String(weight),
      formatDiff(c.perSeasonComp.get(2022)!),
      formatDiff(c.perSeasonComp.get(2023)!),
      formatDiff(c.perSeasonComp.get(2024)!),
      formatDiff(c.trainingComp),
      formatDiff(c.validationComp),
      `${c.verdict.historySeasonsImproved}/4`,
    ]);
  }
  console.log(table(rows).join("\n"));
  console.log("");

  if (result.selected === 0 || result.verdict === null) {
    console.log("Chosen on training: gridWeight 0 (no weight beats ignoring the grid).");
    console.log("Verdict: grid signal NOT adopted. Skip Step 8.");
    return;
  }
  console.log(`Chosen on training: gridWeight ${result.selected}.\n`);

  const chosen = result.candidates.find((c) => c.weight === result.selected)!.comparison;
  console.log("=== Confirmation (2026, printed last) ===");
  console.log(table([["Season", "Race diff", "Early (rounds 3-5) diff"],
    ...[2022, 2023, 2024, 2025, 2026].map((y) => [String(y), formatDiff(chosen.perSeasonComp.get(y)!), formatDiff(chosen.earlyComp.get(y)!)]),
  ]).join("\n"));
  console.log("");
  if (result.verdict.adopt) {
    console.log(`Verdict: gridWeight ${result.selected} ADOPTED (passes D30). Go to Step 8.`);
  } else {
    console.log(`Verdict: gridWeight ${result.selected} NOT adopted. Skip Step 8. Reasons:`);
    for (const reason of result.verdict.reasons) console.log(`  - ${reason}`);
  }
}

// ---------- Phase 9, Step 4: the points chance and the expected finish (protocol D53) ----------

/**
 * "All places" as a number of finishing stages, named once. `paceStages` 0 already means all places, but
 * `finishStages` 0 means "same as `paceStages`", so both candidate families use this number. Any value of at least the
 * field size is the all-places fit; `checkAllPlaces` refuses a field larger than it.
 */
export const ALL_PLACES = 99;
/** D53 rule 1: the least improvement on 2025, per race (the mean over the pairs of a race), for the points Brier. */
export const POINTS_MATERIAL_DIFFERENCE = 0.004;
/** D53 rule 6: a band of the pooled reliability table may be off by this much (5 points). */
export const RELIABILITY_TOLERANCE = 0.05;
/** D53 rule 6: a band with fewer pairs than this is shown but not judged; a handful of pairs says nothing. */
export const MIN_BAND_PAIRS = 30;
export const POINTS_PACE_STAGES = [5, 8, 10, ALL_PLACES] as const;
export const POINTS_FINISH_STAGES = [8, 10, ALL_PLACES] as const;
export const POINTS_PRIORS = [0.5, 1, 3] as const;

export interface PointsCandidate {
  /** A: a larger global `paceStages`; B: a separate `finishStages` (win and podium keep today's fit) */
  family: "A" | "B";
  label: string;
  params: Partial<OddsParams>;
}

const stagesLabel = (n: number) => (n === ALL_PLACES ? `all places (${ALL_PLACES})` : String(n));

/** The candidates of D52, without the current default itself (A with the default stages and prior). */
export function pointsCandidates(): PointsCandidate[] {
  const out: PointsCandidate[] = [];
  for (const paceStages of POINTS_PACE_STAGES) {
    for (const priorStrength of POINTS_PRIORS) {
      if (paceStages === defaultOddsParams.paceStages && priorStrength === defaultOddsParams.priorStrength) continue;
      out.push({ family: "A", label: `A paceStages=${stagesLabel(paceStages)}, prior=${priorStrength}`, params: { paceStages, priorStrength } });
    }
  }
  for (const finishStages of POINTS_FINISH_STAGES) {
    for (const priorStrength of POINTS_PRIORS) {
      out.push({ family: "B", label: `B finishStages=${stagesLabel(finishStages)}, prior=${priorStrength}`, params: { finishStages, priorStrength } });
    }
  }
  return out;
}

/**
 * Whether a candidate can change the win and podium numbers: any setting of the first pass that differs from the
 * default. A `finishStages` at the default prior cannot (the second pass only feeds `top10` and `meanPosition`); the
 * same `finishStages` with another prior can, because the prior is shared by both passes.
 */
export function affectsWinPodium(params: Partial<OddsParams>): boolean {
  return (Object.keys(params) as (keyof OddsParams)[]).some((k) => k !== "finishStages" && params[k] !== defaultOddsParams[k]);
}

/** `ALL_PLACES` is "all places" only while no race has more starters than it: refuse a field that is larger. */
export function checkAllPlaces(seasons: CalibrationSeasons, allPlaces = ALL_PLACES): void {
  for (const season of seasons.all) {
    for (let round = 1; round <= season.asOfRound; round++) {
      const size = outcomeOf(season, round)?.field.length ?? 0;
      if (size > allPlaces) {
        throw new RangeError(`${season.season} round ${round} has ${size} drivers, more than ALL_PLACES (${allPlaces})`);
      }
    }
  }
}

/** From the pooled training differences (candidate minus default, negative = better): the best label, or null. */
export function selectPointsCandidate(trainingDiffs: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestDiff = 0;
  for (const [label, diff] of trainingDiffs) {
    if (diff < bestDiff) {
      best = label;
      bestDiff = diff;
    }
  }
  return best;
}

export interface PointsAdoptionInput {
  /** points Brier per race, candidate minus default, on 2025 */
  validationComp: CellComparison;
  /** the same on 2026 */
  confirmationComp: CellComparison;
  /** the same, per season (the history years 2022-2025 are counted) */
  perSeasonComp: ReadonlyMap<number, CellComparison>;
  /** the same on rounds 3 to 5, per season, 2026 included */
  earlyComp: ReadonlyMap<number, CellComparison>;
  /** win + podium log loss per race, candidate minus default, per season; null for a candidate that cannot move them */
  winPodiumComp: ReadonlyMap<number, CellComparison> | null;
  /** the points chance by bands of ten points, pooled over 2022-2025 */
  reliability: readonly ReliabilityBin[];
}

export interface PointsVerdict {
  adopt: boolean;
  validationBeats2SE: boolean;
  validationMargin: boolean;
  historySeasonsImproved: number;
  historySeasonsCount: number;
  confirmationPass: boolean;
  earlyPass: boolean;
  /** null when the candidate cannot move win and podium, so there is nothing to check */
  winPodiumPass: boolean | null;
  reliabilityPass: boolean;
  /** the band judged with the largest gap between the forecast mean and what happened, in points of probability */
  worstBandGap: number | null;
  reasons: string[];
}

/**
 * D53, on the points Brier per race (a candidate must pass all of them):
 *  1. 2025 beats the default by more than 2 SE and by at least `POINTS_MATERIAL_DIFFERENCE`.
 *  2. Improves at least 3 of the 4 history seasons (2022-2025).
 *  3. 2026 is not worse by more than 1 SE.
 *  4. Rounds 3 to 5 are not worse by more than 1 SE in any season.
 *  5. For a candidate that can move win and podium: their log loss is not worse by more than 1 SE in any season.
 *  6. In the pooled 2022-2025 reliability table no judged band is off by more than `RELIABILITY_TOLERANCE`.
 */
export function checkPointsAdoption(input: PointsAdoptionInput, historyYears: readonly number[] = HISTORY_SEASONS): PointsVerdict {
  const reasons: string[] = [];
  const val = input.validationComp;
  const validationBeats2SE = val.meanDiff < -2 * val.se;
  const validationMargin = val.meanDiff <= -POINTS_MATERIAL_DIFFERENCE;
  if (!validationBeats2SE) reasons.push(`2025 diff ${val.meanDiff.toFixed(4)} does not beat the default by > 2 SE (${(-2 * val.se).toFixed(4)})`);
  if (!validationMargin) reasons.push(`2025 diff ${val.meanDiff.toFixed(4)} is less than the threshold -${POINTS_MATERIAL_DIFFERENCE}`);

  let historySeasonsImproved = 0;
  for (const year of historyYears) {
    const comp = input.perSeasonComp.get(year);
    if (comp && comp.meanDiff < 0) historySeasonsImproved++;
  }
  if (historySeasonsImproved < 3) reasons.push(`Improves only ${historySeasonsImproved} of ${historyYears.length} history seasons (needs >= 3)`);

  const conf = input.confirmationComp;
  const confirmationPass = conf.meanDiff <= conf.se;
  if (!confirmationPass) reasons.push(`2026 worse by > 1 SE (diff ${conf.meanDiff.toFixed(4)} > SE ${conf.se.toFixed(4)})`);

  let earlyPass = true;
  for (const [year, comp] of input.earlyComp) {
    if (comp.meanDiff > comp.se) {
      earlyPass = false;
      reasons.push(`Early season (rounds 3-5) of ${year} worse by > 1 SE (diff ${comp.meanDiff.toFixed(4)} > SE ${comp.se.toFixed(4)})`);
    }
  }

  let winPodiumPass: boolean | null = null;
  if (input.winPodiumComp !== null) {
    winPodiumPass = true;
    for (const [year, comp] of input.winPodiumComp) {
      if (comp.meanDiff > comp.se) {
        winPodiumPass = false;
        reasons.push(`Win and podium of ${year} worse by > 1 SE (diff ${comp.meanDiff.toFixed(4)} > SE ${comp.se.toFixed(4)})`);
      }
    }
  }

  let reliabilityPass = true;
  let worstBandGap: number | null = null;
  for (const b of input.reliability) {
    if (b.n < MIN_BAND_PAIRS || b.meanPredicted === null || b.observed === null) continue;
    const gap = Math.abs(b.meanPredicted - b.observed);
    if (worstBandGap === null || gap > worstBandGap) worstBandGap = gap;
    // a hair of slack, so that a gap of exactly 5 points is not lost to floating point
    if (gap > RELIABILITY_TOLERANCE + 1e-9) {
      reliabilityPass = false;
      reasons.push(`Band ${Math.round(b.from * 100)}-${Math.round(b.to * 100)}% of the pooled reliability table is off by ${(gap * 100).toFixed(1)} points (limit ${RELIABILITY_TOLERANCE * 100})`);
    }
  }

  const adopt = validationBeats2SE && validationMargin && historySeasonsImproved >= 3 && confirmationPass && earlyPass && winPodiumPass !== false && reliabilityPass;
  return {
    adopt,
    validationBeats2SE,
    validationMargin,
    historySeasonsImproved,
    historySeasonsCount: historyYears.length,
    confirmationPass,
    earlyPass,
    winPodiumPass,
    reliabilityPass,
    worstBandGap,
    reasons,
  };
}

export interface PointsComparison {
  trainingComp: CellComparison;
  validationComp: CellComparison;
  confirmationComp: CellComparison;
  perSeasonComp: Map<number, CellComparison>;
  earlyComp: Map<number, CellComparison>;
  winPodiumComp: Map<number, CellComparison> | null;
  /** the expected finish (mean absolute error per race), for information: D53 as written judges the points Brier */
  finishMae: { training: CellComparison; validation: CellComparison; confirmation: CellComparison };
  /** the candidate's points chance by bands of ten points, pooled over 2022-2025 */
  reliability: ReliabilityBin[];
  verdict: PointsVerdict;
}

function perRace(records: readonly RaceRecord[], f: (r: readonly RaceRecord[]) => number[]): number[] {
  return f(records);
}

/** A candidate against the baseline: the same races, race by race, on the points Brier. */
export function comparePointsCandidate(candidate: SettingEval, baseline: SettingEval, params: Partial<OddsParams>): PointsComparison {
  const brier = (c: readonly RaceRecord[], b: readonly RaceRecord[]) =>
    compareLosses(perRace(c, (r) => racePointsBrier(r, "model")), perRace(b, (r) => racePointsBrier(r, "model")));
  const mae = (c: readonly RaceRecord[], b: readonly RaceRecord[]) =>
    compareLosses(perRace(c, (r) => raceFinishMae(r, "model")), perRace(b, (r) => raceFinishMae(r, "model")));

  const perSeasonComp = new Map<number, CellComparison>();
  const earlyComp = new Map<number, CellComparison>();
  const winPodiumComp = affectsWinPodium(params) ? new Map<number, CellComparison>() : null;
  for (const [year, cand] of candidate.bySeason) {
    const base = baseline.bySeason.get(year)!;
    perSeasonComp.set(year, brier(cand.mainRecords, base.mainRecords));
    earlyComp.set(year, brier(cand.earlyRecords, base.earlyRecords));
    winPodiumComp?.set(year, compareCells(cand.mainRecords, base.mainRecords));
  }

  const pooled = HISTORY_SEASONS.flatMap((y) => candidate.bySeason.get(y)!.mainRecords);
  const bands = reliability(pairsOf(pooled, "model", "top10"), POINTS_EDGES);
  const validationComp = brier(candidate.validationRecords, baseline.validationRecords);
  const confirmationComp = brier(candidate.confirmationRecords, baseline.confirmationRecords);
  return {
    trainingComp: brier(candidate.trainingRecords, baseline.trainingRecords),
    validationComp,
    confirmationComp,
    perSeasonComp,
    earlyComp,
    winPodiumComp,
    finishMae: {
      training: mae(candidate.trainingRecords, baseline.trainingRecords),
      validation: mae(candidate.validationRecords, baseline.validationRecords),
      confirmation: mae(candidate.confirmationRecords, baseline.confirmationRecords),
    },
    reliability: bands,
    verdict: checkPointsAdoption({ validationComp, confirmationComp, perSeasonComp, earlyComp, winPodiumComp, reliability: bands }),
  };
}

export interface PointsResult {
  /** the current defaults, which every candidate is compared with */
  baseline: SettingEval;
  baselineReliability: ReliabilityBin[];
  candidates: { candidate: PointsCandidate; comparison: PointsComparison }[];
  /** per family, the candidate with the best pooled training result, or null if none beats the default there */
  selected: { A: PointsCandidate | null; B: PointsCandidate | null };
  /** B if its chosen candidate passes D53 (D52 prefers B), else A if its chosen one does, else nothing */
  recommendation: PointsCandidate | null;
}

/**
 * Every candidate is scored on all seasons, but each family's choice is made from the training seasons alone;
 * validation, the history, the early season and 2026 only judge that choice.
 */
export function evaluatePoints(seasons: CalibrationSeasons, nSims = CALIBRATE_SIMS): PointsResult {
  checkAllPlaces(seasons);
  const baseline = evaluateSetting(seasons, {}, "current defaults", nSims);
  const pooled = HISTORY_SEASONS.flatMap((y) => baseline.bySeason.get(y)!.mainRecords);
  const baselineReliability = reliability(pairsOf(pooled, "model", "top10"), POINTS_EDGES);
  const candidates = pointsCandidates().map((candidate) => ({
    candidate,
    comparison: comparePointsCandidate(evaluateSetting(seasons, candidate.params, candidate.label, nSims), baseline, candidate.params),
  }));
  const pick = (family: "A" | "B"): PointsCandidate | null => {
    const inFamily = candidates.filter((c) => c.candidate.family === family);
    const label = selectPointsCandidate(new Map(inFamily.map((c) => [c.candidate.label, c.comparison.trainingComp.meanDiff])));
    return inFamily.find((c) => c.candidate.label === label)?.candidate ?? null;
  };
  const selected = { A: pick("A"), B: pick("B") };
  const passes = (c: PointsCandidate | null) => c !== null && candidates.find((x) => x.candidate === c)!.comparison.verdict.adopt;
  const recommendation = passes(selected.B) ? selected.B : passes(selected.A) ? selected.A : null;
  return { baseline, baselineReliability, candidates, selected, recommendation };
}

const pctOf = (x: number | null, digits = 1) => (x === null ? "-" : `${(x * 100).toFixed(digits)}%`);

function reliabilityRows(bins: readonly ReliabilityBin[]): string[][] {
  return [
    ["forecast", "pairs", "forecast mean", "happened", "gap", ""],
    ...bins
      .filter((b) => b.n > 0)
      .map((b) => {
        const gap = b.meanPredicted === null || b.observed === null ? null : b.observed - b.meanPredicted;
        const gapText = gap === null ? "-" : `${gap > 0 ? "+" : ""}${(gap * 100).toFixed(1)}`;
        return [`${Math.round(b.from * 100)}-${Math.round(b.to * 100)}%`, String(b.n), pctOf(b.meanPredicted), pctOf(b.observed), gapText, b.n < MIN_BAND_PAIRS ? "thin, not judged" : ""];
      }),
  ];
}

/** The report of `--points`: training and validation first, the 2026 confirmation and the verdicts last. */
export function formatPoints(result: PointsResult): string {
  const lines: string[] = [];
  const { baseline } = result;
  const diff = (c: CellComparison) => formatDiff(c, 4);

  lines.push("=== Points Chance and Expected Finish (Phase 9, protocol D53) ===");
  lines.push("The outcome is \"classified in the top ten\" (points Brier, lower is better); a retirement counts as last place");
  lines.push("for the finish. Candidates are compared with the current defaults on the same races; differences are per race,");
  lines.push("candidate minus default (negative = better). Finish MAE is shown for information: D53 judges the points Brier.");
  lines.push(`Rule 6 judges a reliability band only with at least ${MIN_BAND_PAIRS} pairs. Each family's candidate is chosen on 2022-2024 only.\n`);

  lines.push("--- Current defaults ---");
  const roleOf = (y: number) => (y <= 2024 ? "Train" : "Valid");
  const baseRows: string[][] = [["Season", "Role", "Races", "Points Brier", "Finish MAE"]];
  for (const y of HISTORY_SEASONS) {
    const rs = baseline.bySeason.get(y)!.mainRecords;
    const b = cell(racePointsBrier(rs, "model"));
    const m = cell(raceFinishMae(rs, "model"));
    baseRows.push([String(y), roleOf(y), String(b.n), `${b.mean.toFixed(4)} (±${b.se.toFixed(4)})`, `${m.mean.toFixed(2)} (±${m.se.toFixed(2)})`]);
  }
  const tb = cell(racePointsBrier(baseline.trainingRecords, "model"));
  const tm = cell(raceFinishMae(baseline.trainingRecords, "model"));
  baseRows.push(["22-24", "Train", String(tb.n), `${tb.mean.toFixed(4)} (±${tb.se.toFixed(4)})`, `${tm.mean.toFixed(2)} (±${tm.se.toFixed(2)})`]);
  lines.push(...table(baseRows, 2));
  lines.push("");

  lines.push("--- Candidates: training and validation ---");
  const rows: string[][] = [["candidate", "Train (22-24)", "Valid (2025)", "Hist Imp", "Early", "Win/podium", "Band gap", "MAE Train", "MAE Valid"]];
  for (const { candidate, comparison: c } of result.candidates) {
    rows.push([
      candidate.label,
      diff(c.trainingComp),
      diff(c.validationComp),
      `${c.verdict.historySeasonsImproved}/${c.verdict.historySeasonsCount}`,
      c.verdict.earlyPass ? "ok" : "worse",
      c.verdict.winPodiumPass === null ? "same" : c.verdict.winPodiumPass ? "ok" : "worse",
      c.verdict.worstBandGap === null ? "-" : `${(c.verdict.worstBandGap * 100).toFixed(1)} pt`,
      formatDiff(c.finishMae.training, 2),
      formatDiff(c.finishMae.validation, 2),
    ]);
  }
  lines.push(...table(rows));
  lines.push("  Win/podium: \"same\" = cannot move them (finishStages at the default prior); otherwise not worse than 1 SE in any season.");
  lines.push("");

  lines.push("--- Chosen on training (2022-2024 only) ---");
  for (const family of ["A", "B"] as const) {
    const chosen = result.selected[family];
    lines.push(`  ${chosen ? chosen.label : `${family} none (no candidate beats the default on the training seasons)`}`);
  }
  lines.push("");

  lines.push("--- Reliability, pooled 2022-2025, finishing in the points ---");
  lines.push("Current defaults");
  lines.push(...table(reliabilityRows(result.baselineReliability)));
  for (const family of ["A", "B"] as const) {
    const chosen = result.selected[family];
    if (!chosen) continue;
    const c = result.candidates.find((x) => x.candidate === chosen)!.comparison;
    lines.push("");
    lines.push(chosen.label);
    lines.push(...table(reliabilityRows(c.reliability)));
  }
  lines.push("");

  lines.push("=== Confirmation (2026, printed last) ===");
  lines.push("Not used to choose. It only decides whether the choice may be adopted (rule 3), together with the other rules.");
  const confRows: string[][] = [["candidate", "2026 Brier diff", "2026 MAE diff", "Early 2026", "Hist Imp", "D53"]];
  for (const { candidate, comparison: c } of result.candidates) {
    confRows.push([
      candidate.label,
      diff(c.confirmationComp),
      formatDiff(c.finishMae.confirmation, 2),
      diff(c.earlyComp.get(2026)!),
      `${c.verdict.historySeasonsImproved}/${c.verdict.historySeasonsCount}`,
      c.verdict.adopt ? "ADOPT" : "no",
    ]);
  }
  lines.push(...table(confRows));
  lines.push("");

  const alsoPassing = result.candidates.filter((c) => c.comparison.verdict.adopt && c.candidate !== result.selected.A && c.candidate !== result.selected.B);
  for (const family of ["A", "B"] as const) {
    const chosen = result.selected[family];
    if (!chosen) {
      lines.push(`Verdict ${family}: no candidate beat the default on the training seasons, so nothing to adopt.`);
      continue;
    }
    const v = result.candidates.find((x) => x.candidate === chosen)!.comparison.verdict;
    lines.push(`Verdict ${family}: ${chosen.label.slice(2)} ${v.adopt ? "passes D53." : "does NOT pass D53. Reasons:"}`);
    for (const reason of v.reasons) lines.push(`  - ${reason}`);
  }
  if (alsoPassing.length > 0) {
    lines.push(`Also passing D53 but not chosen on training (information only): ${alsoPassing.map((c) => c.candidate.label).join("; ")}`);
  }
  lines.push(
    result.recommendation
      ? `Recommendation: adopt ${result.recommendation.label} (D52: B is preferred when its chosen candidate passes, because win and podium keep today's numbers).`
      : "Recommendation: change nothing; no chosen candidate passes D53 (D52: B is preferred when it passes, then A).",
  );
  return lines.join("\n");
}

/** Phase 9, Step 4. */
export function printPoints(seasons: CalibrationSeasons, nSims: number): void {
  console.log(formatPoints(evaluatePoints(seasons, nSims)));
}

if (import.meta.main) {
  runCalibrationCli(process.argv.slice(2));
}
