/**
 * Usage: bun scripts/backtest.ts [season.json | f1gstats.sqlite] [--sims N] [--grid-weight W]
 *
 * Walk-forward backtest of the odds model (Phase 3, Step 10). For each completed race from round 6 on, the model is
 * fitted on the earlier rounds only and asked who wins and who takes the podium. Those forecasts are scored against
 * what happened, next to two naive baselines (everyone equal; in proportion to points so far), and a small grid of
 * settings is compared. Phase 9 adds the points chance (`top10`) and the expected finish (`meanPosition`) to the
 * scores, next to the flat baseline "10/n for everyone" (10/22 in a full field). Without an argument it uses tests/fixtures/season-2026-r16.json, so the numbers in
 * docs/MODEL.md can be reproduced exactly.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSeason } from "../data/loadSeason";
import { computeDriverStandings, defaultOddsParams, forecastRace, type OddsParams, type RaceForecast, type SeasonState } from "../engine";
import { hashSeed } from "../engine/rng";

/** The first race that is predicted: before round 6 there is too little data to say anything. */
export const FIRST_TEST_ROUND = 6;
/** Probabilities are kept this far from 0 and 1 before taking logarithms, for the model and the baselines alike. */
export const CLIP = 0.001;
/** Simulated races per forecast. */
export const BACKTEST_SIMS = 5000;
/** Bin edges of the reliability table; the last bin includes 1. */
export const RELIABILITY_EDGES: readonly number[] = [0, 0.05, 0.1, 0.2, 0.4, 0.7, 1];
export const DEFAULT_GRID = {
  recencyHalfLife: [4, 8, 16, Number.POSITIVE_INFINITY],
  priorStrength: [0.5, 1, 2, 3],
};
/** Bin edges of the points reliability table: bands of ten points; the last band includes 1. */
export const POINTS_EDGES: readonly number[] = Array.from({ length: 11 }, (_, i) => i / 10);
export const SIGMAS = [0, 0.25, 0.5];
/**
 * A setting is only "clearly" better if it wins by more than two standard errors AND by at least this much per race
 * (about 1% of the total loss). A tiny gain that is very consistent is still too small to be worth a change.
 */
export const MATERIAL_DIFFERENCE = 0.005;

// ---------- looking only at the past ----------

/** The season as it stood before `round` was run: nothing from that round on, the sprint included. */
export function stateBefore(state: SeasonState, round: number): SeasonState {
  const lastRound = round - 1;
  const results = state.results.filter((r) => r.round < round);
  const racedLast = new Set(results.filter((r) => r.round === lastRound).map((r) => r.driver));
  return {
    ...state,
    asOfRound: lastRound,
    rounds: state.rounds.map((r) => (r.round < round ? r : { ...r, status: "scheduled" as const })),
    results,
    qualifying: state.qualifying.filter((q) => q.round < round),
    drivers: state.drivers.map((d) => ({ ...d, active: racedLast.has(d.code) })),
  };
}

export interface Outcome {
  round: number;
  /** everyone who started the race */
  field: string[];
  /** classified winner; null if there is none */
  winner: string | null;
  /** classified finishers in the top three */
  podium: string[];
  /** classified finishers in the top ten: the points of a race (a retirement is never in it) */
  top10: string[];
  /**
   * The place that happened, for everyone who started: the classified position, or the field size for a driver who was
   * not classified (a retirement counts as last place, as in `forecastRace`).
   */
  finish: Record<string, number>;
}

export function outcomeOf(state: SeasonState, round: number): Outcome | null {
  const rows = state.results.filter((r) => r.round === round && r.kind === "race");
  if (rows.length === 0) return null;
  const field = [...new Set(rows.map((r) => r.driver))];
  const finish: Record<string, number> = {};
  for (const d of field) finish[d] = field.length;
  for (const r of rows) if (r.classified) finish[r.driver] = r.position;
  return {
    round,
    field,
    winner: rows.find((r) => r.classified && r.position === 1)?.driver ?? null,
    podium: rows.filter((r) => r.classified && r.position <= 3).map((r) => r.driver),
    top10: rows.filter((r) => r.classified && r.position <= 10).map((r) => r.driver),
    finish,
  };
}

// ---------- the baselines ----------

export type Forecast = Pick<RaceForecast, "win" | "podium" | "top10" | "meanPosition">;

/**
 * Everyone equal: 1/n to win, 3/n to be on the podium, 10/n to be in the points (10/22 in a full field), and the
 * middle place, (n + 1) / 2, as the expected finish. This is the baseline of the points scores.
 */
export function uniformForecast(field: readonly string[]): Forecast {
  const win: Record<string, number> = {};
  const podium: Record<string, number> = {};
  const top10: Record<string, number> = {};
  const meanPosition: Record<string, number> = {};
  for (const d of field) {
    win[d] = 1 / field.length;
    podium[d] = Math.min(1, 3 / field.length);
    top10[d] = Math.min(1, 10 / field.length);
    meanPosition[d] = (field.length + 1) / 2;
  }
  return { win, podium, top10, meanPosition };
}

/**
 * In proportion to the points scored before the race. With no points at all, everyone equal. It says nothing about
 * the points chance or the finish, so those two are the flat ones; the report does not print its points scores.
 */
export function pointsForecast(before: SeasonState, field: readonly string[]): Forecast {
  const points = new Map(computeDriverStandings(before).map((r) => [r.id, r.points]));
  const total = field.reduce((s, d) => s + (points.get(d) ?? 0), 0);
  const flat = uniformForecast(field);
  if (total <= 0) return flat;
  const win: Record<string, number> = {};
  const podium: Record<string, number> = {};
  for (const d of field) {
    const share = (points.get(d) ?? 0) / total;
    win[d] = share;
    podium[d] = Math.min(1, 3 * share);
  }
  return { win, podium, top10: flat.top10, meanPosition: flat.meanPosition };
}

// ---------- the scores ----------

export interface Pair {
  /** forecast probability */
  p: number;
  /** 1 if it happened */
  y: 0 | 1;
}

export function clipProbability(p: number, eps = CLIP): number {
  return Math.min(1 - eps, Math.max(eps, p));
}

/** Mean of -ln(probability given to what happened). Lower is better. */
export function logLoss(pairs: readonly Pair[]): number {
  if (pairs.length === 0) throw new RangeError("log loss of no forecasts");
  let total = 0;
  for (const { p, y } of pairs) {
    const q = clipProbability(p);
    total -= y === 1 ? Math.log(q) : Math.log(1 - q);
  }
  return total / pairs.length;
}

/** Mean squared difference between the forecast and what happened. Lower is better. */
export function brierScore(pairs: readonly Pair[]): number {
  if (pairs.length === 0) throw new RangeError("Brier score of no forecasts");
  return pairs.reduce((s, { p, y }) => s + (p - y) ** 2, 0) / pairs.length;
}

export interface ReliabilityBin {
  from: number;
  to: number;
  n: number;
  meanPredicted: number | null;
  observed: number | null;
}

/** For each range of forecast probabilities: how often it was forecast, and how often it happened. */
export function reliability(pairs: readonly Pair[], edges: readonly number[] = RELIABILITY_EDGES): ReliabilityBin[] {
  const last = edges.length - 2;
  const bins = edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1]!, n: 0, sumP: 0, sumY: 0 }));
  for (const { p, y } of pairs) {
    let i = last;
    for (let k = 0; k < last; k++) {
      if (p < edges[k + 1]!) {
        i = k;
        break;
      }
    }
    const bin = bins[i]!;
    bin.n++;
    bin.sumP += p;
    bin.sumY += y;
  }
  return bins.map((b) => ({
    from: b.from,
    to: b.to,
    n: b.n,
    meanPredicted: b.n > 0 ? b.sumP / b.n : null,
    observed: b.n > 0 ? b.sumY / b.n : null,
  }));
}

// ---------- walking forward ----------

export type Method = "model" | "uniform" | "points";

export interface RaceRecord {
  round: number;
  /** the seed of the model's simulation of this race: the same for every setting */
  seed: number;
  outcome: Outcome;
  forecasts: Record<Method, Forecast>;
}

/** Where each driver started the race of `round` (the actual grid; known before the lights go out, so not a leak). */
export function gridOf(state: SeasonState, round: number): Record<string, number> {
  const grid: Record<string, number> = {};
  for (const r of state.results) {
    if (r.round === round && r.kind === "race" && Number.isFinite(r.grid)) grid[r.driver] = r.grid;
  }
  return grid;
}

/** Predicts every race from `firstRound` to the last completed one, each from the rounds before it only. */
export function walkForward(state: SeasonState, params: Partial<OddsParams> = {}, firstRound = FIRST_TEST_ROUND): RaceRecord[] {
  const records: RaceRecord[] = [];
  for (let round = firstRound; round <= state.asOfRound; round++) {
    const outcome = outcomeOf(state, round);
    if (!outcome) continue;
    const before = stateBefore(state, round);
    const seed = hashSeed("backtest", String(state.season), String(round));
    const model = forecastRace(before, { nSims: BACKTEST_SIMS, ...params, seed }, outcome.field, gridOf(state, round));
    records.push({
      round,
      seed,
      outcome,
      forecasts: {
        model: { win: model.win, podium: model.podium, top10: model.top10, meanPosition: model.meanPosition },
        uniform: uniformForecast(outcome.field),
        points: pointsForecast(before, outcome.field),
      },
    });
  }
  return records;
}

export type Event = "win" | "podium" | "top10";

export function pairsOf(records: readonly RaceRecord[], method: Method, event: Event): Pair[] {
  const pairs: Pair[] = [];
  for (const r of records) {
    for (const d of r.outcome.field) {
      const happened = event === "win" ? r.outcome.winner === d : event === "podium" ? r.outcome.podium.includes(d) : r.outcome.top10.includes(d);
      pairs.push({ p: r.forecasts[method][event][d] ?? 0, y: happened ? 1 : 0 });
    }
  }
  return pairs;
}

/** Mean absolute difference between the expected finishing place and the place that happened. Lower is better. */
export function finishMae(records: readonly RaceRecord[], method: Method): number {
  let total = 0;
  let n = 0;
  for (const r of records) {
    for (const d of r.outcome.field) {
      total += Math.abs((r.forecasts[method].meanPosition[d] ?? (r.outcome.field.length + 1) / 2) - r.outcome.finish[d]!);
      n++;
    }
  }
  if (n === 0) throw new RangeError("finish error of no forecasts");
  return total / n;
}

export interface Scores {
  races: number;
  pairs: number;
  winLogLoss: number;
  winBrier: number;
  /** mean of -ln(probability given to the actual winner) */
  winnerLogLoss: number;
  podiumLogLoss: number;
  podiumBrier: number;
  /** Brier score of the points chance: the outcome is "classified in the top ten" */
  pointsBrier: number;
  /** mean absolute error of the expected finish against the place that happened (a retirement is last) */
  finishMae: number;
  /** the points chance by bands of ten points; a band with no pairs has `null` numbers */
  pointsReliability: ReliabilityBin[];
}

export function scoreMethod(records: readonly RaceRecord[], method: Method): Scores {
  const win = pairsOf(records, method, "win");
  const podium = pairsOf(records, method, "podium");
  const points = pairsOf(records, method, "top10");
  const withWinner = records.filter((r) => r.outcome.winner !== null);
  const winnerLogLoss =
    withWinner.reduce((s, r) => s - Math.log(clipProbability(r.forecasts[method].win[r.outcome.winner!] ?? 0)), 0) / withWinner.length;
  return {
    races: records.length,
    pairs: win.length,
    winLogLoss: logLoss(win),
    winBrier: brierScore(win),
    winnerLogLoss,
    podiumLogLoss: logLoss(podium),
    podiumBrier: brierScore(podium),
    pointsBrier: brierScore(points),
    finishMae: finishMae(records, method),
    pointsReliability: reliability(points, POINTS_EDGES),
  };
}

// ---------- the grid ----------

export interface Grid {
  recencyHalfLife: readonly number[];
  priorStrength: readonly number[];
}

export interface GridCell {
  recencyHalfLife: number;
  priorStrength: number;
  records: RaceRecord[];
  scores: Scores;
}

export function runGrid(state: SeasonState, grid: Grid = DEFAULT_GRID, base: Partial<OddsParams> = {}): GridCell[] {
  const cells: GridCell[] = [];
  for (const recencyHalfLife of grid.recencyHalfLife) {
    for (const priorStrength of grid.priorStrength) {
      const records = walkForward(state, { ...base, recencyHalfLife, priorStrength });
      cells.push({ recencyHalfLife, priorStrength, records, scores: scoreMethod(records, "model") });
    }
  }
  return cells;
}

export interface SigmaCell {
  strengthSigma: number;
  scores: Scores;
}

export function runSigmas(state: SeasonState, sigmas: readonly number[] = SIGMAS, base: Partial<OddsParams> = {}): SigmaCell[] {
  return sigmas.map((strengthSigma) => ({
    strengthSigma,
    scores: scoreMethod(walkForward(state, { ...base, strengthSigma }), "model"),
  }));
}

/** Win and podium log loss of one race, added up: one number per race, to compare forecasts race by race. */
export function raceLosses(records: readonly RaceRecord[], method: Method): number[] {
  return records.map((r) => logLoss(pairsOf([r], method, "win")) + logLoss(pairsOf([r], method, "podium")));
}

export interface CellComparison {
  /** mean over races of (a - b): negative means `a` is better */
  meanDiff: number;
  /** standard error of that mean across races */
  se: number;
  /** true if the difference is more than two standard errors and at least MATERIAL_DIFFERENCE */
  clear: boolean;
}

function compareLosses(la: readonly number[], lb: readonly number[]): CellComparison {
  const diffs = la.map((x, i) => x - lb[i]!);
  const n = diffs.length;
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, n - 1);
  const se = Math.sqrt(variance / n);
  return { meanDiff: mean, se, clear: Math.abs(mean) > 2 * se && Math.abs(mean) >= MATERIAL_DIFFERENCE };
}

/** Compares the model under two settings on the same races. With about 11 races, only a large difference is clear. */
export function compareCells(a: readonly RaceRecord[], b: readonly RaceRecord[]): CellComparison {
  return compareLosses(raceLosses(a, "model"), raceLosses(b, "model"));
}

/** Compares two forecasting methods (the model and a baseline, say) on the same races. Negative: `a` is better. */
export function compareMethods(records: readonly RaceRecord[], a: Method, b: Method): CellComparison {
  return compareLosses(raceLosses(records, a), raceLosses(records, b));
}

// ---------- the report ----------

const fmt = (x: number, digits = 3) => x.toFixed(digits);
const pct = (x: number | null, digits = 1) => (x === null ? "-" : `${(x * 100).toFixed(digits)}%`);
const halfLifeText = (h: number) => (Number.isFinite(h) ? String(h) : "no decay");

function table(rows: string[][], rightFrom = 1): string[] {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows.map((r) => "  " + r.map((cell, c) => (c < rightFrom ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join("  "));
}

/** The points chance and the expected finish: the model against 10/n for everyone, and the reliability by bands. */
export function formatPointsSection(records: readonly RaceRecord[]): string[] {
  const lines: string[] = [];
  lines.push("Points chance and expected finish (not used to choose the settings above)");
  lines.push("  The outcome is \"classified in the top ten\"; a retirement counts as last place for the finish.");
  const methods: [string, Method][] = [["Model (defaults)", "model"], ["10/n for everyone", "uniform"]];
  lines.push(
    ...table([
      ["method", "points Brier", "finish MAE"],
      ...methods.map(([label, m]) => {
        const s = scoreMethod(records, m);
        return [label, fmt(s.pointsBrier, 4), fmt(s.finishMae, 2)];
      }),
    ]),
  );
  lines.push("");
  lines.push("Reliability, default model, finishing in the points");
  lines.push(
    ...table([
      ["forecast", "pairs", "forecast mean", "happened"],
      // a band with no pairs has nothing to show: it is left out, not printed as a row of dashes
      ...reliability(pairsOf(records, "model", "top10"), POINTS_EDGES)
        .filter((b) => b.n > 0)
        .map((b) => [`${Math.round(b.from * 100)}-${Math.round(b.to * 100)}%`, String(b.n), pct(b.meanPredicted), pct(b.observed)]),
    ]),
  );
  return lines;
}

export interface ReportInput {
  state: SeasonState;
  nSims: number;
  cells: GridCell[];
  /** the default settings' records: the model's forecasts and the baselines' */
  records: RaceRecord[];
  sigmaCells?: SigmaCell[];
}

export function formatReport({ state, nSims, cells, records, sigmaCells }: ReportInput): string {
  const first = records[0]!.round;
  const last = records.at(-1)!.round;
  const lines: string[] = [];
  const winners = records.filter((r) => r.outcome.winner !== null).length;
  lines.push(`Walk-forward backtest, season ${state.season}`);
  lines.push(`${records.length} races (rounds ${first}-${last}), ${scoreMethod(records, "model").pairs} driver-race pairs, ${winners} winners, ${nSims} simulated races per forecast.`);
  lines.push("Each race is predicted from the rounds before it only. For every score, lower is better.");
  lines.push(`"Clearly" below: more than two standard errors across races, and at least ${MATERIAL_DIFFERENCE} per race.`);
  lines.push("");

  // the default model against the baselines
  const methods: [string, Method][] = [["Model (defaults)", "model"], ["Uniform", "uniform"], ["Points so far", "points"]];
  lines.push("Model against the baselines");
  lines.push(
    ...table([
      ["method", "win log loss", "win Brier", "winner -ln p", "podium log loss", "podium Brier"],
      ...methods.map(([label, m]) => {
        const s = scoreMethod(records, m);
        return [label, fmt(s.winLogLoss), fmt(s.winBrier, 4), fmt(s.winnerLogLoss), fmt(s.podiumLogLoss), fmt(s.podiumBrier, 4)];
      }),
    ]),
  );
  lines.push("  winner -ln p: how surprised the forecast was by the actual winner (uniform = ln of the field size).");
  lines.push("");

  // the grid
  const isDefault = (c: GridCell) => c.recencyHalfLife === defaultOddsParams.recencyHalfLife && c.priorStrength === defaultOddsParams.priorStrength;
  const defaultCell = cells.find(isDefault);
  const total = (c: GridCell) => c.scores.winLogLoss + c.scores.podiumLogLoss;
  const best = [...cells].sort((a, b) => total(a) - total(b))[0]!;
  lines.push("Settings (win + podium log loss added up; * = current default, best = lowest)");
  lines.push(
    ...table(
      [
        ["half-life", "prior", "win log loss", "podium log loss", "total", ""],
        ...cells.map((c) => [
          halfLifeText(c.recencyHalfLife),
          String(c.priorStrength),
          fmt(c.scores.winLogLoss),
          fmt(c.scores.podiumLogLoss),
          fmt(total(c)),
          `${isDefault(c) ? "*" : ""}${c === best ? " best" : ""}`.trim(),
        ]),
      ],
      2,
    ),
  );
  if (defaultCell && best !== defaultCell) {
    const cmp = compareCells(best.records, defaultCell.records);
    lines.push(
      `  Best against default, race by race: ${fmt(cmp.meanDiff)} per race (standard error ${fmt(cmp.se)}): ` +
        `${cmp.clear ? "clearly better" : "not clearly better"}.`,
    );
  } else if (defaultCell) {
    lines.push("  The current default is the best setting tried.");
  }
  lines.push("");

  if (sigmaCells && sigmaCells.length > 0) {
    lines.push("Strength uncertainty (strengthSigma, other settings at their defaults)");
    lines.push(
      ...table([
        ["sigma", "win log loss", "podium log loss", "total"],
        ...sigmaCells.map((c) => [
          `${c.strengthSigma}${c.strengthSigma === defaultOddsParams.strengthSigma ? " *" : ""}`,
          fmt(c.scores.winLogLoss),
          fmt(c.scores.podiumLogLoss),
          fmt(c.scores.winLogLoss + c.scores.podiumLogLoss),
        ]),
      ]),
    );
    lines.push("");
  }

  // reliability
  for (const event of ["win", "podium"] as const) {
    lines.push(`Reliability, default model, ${event === "win" ? "winning the race" : "finishing on the podium"}`);
    lines.push(
      ...table([
        ["forecast", "pairs", "forecast mean", "happened"],
        ...reliability(pairsOf(records, "model", event)).map((b) => [
          `${Math.round(b.from * 100)}-${Math.round(b.to * 100)}%`,
          String(b.n),
          pct(b.meanPredicted),
          pct(b.observed),
        ]),
      ]),
    );
    lines.push("");
  }

  lines.push(...formatPointsSection(records));
  lines.push("");

  const model = scoreMethod(records, "model");
  const uniform = scoreMethod(records, "uniform");
  const againstPoints = compareMethods(records, "model", "points");
  lines.push(
    `Against points so far, race by race: ${againstPoints.meanDiff >= 0 ? "+" : ""}${fmt(againstPoints.meanDiff)} per race ` +
      `(standard error ${fmt(againstPoints.se)}): ${againstPoints.clear ? "clearly" : "not clearly"} ${againstPoints.meanDiff < 0 ? "better" : "worse"}.`,
  );
  lines.push(
    `Verdict: the model ${model.winLogLoss < uniform.winLogLoss ? "beats" : "does NOT beat"} the uniform baseline on win log loss ` +
      `(${fmt(model.winLogLoss)} against ${fmt(uniform.winLogLoss)})`,
  );
  lines.push(
    `and ${model.podiumLogLoss < uniform.podiumLogLoss ? "beats" : "does NOT beat"} it on podium log loss ` +
      `(${fmt(model.podiumLogLoss)} against ${fmt(uniform.podiumLogLoss)}).`,
  );
  return lines.join("\n");
}

// ---------- the script ----------

function readSeason(path: string): SeasonState {
  return path.endsWith(".json") ? (JSON.parse(readFileSync(path, "utf8")) as SeasonState) : loadSeason(path);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const simsAt = args.indexOf("--sims");
  const nSims = simsAt >= 0 ? Number(args[simsAt + 1]) : BACKTEST_SIMS;
  const gridAt = args.indexOf("--grid-weight");
  const gridWeight = gridAt >= 0 ? Number(args[gridAt + 1]) : undefined;
  const path = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--sims" && args[i - 1] !== "--grid-weight") ?? join(import.meta.dir, "..", "tests", "fixtures", "season-2026-r16.json");
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  if (!Number.isInteger(nSims) || nSims < 1) {
    console.error("--sims needs a whole number of 1 or more");
    process.exit(1);
  }
  if (gridWeight !== undefined && !(Number.isFinite(gridWeight) && gridWeight >= 0)) {
    console.error("--grid-weight needs a number of 0 or more");
    process.exit(1);
  }
  const state = readSeason(path);
  const base = gridWeight === undefined ? { nSims } : { nSims, gridWeight };
  console.log(`Data: ${path}`);
  console.log(`Grid weight: ${gridWeight ?? defaultOddsParams.gridWeight}${gridWeight === undefined ? " (default)" : ""}; each race uses its actual grid when the weight is above 0\n`);
  const cells = runGrid(state, DEFAULT_GRID, base);
  const records = walkForward(state, base);
  const sigmaCells = runSigmas(state, SIGMAS, base);
  console.log(formatReport({ state, nSims, cells, records, sigmaCells }));
}
