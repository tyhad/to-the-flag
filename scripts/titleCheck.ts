/**
 * Usage: bun scripts/titleCheck.ts [--sims N] [--history <dir>] [--season <season.json | f1gstats.sqlite>]
 *
 * Phase 4, Step 9: title-level sanity checks. Four champions cannot calibrate a title probability, so nothing here
 * adopts or rejects anything; it only describes.
 *  1. What-if sensitivity: "ANT out of the next four races, RUS wins all four" on the 2026 snapshot, under v1 and v2.
 *  2. History: at every round from 8 to the round before the last, what chance the model gave the driver who actually
 *     won the title, per season and pooled, for v1, v2 without the grid and v2 (defaults, with the simulated grid).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSeasons } from "../data/loadHistory";
import { loadSeason } from "../data/loadSeason";
import { computeOdds, formatProbability } from "../engine/odds";
import type { OddsParams } from "../engine/simulate";
import { remainingSessions } from "../engine/sessions";
import { driverStatus } from "../engine/status";
import type { Scenario, SeasonState } from "../engine/types";
import { stateBefore } from "./backtest";
import { HISTORY_SEASONS, NO_GRID, V1_PARAMS } from "./calibrate";

/** First round whose title odds are looked at. */
export const FIRST_TITLE_ROUND = 8;
/** Simulations per forecast in the CLI; a probability has a sampling error of at most 0.5 / sqrt(n). */
export const TITLE_SIMS = 5000;

export interface TitleModel {
  label: string;
  params: Partial<OddsParams>;
}

/** The models compared. `v2 (defaults)` simulates a grid for every race that has no real one. */
export const TITLE_MODELS: readonly TitleModel[] = [
  { label: "v1", params: V1_PARAMS },
  { label: "v2 without grid", params: NO_GRID },
  { label: "v2 (defaults)", params: {} },
];

// ---------- 1. history ----------

/** The driver on top of the final table (countback included). */
export function seasonChampion(state: SeasonState): string {
  return driverStatus(state)[0]!.driver;
}

export interface TitleRow {
  season: number;
  champion: string;
  model: string;
  /** the model's chance for the champion after each round, from round 8 to the round before the last */
  rounds: { round: number; p: number; favourite: boolean }[];
  meanP: number;
  /** mean of -ln p, with p never below half a simulation */
  meanLogLoss: number;
}

const mean = (xs: readonly number[]) => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

export function titleCheck(seasons: readonly SeasonState[], nSims = TITLE_SIMS, models: readonly TitleModel[] = TITLE_MODELS): TitleRow[] {
  const floor = 0.5 / nSims;
  const rows: TitleRow[] = [];
  for (const season of seasons) {
    const champion = seasonChampion(season);
    for (const model of models) {
      const rounds: TitleRow["rounds"] = [];
      for (let round = FIRST_TITLE_ROUND; round < season.asOfRound; round++) {
        const odds = computeOdds(stateBefore(season, round + 1), undefined, { nSims, ...model.params });
        const own = odds.wdc.find((r) => r.id === champion);
        const best = Math.max(...odds.wdc.map((r) => r.probability));
        const p = own?.probability ?? 0;
        rounds.push({ round, p: Math.max(p, floor), favourite: p > 0 && p >= best });
      }
      rows.push({
        season: season.season,
        champion,
        model: model.label,
        rounds,
        meanP: mean(rounds.map((r) => r.p)),
        meanLogLoss: mean(rounds.map((r) => -Math.log(r.p))),
      });
    }
  }
  return rows;
}

export interface PooledTitleRow {
  label: string;
  /** forecasts pooled (rounds x seasons) */
  n: number;
  meanP: number;
  meanLogLoss: number;
  /** share of those forecasts where the eventual champion was the model's favourite */
  favouriteShare: number;
}

export function pooledTitleRows(rows: readonly TitleRow[]): PooledTitleRow[] {
  const labels = [...new Set(rows.map((r) => r.model))];
  return labels.map((label) => {
    const all = rows.filter((r) => r.model === label).flatMap((r) => r.rounds);
    return {
      label,
      n: all.length,
      meanP: mean(all.map((r) => r.p)),
      meanLogLoss: mean(all.map((r) => -Math.log(r.p))),
      favouriteShare: all.length === 0 ? Number.NaN : all.filter((r) => r.favourite).length / all.length,
    };
  });
}

function table(rows: string[][], leftCols = 1): string[] {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows.map((r) => "  " + r.map((cell, c) => (c < leftCols ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join("  "));
}

const pct = (p: number) => (Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : "-");

export function formatTitleCheck(rows: readonly TitleRow[]): string {
  const shown = [8, 12, 16, 20];
  const lines: string[] = [];
  lines.push("=== Title odds against the real champions (history seasons) ===");
  lines.push("Title odds cannot be calibrated: each season has one champion, so this is a description, not a test. For every round");
  lines.push(`from ${FIRST_TITLE_ROUND} to the round before the last, the chance the model gave the driver who then won the title.`);
  lines.push("");
  lines.push(
    ...table(
      [
        ["season", "champion", "model", ...shown.map((r) => `R${r}`), "mean P", "mean -ln p"],
        ...rows.map((r) => [
          String(r.season),
          r.champion,
          r.model,
          ...shown.map((n) => pct(r.rounds.find((x) => x.round === n)?.p ?? Number.NaN)),
          pct(r.meanP),
          r.meanLogLoss.toFixed(3),
        ]),
      ],
      3,
    ),
  );
  lines.push("");
  lines.push("Pooled over every forecast above:");
  lines.push(
    ...table(
      [
        ["model", "forecasts", "mean P(champion)", "mean -ln p", "champion was favourite"],
        ...pooledTitleRows(rows).map((p) => [p.label, String(p.n), pct(p.meanP), p.meanLogLoss.toFixed(3), pct(p.favouriteShare)]),
      ],
      1,
    ),
  );
  lines.push("");
  lines.push("Higher mean P and lower mean -ln p mean the model was less surprised. The rounds of one season are not independent");
  lines.push("(the same title race is counted many times), so a small gap between models means nothing.");
  return lines.join("\n");
}

// ---------- 2. what-if sensitivity ----------

/** `out` is out of the next `races` race sessions and `winner` wins each of them. */
export function whatIfScenario(state: SeasonState, out: string, winner: string, races: number): Scenario {
  const keys = remainingSessions(state).filter((k) => k.endsWith(":race")).slice(0, races);
  return { locks: Object.fromEntries(keys.map((k) => [k, { fixed: { [out]: "out" as const, [winner]: 1 } }])) as Scenario["locks"] };
}

export interface WhatIfRow {
  label: string;
  /** the winner's title chance with nothing locked */
  base: number;
  /** the winner's title chance in the what-if */
  whatIf: number;
}

const WHAT_IF_MODELS: readonly TitleModel[] = [
  { label: "v1", params: V1_PARAMS },
  { label: "v1, half-life 8", params: { ...V1_PARAMS, recencyHalfLife: 8 } },
  { label: "v2 without grid", params: NO_GRID },
  { label: "v2 (defaults)", params: {} },
];

export function whatIfTable(state: SeasonState, out = "ANT", winner = "RUS", races = 4, nSims = 20_000): WhatIfRow[] {
  const scenario = whatIfScenario(state, out, winner, races);
  const chance = (params: Partial<OddsParams>, s?: Scenario) =>
    computeOdds(state, s, { nSims, ...params }).wdc.find((r) => r.id === winner)?.probability ?? 0;
  return WHAT_IF_MODELS.map((m) => ({ label: m.label, base: chance(m.params), whatIf: chance(m.params, scenario) }));
}

export function formatWhatIf(rows: readonly WhatIfRow[], out = "ANT", winner = "RUS", races = 4): string {
  return [
    `=== What-if: ${out} out of the next ${races} races, ${winner} wins all ${races} ===`,
    `${winner}'s chance of the title, with nothing locked and in the what-if:`,
    "",
    ...table([["model", "no locks", "what-if"], ...rows.map((r) => [r.label, formatProbability(r.base), formatProbability(r.whatIf)])]),
    "",
    "One reading of a close contest, not a measurement: it moves with how old results are weighed and with the grid.",
  ].join("\n");
}

// ---------- the script ----------

function readSeason(path: string): SeasonState {
  return path.endsWith(".json") ? (JSON.parse(readFileSync(path, "utf8")) as SeasonState) : loadSeason(path);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string) => args.find((_, i) => args[i - 1] === name);
  const nSims = arg("--sims") ? Number(arg("--sims")) : TITLE_SIMS;
  const historyDir = arg("--history") ?? join(import.meta.dir, "..", "..", "F1GStats", "history");
  const seasonPath = arg("--season") ?? join(import.meta.dir, "..", "tests", "fixtures", "season-2026-r16.json");
  if (!Number.isInteger(nSims) || nSims < 1) {
    console.error("--sims needs a whole number of 1 or more");
    process.exit(1);
  }
  if (!existsSync(seasonPath)) {
    console.error(`File not found: ${seasonPath}`);
    process.exit(1);
  }

  console.log(formatWhatIf(whatIfTable(readSeason(seasonPath), "ANT", "RUS", 4, Math.max(nSims, 20_000))));
  console.log("");

  const { loaded, skipped } = loadSeasons(historyDir, HISTORY_SEASONS);
  if (skipped.length > 0 || loaded.length === 0) {
    const why = skipped.map((s) => `${s.season} (${s.reason})`).join(", ") || `no files in ${historyDir}`;
    console.log(`Title odds against the real champions: skipped, history not available: ${why}.`);
  } else {
    console.log(`Running ${nSims} simulations per forecast over ${loaded.length} history seasons...\n`);
    console.log(formatTitleCheck(titleCheck(loaded, nSims)));
  }
}
