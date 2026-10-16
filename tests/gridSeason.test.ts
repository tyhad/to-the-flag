/**
 * Phase 4, Step 8: the grid in the season simulation.
 *  - a known grid (`SeasonState.upcomingGrid`) is used for that race;
 *  - for later races the qualifying order is simulated from the same strengths (`qualifyingNoise`);
 *  - `gridWeight` 0 reproduces v2 exactly; `qualifyingNoise` 0 simulates no grid.
 */
import { describe, expect, test } from "bun:test";
import { computeOdds } from "../engine/odds";
import { defaultOddsParams, deriveSeed, simulateSeason, type OddsParams, type SimulationResult } from "../engine/simulate";
import { driverStatus } from "../engine/status";
import type { SeasonState, SessionKey, UpcomingGrid } from "../engine/types";
import { makeState } from "./helpers";

const teams4 = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
const order4 = ["AAA", "BBB", "CCC", "DDD"];
const races = (rounds: number[], order: string[] = order4) =>
  Object.fromEntries(rounds.map((r) => [`${r}:race`, order])) as Record<SessionKey, string[]>;
const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);
const avg = (res: SimulationResult, d: string) => res.driverPointSums[d]! / res.nSims;
const quick = (extra: Partial<OddsParams> = {}): Partial<OddsParams> => ({ nSims: 4000, seed: 3, includeDnf: false, ...extra });

const withGrid = (state: SeasonState, upcomingGrid: UpcomingGrid): SeasonState => ({ ...state, upcomingGrid });
const next: UpcomingGrid = { round: 5, grid: { AAA: 4, BBB: 3, CCC: 2, DDD: 1 }, source: "qualifying" };

// round 5 is the only race left; points are level so only that race decides who gains
const oneLeft = makeState({
  rounds: 5,
  completed: 4,
  teams: teams4,
  results: { ...races([1, 3]), ...races([2, 4], [...order4].reverse()) },
});
// four races left, uneven strengths
const fourLeft = makeState({ rounds: 8, completed: 4, teams: teams4, results: races([1, 2, 3, 4]) });

describe("grid in the season simulation: v2 is reproduced", () => {
  test("no upcomingGrid and gridWeight 0 give exactly the v2 numbers, whatever qualifyingNoise is", () => {
    const v2 = simulateSeason(fourLeft, undefined, quick());
    expect(simulateSeason(fourLeft, undefined, quick({ gridWeight: 0, qualifyingNoise: 1 }))).toEqual({
      ...v2,
      params: { ...v2.params, qualifyingNoise: 1 },
    });
    expect(simulateSeason(withGrid(fourLeft, { ...next, round: 5 }), undefined, quick({ gridWeight: 0 })).driverWins).toEqual(v2.driverWins);
  });

  test("with a weight but no known grid and qualifyingNoise 0, later races are simulated without a grid (v2)", () => {
    const v2 = simulateSeason(fourLeft, undefined, quick());
    const weighted = simulateSeason(fourLeft, undefined, quick({ gridWeight: 1, qualifyingNoise: 0 }));
    expect(weighted.driverWins).toEqual(v2.driverWins);
    expect(weighted.driverPointSums).toEqual(v2.driverPointSums);
    expect(weighted.gridKnownRound).toBeNull();
  });

  test("qualifyingNoise 0 and gridWeight 0 do not change the derived seed; other values do", () => {
    const { gridWeight: _g, qualifyingNoise: _q, ...old } = defaultOddsParams;
    expect(deriveSeed(fourLeft, undefined, defaultOddsParams)).toBe(deriveSeed(fourLeft, undefined, old as OddsParams));
    expect(deriveSeed(fourLeft, undefined, { ...defaultOddsParams, qualifyingNoise: 1 })).not.toBe(
      deriveSeed(fourLeft, undefined, defaultOddsParams),
    );
  });

  test("a negative, NaN or infinite qualifyingNoise is refused", () => {
    for (const qualifyingNoise of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => simulateSeason(fourLeft, undefined, { nSims: 5, qualifyingNoise })).toThrow(RangeError);
    }
  });
});

describe("grid in the season simulation: a known grid", () => {
  test("the front row gains points in that race and the back row loses them", () => {
    const base = { formWeight: 0, gridWeight: 1 };
    const flat = simulateSeason(oneLeft, undefined, quick(base));
    const known = simulateSeason(withGrid(oneLeft, next), undefined, quick(base));
    // DDD is on pole, AAA at the back
    expect(avg(known, "DDD")).toBeGreaterThan(avg(flat, "DDD") + 1);
    expect(avg(known, "AAA")).toBeLessThan(avg(flat, "AAA") - 1);
    expect(known.gridKnownRound).toBe(5);
    expect(flat.gridKnownRound).toBeNull();
  });

  test("a larger weight pushes the front row further", () => {
    const run = (gridWeight: number) =>
      avg(simulateSeason(withGrid(oneLeft, next), undefined, quick({ formWeight: 0, gridWeight })), "DDD");
    expect(run(0.5)).toBeGreaterThan(run(0));
    expect(run(1)).toBeGreaterThan(run(0.5));
    expect(run(2)).toBeGreaterThan(run(1));
  });

  test("a grid for a round that is not a remaining race is ignored", () => {
    const past = simulateSeason(withGrid(oneLeft, { ...next, round: 4 }), undefined, quick({ gridWeight: 1 }));
    const none = simulateSeason(oneLeft, undefined, quick({ gridWeight: 1 }));
    expect(past.driverPointSums).toEqual(none.driverPointSums);
    expect(past.gridKnownRound).toBeNull();
  });

  test("a driver missing from the grid and a pit-lane start are both last", () => {
    const opts = quick({ formWeight: 0, gridWeight: 1 });
    const pit = simulateSeason(withGrid(oneLeft, { ...next, grid: { AAA: 1, BBB: 2, CCC: 3, DDD: 4 } }), undefined, opts);
    const missing = simulateSeason(withGrid(oneLeft, { ...next, grid: { AAA: 1, BBB: 2, CCC: 3 } }), undefined, opts);
    const zero = simulateSeason(withGrid(oneLeft, { ...next, grid: { AAA: 1, BBB: 2, CCC: 3, DDD: 0 } }), undefined, opts);
    expect(missing.driverPointSums).toEqual(pit.driverPointSums);
    expect(zero.driverPointSums).toEqual(pit.driverPointSums);
  });

  test("the grid is used even when other drivers are locked in that race", () => {
    const scenario = { locks: { "5:race": { fixed: { BBB: 1 } } } } as const;
    const flat = simulateSeason(oneLeft, scenario, quick({ formWeight: 0, gridWeight: 1 }));
    const known = simulateSeason(withGrid(oneLeft, next), scenario, quick({ formWeight: 0, gridWeight: 1 }));
    expect(avg(known, "DDD")).toBeGreaterThan(avg(flat, "DDD"));
    expect(avg(known, "BBB")).toBe(avg(flat, "BBB")); // BBB's place is locked
  });
});

describe("grid in the season simulation: a simulated qualifying", () => {
  test("with a weight and some noise the best driver gains from the simulated grids", () => {
    const v2 = simulateSeason(fourLeft, undefined, quick({ gridWeight: 0 }));
    const gridded = simulateSeason(fourLeft, undefined, quick({ gridWeight: 1, qualifyingNoise: 0.5 }));
    expect(avg(gridded, "AAA")).toBeGreaterThan(avg(v2, "AAA"));
    expect(avg(gridded, "DDD")).toBeLessThan(avg(v2, "DDD"));
  });

  test("the result is reproducible by seed", () => {
    const a = simulateSeason(fourLeft, undefined, quick({ gridWeight: 1, qualifyingNoise: 1 }));
    const b = simulateSeason(fourLeft, undefined, quick({ gridWeight: 1, qualifyingNoise: 1 }));
    expect(a).toEqual(b);
  });

  test("a known grid replaces the simulated one for that race only", () => {
    // four races left, the first has a known grid; only round 5 reports it
    const res = simulateSeason(withGrid(fourLeft, next), undefined, quick({ gridWeight: 1, qualifyingNoise: 1 }));
    expect(res.gridKnownRound).toBe(5);
  });

  test("sprints get no grid", () => {
    const sprintState = makeState({ rounds: 6, sprints: [5], completed: 4, teams: teams4, results: races([1, 2, 3, 4]) });
    const a = simulateSeason(sprintState, { locks: { "5:race": { fixed: { AAA: 1, BBB: 2, CCC: 3, DDD: 4 } } } }, quick({ gridWeight: 1, qualifyingNoise: 0.5 }));
    const b = simulateSeason(sprintState, { locks: { "5:race": { fixed: { AAA: 1, BBB: 2, CCC: 3, DDD: 4 } } } }, quick({ gridWeight: 1, qualifyingNoise: 0.5 }));
    expect(a).toEqual(b);
    expect(sum(Object.values(a.driverWins))).toBe(a.nSims);
  });
});

describe("grid in the season simulation: the invariants still hold", () => {
  const mixed = makeState({ rounds: 6, completed: 3, teams: teams4, results: races([1, 2, 3]) });
  const clinched = makeState({ rounds: 6, completed: 5, teams: teams4, results: races([1, 2, 3, 4, 5]) });
  const params = { nSims: 3000, seed: 5, gridWeight: 1, qualifyingNoise: 1 };

  test("win counts sum to nSims for drivers and for teams, with and without a known grid", () => {
    for (const state of [mixed, withGrid(mixed, { ...next, round: 4 })]) {
      const res = simulateSeason(state, undefined, { ...params, includeDnf: true });
      expect(sum(Object.values(res.driverWins))).toBe(3000);
      expect(sum(Object.values(res.teamWins))).toBe(3000);
    }
  });

  test("eliminated drivers never win and clinched drivers always win", () => {
    for (const state of [mixed, withGrid(clinched, { ...next, round: 6 })]) {
      const res = simulateSeason(state, undefined, params);
      for (const row of driverStatus(state)) {
        if (row.status === "eliminated") expect(res.driverWins[row.driver]).toBe(0);
        if (row.status === "clinched") expect(res.driverWins[row.driver]).toBe(3000);
      }
    }
  });
});

describe("the odds say when the real grid was used", () => {
  test("gridKnownRound is on the odds result", () => {
    const withReal = computeOdds(withGrid(fourLeft, next), undefined, { nSims: 50, seed: 1, gridWeight: 1 });
    expect(withReal.gridKnownRound).toBe(5);
    expect(computeOdds(withGrid(fourLeft, next), undefined, { nSims: 50, seed: 1 }).gridKnownRound).toBeNull(); // weight 0
    expect(computeOdds(fourLeft, undefined, { nSims: 50, seed: 1, gridWeight: 1 }).gridKnownRound).toBeNull();
  });
});
