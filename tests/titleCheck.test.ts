/**
 * Phase 4, Step 9: title-level sanity checks. Four champions cannot calibrate a title probability, so these only
 * describe: what chance the model gave the driver who actually won, round by round, pooled; and how much the
 * "ANT out of four races, RUS wins four" what-if moves under v1 and v2.
 */
import { describe, expect, test } from "bun:test";
import { createRng } from "../engine/rng";
import type { SeasonState } from "../engine/types";
import {
  FIRST_TITLE_ROUND,
  TITLE_MODELS,
  formatTitleCheck,
  formatWhatIf,
  pooledTitleRows,
  seasonChampion,
  titleCheck,
  whatIfScenario,
  whatIfTable,
} from "../scripts/titleCheck";
import { makeState } from "./helpers";

const DRIVERS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const TEAMS = { a: ["A1", "A2"], b: ["B1", "B2"], c: ["C1", "C2"] };
const PACE: Record<string, number> = { A1: 1.5, A2: 0.5, B1: 0, B2: -0.5, C1: -1, C2: -1.5 };

/** A season where A1 is clearly fastest; races follow pace plus Gumbel noise. */
function season(year: number, seed: number, rounds = 12): SeasonState {
  const rng = createRng(seed);
  const results: Record<string, { order: string[]; grid: Record<string, number> }> = {};
  for (let r = 1; r <= rounds; r++) {
    const q = DRIVERS.map((d) => ({ d, k: PACE[d]! + 2 * rng.gumbel() })).sort((a, b) => b.k - a.k);
    const grid: Record<string, number> = {};
    q.forEach((x, i) => (grid[x.d] = i + 1));
    const race = DRIVERS.map((d) => ({ d, k: PACE[d]! + rng.gumbel() })).sort((a, b) => b.k - a.k);
    results[`${r}:race`] = { order: race.map((x) => x.d), grid };
  }
  return makeState({ season: year, rounds, completed: rounds, teams: TEAMS, results });
}

describe("seasonChampion", () => {
  test("is the driver on top of the final table", () => {
    const s = season(2024, 1);
    const champion = seasonChampion(s);
    expect(DRIVERS).toContain(champion);
    // nobody has more points
    const points = new Map<string, number>();
    for (const r of s.results) points.set(r.driver, (points.get(r.driver) ?? 0) + r.points);
    expect(points.get(champion)).toBe(Math.max(...points.values()));
  });
});

describe("titleCheck", () => {
  const seasons = [season(2022, 11), season(2023, 12)];
  const rows = titleCheck(seasons, 400);

  test("one row per season and model, from round 8 to the round before the last", () => {
    expect(rows.length).toBe(seasons.length * TITLE_MODELS.length);
    expect(FIRST_TITLE_ROUND).toBe(8);
    for (const row of rows) {
      expect(row.rounds.map((r) => r.round)).toEqual([8, 9, 10, 11]); // 12 rounds: the last one is not a forecast
    }
  });

  test("every probability is in (0, 1] and the champion is named", () => {
    for (const row of rows) {
      expect(DRIVERS).toContain(row.champion);
      for (const r of row.rounds) {
        expect(r.p).toBeGreaterThan(0);
        expect(r.p).toBeLessThanOrEqual(1);
      }
      expect(row.meanP).toBeGreaterThan(0);
      expect(row.meanLogLoss).toBeGreaterThanOrEqual(0);
    }
  });

  test("a clearly fastest champion is the favourite late in the season", () => {
    for (const row of rows.filter((r) => r.champion === "A1")) {
      expect(row.rounds.at(-1)!.p).toBeGreaterThan(0.5);
    }
  });

  test("the same inputs give the same numbers", () => {
    expect(titleCheck(seasons, 400)).toEqual(rows);
  });

  test("pooled rows have one entry per model with a mean over every round", () => {
    const pooled = pooledTitleRows(rows);
    expect(pooled.map((p) => p.label)).toEqual(TITLE_MODELS.map((m) => m.label));
    for (const p of pooled) {
      expect(p.n).toBe(seasons.length * 4);
      expect(p.meanP).toBeGreaterThan(0);
      expect(p.favouriteShare).toBeGreaterThanOrEqual(0);
      expect(p.favouriteShare).toBeLessThanOrEqual(1);
    }
  });

  test("the report says it is a sanity check, not a calibration", () => {
    const text = formatTitleCheck(rows);
    expect(text).toContain("cannot be calibrated");
    expect(text).toContain("2022");
    expect(text).toContain("v1");
  });
});

describe("whatIfScenario and whatIfTable", () => {
  const state = makeState({
    rounds: 10, completed: 4, teams: TEAMS,
    results: Object.fromEntries([1, 2, 3, 4].map((r) => [`${r}:race`, ["A1", "B1", "A2", "B2", "C1", "C2"]])),
  });

  test("locks the next four races: the out driver is out and the winner wins", () => {
    const s = whatIfScenario(state, "A1", "B1", 4);
    expect(Object.keys(s.locks)).toEqual(["5:race", "6:race", "7:race", "8:race"]);
    expect(s.locks["5:race"]).toEqual({ fixed: { A1: "out", B1: 1 } });
  });

  test("skips sprints: only race sessions count as races", () => {
    const withSprint = makeState({ rounds: 10, sprints: [5], completed: 4, teams: TEAMS, results: Object.fromEntries([1, 2, 3, 4].map((r) => [`${r}:race`, DRIVERS])) });
    const s = whatIfScenario(withSprint, "A1", "B1", 2);
    expect(Object.keys(s.locks)).toEqual(["5:race", "6:race"]);
  });

  test("the what-if raises the winner's title chance under every model", () => {
    const table = whatIfTable(state, "A1", "B1", 4, 2000);
    expect(table.map((r) => r.label)).toEqual(["v1", "v1, half-life 8", "v2 without grid", "v2 (defaults)"]);
    for (const row of table) {
      expect(row.whatIf).toBeGreaterThan(row.base);
      expect(row.base).toBeGreaterThanOrEqual(0);
      expect(row.whatIf).toBeLessThanOrEqual(1);
    }
    expect(formatWhatIf(table, "A1", "B1", 4)).toContain("v2 (defaults)");
  });
});
