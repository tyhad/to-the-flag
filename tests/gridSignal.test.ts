/**
 * Phase 4, Step 7: the grid term in race forecasts.
 *   key = strength + gridWeight * (-ln(grid))   (gridWeight 0 = ignore the grid, the v2 behavior)
 */
import { describe, expect, test } from "bun:test";
import { defaultOddsParams, deriveSeed, forecastRace, gridTerm, simulateSeason, type OddsParams } from "../engine/simulate";
import { createRng } from "../engine/rng";
import type { SeasonState } from "../engine/types";
import { walkForward, scoreMethod } from "../scripts/backtest";
import {
  GRID_WEIGHTS,
  evaluateGridSignal,
  selectGridWeight,
  type CalibrationSeasons,
} from "../scripts/calibrate";
import { makeState } from "./helpers";

const teams4 = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
const order4 = ["AAA", "BBB", "CCC", "DDD"];
const state = makeState({
  rounds: 8,
  completed: 4,
  teams: teams4,
  results: Object.fromEntries([1, 2, 3, 4].map((r) => [`${r}:race`, order4])),
});
const quick = { nSims: 6000, seed: 7 };
const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);
const front: Record<string, number> = { AAA: 1, BBB: 2, CCC: 3, DDD: 4 };

describe("gridTerm", () => {
  test("is -ln(position): pole is 0, lower places are more negative", () => {
    expect(gridTerm(1, 20)).toBeCloseTo(0, 12);
    expect(gridTerm(2, 20)).toBeCloseTo(-Math.log(2), 12);
    expect(gridTerm(10, 20)).toBeLessThan(gridTerm(3, 20));
  });

  test("a pit-lane start (stored as the field size), a missing grid and a nonsense grid are all last", () => {
    const last = gridTerm(20, 20);
    expect(gridTerm(undefined, 20)).toBe(last);
    expect(gridTerm(0, 20)).toBe(last);
    expect(gridTerm(-3, 20)).toBe(last);
    expect(gridTerm(Number.NaN, 20)).toBe(last);
    expect(gridTerm(25, 20)).toBe(last); // beyond the field: clamped, never worse than last
  });
});

describe("gridWeight in forecastRace", () => {
  test("the default is 1, the weight adopted at Step 7", () => {
    expect(defaultOddsParams.gridWeight).toBe(1);
  });

  test("gridWeight 0 reproduces v2 exactly, with or without a grid", () => {
    const v2 = forecastRace(state, { ...quick, gridWeight: 0 });
    expect(forecastRace(state, { ...quick, gridWeight: 0 }, undefined, front)).toEqual(v2);
    // a weight without a grid leaves the forecast alone (there is nothing to weigh)
    expect(forecastRace(state, quick)).toEqual(v2);
    expect(forecastRace(state, { ...quick, gridWeight: 1 })).toEqual(v2);
    // and with the default weight a grid does change it
    expect(forecastRace(state, quick, undefined, front)).not.toEqual(v2);
  });

  test("gridWeight 0 does not change the derived seed (so the v2 golden snapshots stay valid)", () => {
    const scenario = { locks: { "5:race": { fixed: { AAA: 1 } } } };
    const off: OddsParams = { ...defaultOddsParams, gridWeight: 0 };
    const { gridWeight: _ignored, ...without } = off;
    expect(deriveSeed(state, scenario, off)).toBe(deriveSeed(state, scenario, without as OddsParams));
    expect(deriveSeed(state, scenario, { ...off, gridWeight: 0.5 })).not.toBe(deriveSeed(state, scenario, off));
  });

  test("the season simulation is unchanged by gridWeight (the grid is not used there yet)", () => {
    const base = simulateSeason(state, undefined, { nSims: 200, seed: 11 });
    const weighted = simulateSeason(state, undefined, { nSims: 200, seed: 11, gridWeight: 1 });
    expect(weighted.driverWins).toEqual(base.driverWins);
    expect(weighted.driverPointSums).toEqual(base.driverPointSums);
  });

  test("a larger weight raises the front row's chance and lowers the back row's", () => {
    // formWeight 0 makes every driver equal, so only the grid separates them
    const run = (gridWeight: number) =>
      forecastRace(state, { ...quick, formWeight: 0, includeDnf: false, gridWeight }, undefined, front);
    const w0 = run(0);
    const w05 = run(0.5);
    const w1 = run(1);
    const w2 = run(2);
    expect(w0.win.AAA!).toBeCloseTo(0.25, 1);
    expect(w05.win.AAA!).toBeGreaterThan(w0.win.AAA!);
    expect(w1.win.AAA!).toBeGreaterThan(w05.win.AAA!);
    expect(w2.win.AAA!).toBeGreaterThan(w1.win.AAA!);
    expect(w2.win.DDD!).toBeLessThan(w1.win.DDD!);
    expect(w1.win.DDD!).toBeLessThan(w0.win.DDD!);
    // still a proper distribution without retirements
    expect(sum(Object.values(w1.win))).toBeCloseTo(1, 12);
    expect(sum(Object.values(w1.podium))).toBeCloseTo(3, 12);
  });

  test("the grid helps the front row even when pace is known (a pole sitter beats a slower rival)", () => {
    // AAA is the fastest driver in `state`; give AAA the back of the grid and BBB pole
    const swapped = { AAA: 4, BBB: 1, CCC: 3, DDD: 2 };
    const ignore = forecastRace(state, { ...quick, includeDnf: false, gridWeight: 0 }, undefined, swapped);
    const use = forecastRace(state, { ...quick, includeDnf: false, gridWeight: 1 }, undefined, swapped);
    expect(use.win.BBB!).toBeGreaterThan(ignore.win.BBB!);
    expect(use.win.AAA!).toBeLessThan(ignore.win.AAA!);
  });

  test("a pit-lane start is treated as last", () => {
    const opts = { ...quick, formWeight: 0, includeDnf: false, gridWeight: 1 };
    const explicitLast = forecastRace(state, opts, undefined, { AAA: 1, BBB: 2, CCC: 3, DDD: 4 });
    const pitLane = forecastRace(state, opts, undefined, { AAA: 1, BBB: 2, CCC: 3, DDD: 0 }); // raw Ergast 0
    const missing = forecastRace(state, opts, undefined, { AAA: 1, BBB: 2, CCC: 3 });
    expect(pitLane).toEqual(explicitLast);
    expect(missing).toEqual(explicitLast);
    // and the last place is worse than fourth-in-line would be if the others moved up
    const gridBack = forecastRace(state, opts, undefined, { AAA: 4, BBB: 1, CCC: 2, DDD: 3 });
    expect(explicitLast.win.DDD!).toBeLessThan(gridBack.win.DDD!);
  });

  test("a negative, NaN or infinite weight is refused", () => {
    for (const gridWeight of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => forecastRace(state, { ...quick, gridWeight })).toThrow(RangeError);
      expect(() => simulateSeason(state, undefined, { nSims: 5, gridWeight })).toThrow(RangeError);
    }
  });
});

// ---------- synthetic seasons with a real grid effect ----------

const DRIVERS = ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"];
const SYN_TEAMS = { a: ["A1", "A2"], b: ["B1", "B2"], c: ["C1", "C2"], d: ["D1", "D2"] };
const SPREAD: Record<string, number> = { A1: 0.6, A2: 0.4, B1: 0.2, B2: 0, C1: -0.2, C2: -0.4, D1: -0.6, D2: -0.8 };

/**
 * A season where the race order depends on pace and on the grid:
 *   qualifying key = pace + Gumbel (grid = order of that key)
 *   race key       = pace + trueGridWeight * (-ln(grid)) + Gumbel
 * With trueGridWeight 0 the grid carries no information about the race.
 */
function gridSeason(season: number, seed: number, trueGridWeight: number, rounds = 10): SeasonState {
  const rng = createRng(seed);
  const results: Record<string, { order: string[]; grid: Record<string, number> }> = {};
  for (let r = 1; r <= rounds; r++) {
    const q = DRIVERS.map((d) => ({ d, key: SPREAD[d]! + rng.gumbel() })).sort((x, y) => y.key - x.key);
    const grid: Record<string, number> = {};
    q.forEach((x, i) => (grid[x.d] = i + 1));
    const race = DRIVERS.map((d) => ({ d, key: SPREAD[d]! + trueGridWeight * -Math.log(grid[d]!) + rng.gumbel() })).sort(
      (x, y) => y.key - x.key,
    );
    results[`${r}:race`] = { order: race.map((x) => x.d), grid };
  }
  return makeState({ season, rounds, completed: rounds, teams: SYN_TEAMS, results });
}

function gridSeasons(trueGridWeight: number, base: number): CalibrationSeasons {
  const years = [2022, 2023, 2024, 2025, 2026];
  const all = years.map((y, i) => gridSeason(y, base + i * 101, trueGridWeight));
  return { training: all.slice(0, 3), validation: all[3]!, confirmation: all[4]!, all };
}

describe("walkForward with the grid", () => {
  const season = gridSeason(2024, 5, 1);

  test("gridWeight 0 gives the same forecasts as before the grid existed", () => {
    // with weight 0 the grid is not looked at: scrambling every grid changes nothing
    const scrambled: SeasonState = { ...season, results: season.results.map((r) => ({ ...r, grid: DRIVERS.length + 1 - r.grid })) };
    const a = walkForward(season, { nSims: 500, gridWeight: 0 }, 6);
    const b = walkForward(scrambled, { nSims: 500, gridWeight: 0 }, 6);
    expect(b.map((r) => r.forecasts.model)).toEqual(a.map((r) => r.forecasts.model));
  });

  test("with a weight, the forecast of a round uses that round's actual grid", () => {
    const base = walkForward(season, { nSims: 800, gridWeight: 1 }, 6);
    const record = base.find((r) => r.round === 6)!;
    const poleSitter = season.results.find((r) => r.round === 6 && r.kind === "race" && r.grid === 1)!.driver;
    const backMarker = season.results.find((r) => r.round === 6 && r.kind === "race" && r.grid === DRIVERS.length)!.driver;
    expect(record.forecasts.model.win[poleSitter]!).toBeGreaterThan(record.forecasts.model.win[backMarker]!);
    const flat = walkForward(season, { nSims: 800, gridWeight: 0 }, 6).find((r) => r.round === 6)!;
    expect(record.forecasts.model.win[poleSitter]!).toBeGreaterThan(flat.forecasts.model.win[poleSitter]!);
  });

  test("there is no future leakage: the grid of a later round never changes an earlier forecast", () => {
    const before = walkForward(season, { nSims: 500, gridWeight: 1 }, 6);
    const scrambled: SeasonState = {
      ...season,
      results: season.results.map((r) => (r.round >= 8 ? { ...r, grid: DRIVERS.length + 1 - r.grid } : r)),
    };
    const after = walkForward(scrambled, { nSims: 500, gridWeight: 1 }, 6);
    for (const round of [6, 7]) {
      expect(after.find((r) => r.round === round)!.forecasts.model).toEqual(before.find((r) => r.round === round)!.forecasts.model);
    }
  });

  test("when the grid really matters, using it scores better", () => {
    const pooled = [1, 2, 3, 4].flatMap((i) => {
      const s = gridSeason(2022 + i, 40 + i, 1.2, 12);
      return [
        { off: walkForward(s, { nSims: 1500, gridWeight: 0 }, 6), on: walkForward(s, { nSims: 1500, gridWeight: 1 }, 6) },
      ];
    });
    const loss = (rs: ReturnType<typeof walkForward>) => {
      const s = scoreMethod(rs, "model");
      return s.winLogLoss + s.podiumLogLoss;
    };
    const off = loss(pooled.flatMap((p) => p.off));
    const on = loss(pooled.flatMap((p) => p.on));
    expect(on).toBeLessThan(off);
  });
});

describe("selectGridWeight and evaluateGridSignal", () => {
  test("selectGridWeight takes the lowest training loss and prefers the smaller weight on a tie", () => {
    const diffs = new Map([
      [0.25, -0.01],
      [0.5, -0.03],
      [0.75, -0.03],
      [1, -0.02],
    ]);
    expect(selectGridWeight(diffs)).toBe(0.5);
  });

  test("selectGridWeight returns 0 when no weight beats ignoring the grid on training", () => {
    expect(
      selectGridWeight(
        new Map([
          [0.25, 0.002],
          [0.5, 0.01],
        ]),
      ),
    ).toBe(0);
    expect(selectGridWeight(new Map())).toBe(0);
    expect(selectGridWeight(new Map([[0.25, 0]]))).toBe(0);
  });

  test("the weights tried are the coarse grid from the task list", () => {
    expect([...GRID_WEIGHTS]).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  test("when the grid matters, a positive weight is chosen on the training seasons", () => {
    const result = evaluateGridSignal(gridSeasons(1.2, 900), 600);
    expect(result.selected).toBeGreaterThan(0);
    const chosen = result.candidates.find((c) => c.weight === result.selected)!;
    expect(chosen.comparison.trainingComp.meanDiff).toBeLessThan(0);
    expect(result.verdict).not.toBeNull();
  });

  test("when the grid carries no information, the grid signal is not adopted", () => {
    const result = evaluateGridSignal(gridSeasons(0, 1700), 600);
    expect(result.verdict?.adopt ?? false).toBe(false);
  });

  test("the baseline is gridWeight 0 and is never listed as a candidate", () => {
    const result = evaluateGridSignal(gridSeasons(0.5, 300), 300);
    expect(result.baseline.params.gridWeight).toBe(0);
    expect(result.candidates.map((c) => c.weight)).toEqual([0.25, 0.5, 0.75, 1]);
  });
});
