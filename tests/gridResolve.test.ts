/**
 * Phase 8, Step 2: which starting grid is in use (engine/grid.ts: resolveGrid and its helpers). Pure, no files.
 * Field: AAA BBB (red), CCC DDD (blue). Round 2 is the latest completed race and DDD is not in it, so DDD is not racing.
 * Round 3 is the next race.
 */
import { describe, expect, test } from "bun:test";
import { gridSourceKind, gridToOrder, nextScheduledRound, resolveGrid } from "../engine/grid";
import type { SeasonState } from "../engine/types";
import { makeState } from "./helpers";

const base = (extra: Partial<Parameters<typeof makeState>[0]> = {}): SeasonState =>
  makeState({
    rounds: 4,
    sprints: [3],
    completed: 2,
    teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
    results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC"] },
    ...extra,
  });

const allRaced = (): SeasonState =>
  base({
    completed: 4,
    results: {
      "1:race": ["AAA", "BBB", "CCC", "DDD"],
      "2:race": ["AAA", "BBB", "CCC"],
      "3:sprint": ["AAA", "BBB", "CCC"],
      "3:race": ["AAA", "BBB", "CCC"],
      "4:race": ["AAA", "BBB", "CCC"],
    },
  });

const withGrid = (state: SeasonState, grid: Record<string, number>, source: string, round = 3): SeasonState => ({
  ...state,
  upcomingGrid: { round, grid, source },
});

const openF1 = (state = base()) => withGrid(state, { BBB: 1, AAA: 2, CCC: 3 }, "openf1");

describe("gridSourceKind", () => {
  test("only a grid entirely from OpenF1 is openf1", () => {
    expect(gridSourceKind("openf1")).toBe("openf1");
    expect(gridSourceKind(" OpenF1 ")).toBe("openf1");
    expect(gridSourceKind("openf1, openf1")).toBe("openf1");
  });

  test("the qualifying fallback, a mix, an empty or an unknown text all count as qualifying", () => {
    for (const text of ["qualifying", "qualifying_fallback", "openf1, qualifying_fallback", "", "projected", "manual"]) {
      expect(gridSourceKind(text)).toBe("qualifying");
    }
  });
});

describe("gridToOrder", () => {
  test("by place; two drivers on one place by code", () => {
    expect(gridToOrder({ CCC: 3, AAA: 1, BBB: 2 })).toEqual(["AAA", "BBB", "CCC"]);
    expect(gridToOrder({ CCC: 3, BBB: 3, AAA: 1 })).toEqual(["AAA", "BBB", "CCC"]);
    expect(gridToOrder({})).toEqual([]);
  });
});

describe("nextScheduledRound", () => {
  test("is the lowest scheduled round", () => {
    expect(nextScheduledRound(base())).toBe(3);
    expect(nextScheduledRound(base({ completed: 0 }))).toBe(1);
  });

  test("is null when the season is over", () => {
    expect(nextScheduledRound(allRaced())).toBeNull();
  });
});

describe("resolveGrid: no manual grid", () => {
  test("nothing known: no grid, and the very same state comes back", () => {
    const state = base();
    const r = resolveGrid(state, null);
    expect(r.state).toBe(state);
    expect(r).toMatchObject({ round: 3, effective: null, data: null, overrideValid: null, differs: false });
  });

  test("the data file's qualifying grid is in use, in start order, with no pit-lane list", () => {
    const state = withGrid(base(), { CCC: 1, AAA: 2, BBB: 3 }, "qualifying_fallback");
    const r = resolveGrid(state, null);
    expect(r.state).toBe(state);
    expect(r.effective).toEqual({ order: ["CCC", "AAA", "BBB"], pit: [], source: "qualifying" });
    expect(r.data).toEqual({ source: "qualifying", order: ["CCC", "AAA", "BBB"] });
  });

  test("an OpenF1 grid is reported as openf1", () => {
    const r = resolveGrid(openF1(), null);
    expect(r.effective).toEqual({ order: ["BBB", "AAA", "CCC"], pit: [], source: "openf1" });
    expect(r.data?.source).toBe("openf1");
  });

  test("a grid for some other round is not this race's grid", () => {
    const r = resolveGrid(withGrid(base(), { AAA: 1, BBB: 2, CCC: 3 }, "openf1", 4), null);
    expect(r.data).toBeNull();
    expect(r.effective).toBeNull();
  });

  test("season over: no round, no grid, even with a manual grid", () => {
    const over = allRaced();
    const r = resolveGrid(over, { order: ["AAA"], pit: [] });
    expect(r).toMatchObject({ round: null, effective: null, data: null, overrideValid: null, differs: false });
    expect(r.state).toBe(over);
  });
});

describe("resolveGrid: a manual grid", () => {
  const manual = { order: ["AAA", "CCC"], pit: ["BBB"] };

  test("replaces upcomingGrid, with source manual and the pit-lane starters last", () => {
    const r = resolveGrid(openF1(), manual);
    expect(r.state.upcomingGrid).toEqual({ round: 3, grid: { AAA: 1, CCC: 2, BBB: 3 }, source: "manual" });
    expect(r.effective).toEqual({ order: ["AAA", "CCC"], pit: ["BBB"], source: "manual" });
    expect(r.overrideValid).toBe(true);
  });

  test("works when the data file has no grid at all", () => {
    const r = resolveGrid(base(), manual);
    expect(r.state.upcomingGrid?.source).toBe("manual");
    expect(r.data).toBeNull();
    expect(r.differs).toBe(false);
  });

  test("keeps what the data file has next to it, and does not modify the input state", () => {
    const state = openF1();
    const before = JSON.stringify(state);
    const r = resolveGrid(state, manual);
    expect(r.data).toEqual({ source: "openf1", order: ["BBB", "AAA", "CCC"] });
    expect(r.state).not.toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  test("the rest of the season is untouched", () => {
    const state = openF1();
    const r = resolveGrid(state, manual);
    expect({ ...r.state, upcomingGrid: undefined }).toEqual({ ...state, upcomingGrid: undefined });
  });

  test("a sprint result of the round does not stop it: the sprint runs before the race", () => {
    const sprintDone = openF1(base({ results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC"], "3:sprint": ["AAA", "BBB", "CCC"] } }));
    expect(resolveGrid(sprintDone, manual).overrideValid).toBe(true);
  });

  test("a race result of the round stops it: the grid is history", () => {
    const raceDone = openF1(base({ results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["AAA", "BBB", "CCC"], "3:race": ["AAA", "BBB", "CCC"] } }));
    const r = resolveGrid(raceDone, manual);
    expect(r.overrideValid).toBeNull();
    expect(r.state).toBe(raceDone);
    expect(r.effective?.source).toBe("openf1");
  });
});

describe("resolveGrid: a manual grid that does not fit is ignored, not applied", () => {
  test("a driver is missing", () => {
    const state = openF1();
    const r = resolveGrid(state, { order: ["AAA", "BBB"], pit: [] });
    expect(r.overrideValid).toBe(false);
    expect(r.state).toBe(state);
    expect(r.effective).toEqual({ order: ["BBB", "AAA", "CCC"], pit: [], source: "openf1" });
    expect(r.differs).toBe(false);
  });

  test("a driver who is not racing is on it", () => {
    expect(resolveGrid(base(), { order: ["AAA", "BBB", "CCC", "DDD"], pit: [] }).overrideValid).toBe(false);
  });

  test("the drivers changed since it was saved", () => {
    expect(resolveGrid(base(), { order: ["AAA", "BBB", "ZZZ"], pit: [] }).overrideValid).toBe(false);
  });

  test("with no data grid either, nothing is in use", () => {
    const r = resolveGrid(base(), { order: ["AAA"], pit: [] });
    expect(r.overrideValid).toBe(false);
    expect(r.effective).toBeNull();
  });
});

describe("resolveGrid: differs", () => {
  test("true when a manual grid differs from OpenF1's", () => {
    expect(resolveGrid(openF1(), { order: ["AAA", "BBB", "CCC"], pit: [] }).differs).toBe(true);
  });

  test("false when it is the same grid", () => {
    expect(resolveGrid(openF1(), { order: ["BBB", "AAA", "CCC"], pit: [] }).differs).toBe(false);
  });

  test("false when it is the same grid and the last driver is in the pit lane list instead", () => {
    expect(resolveGrid(openF1(), { order: ["BBB", "AAA"], pit: ["CCC"] }).differs).toBe(false);
  });

  test("false when the data grid is only the qualifying order: there is no official grid to differ from", () => {
    const quali = withGrid(base(), { BBB: 1, AAA: 2, CCC: 3 }, "qualifying_fallback");
    expect(resolveGrid(quali, { order: ["AAA", "BBB", "CCC"], pit: [] }).differs).toBe(false);
  });

  test("false when there is no data grid or no manual grid", () => {
    expect(resolveGrid(base(), { order: ["AAA", "BBB", "CCC"], pit: [] }).differs).toBe(false);
    expect(resolveGrid(openF1(), null).differs).toBe(false);
  });
});
