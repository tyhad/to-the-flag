/**
 * Usage: bun scripts/calibrate.ts [--sims N] [--history <dir>] [--live <path>] [--grid-signal]
 *
 * `--grid-signal` runs only the Step 7 section (the grid term); without it, Step 6 (the settings grid) runs first.
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
import { loadSeasons } from "../data/loadHistory";
import { loadSeason } from "../data/loadSeason";
import type { OddsParams, SeasonState } from "../engine";
import {
  compareCells,
  MATERIAL_DIFFERENCE,
  scoreMethod,
  walkForward,
  type CellComparison,
  type RaceRecord,
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

/** The v1 behavior, spelled out: Step 6 compares candidate settings against this, whatever the current defaults are. */
export const V1_PARAMS: Partial<OddsParams> = { recencyHalfLife: Number.POSITIVE_INFINITY, priorStrength: 3, paceStages: 0 };

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

// ---------- Formatting & CLI ----------

const fmt = (x: number, digits = 3) => x.toFixed(digits);

function formatDiff(c: CellComparison): string {
  const sign = c.meanDiff > 0 ? "+" : "";
  return `${sign}${c.meanDiff.toFixed(3)} (±${c.se.toFixed(3)})`;
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

if (import.meta.main) {
  runCalibrationCli(process.argv.slice(2));
}
