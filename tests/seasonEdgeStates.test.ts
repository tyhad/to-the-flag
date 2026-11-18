/**
 * Phase 10, Step 1 (D60): the two edge states of a season, "complete" (no session left to run) and "not started"
 * (no round has a result), built from the Round 16 snapshot with the helpers in tests/helpers.ts.
 * Nothing here may crash, divide by zero or print NaN.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCheckReport,
  computeConstructorStandings,
  computeDriverStandings,
  computeOdds,
  driverStatus,
  forecastRace,
  formatCheckReport,
  isSeasonComplete,
  remainingSessions,
  seasonPhase,
  solveWcc,
  solveWdc,
  teamStatus,
  type SeasonState,
} from "../engine";
import { completeSeasonFrom, makeState, notStartedFrom } from "./helpers";

const real = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const complete = completeSeasonFrom(real);
const notStarted = notStartedFrom(real);
const noDrivers: SeasonState = { ...notStarted, drivers: [] };

/** Every number anywhere in `value` is finite (JSON.stringify would hide a NaN as null). */
function nonFinite(value: unknown, path = "$"): string[] {
  if (typeof value === "number") return Number.isFinite(value) ? [] : [`${path}=${value}`];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => nonFinite(item, `${path}.${key}`));
  }
  return [];
}

describe("helpers build the two states without touching the snapshot", () => {
  test("complete: every session has a result, 23 rounds done, same drivers and teams", () => {
    expect(remainingSessions(complete)).toEqual([]);
    expect(complete.asOfRound).toBe(23);
    expect(complete.rounds.every((r) => r.status === "completed")).toBe(true);
    expect(complete.results.filter((r) => r.kind === "race")).toHaveLength(23 * 22);
    expect(complete.results.filter((r) => r.kind === "sprint")).toHaveLength(6 * 22);
    expect(complete.teams).toEqual(real.teams);
  });

  test("not started: no result, no qualifying, round 0, every round scheduled", () => {
    expect(notStarted.asOfRound).toBe(0);
    expect(notStarted.results).toEqual([]);
    expect(notStarted.qualifying).toEqual([]);
    expect(notStarted.rounds.every((r) => r.status === "scheduled")).toBe(true);
    expect(remainingSessions(notStarted)).toHaveLength(29);
  });

  test("the snapshot itself is unchanged", () => {
    expect(real.asOfRound).toBe(16);
    expect(real.results).toHaveLength(462);
    expect(remainingSessions(real)).toHaveLength(8);
  });
});

describe("seasonPhase", () => {
  test("the three phases", () => {
    expect(seasonPhase(real)).toBe("running");
    expect(seasonPhase(complete)).toBe("complete");
    expect(seasonPhase(notStarted)).toBe("not-started");
    expect(isSeasonComplete(complete)).toBe(true);
    expect(isSeasonComplete(real)).toBe(false);
    expect(isSeasonComplete(notStarted)).toBe(false);
  });

  test("a calendar with no round is not started, never complete", () => {
    expect(seasonPhase({ ...notStarted, rounds: [] })).toBe("not-started");
  });

  test("a sprint already run on the weekend of the next race is still a running season", () => {
    const state = makeState({
      rounds: 2,
      sprints: [2],
      completed: 1,
      teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:sprint": ["BBB", "AAA", "CCC", "DDD"] },
    });
    expect(seasonPhase(state)).toBe("running");
  });

  test("one race left is running, none left is complete", () => {
    const oneLeft = makeState({
      rounds: 2,
      completed: 1,
      teams: { red: ["AAA", "BBB"] },
      results: { "1:race": ["AAA", "BBB"] },
    });
    expect(seasonPhase(oneLeft)).toBe("running");
    const done = makeState({
      rounds: 2,
      completed: 2,
      teams: { red: ["AAA", "BBB"] },
      results: { "1:race": ["AAA", "BBB"], "2:race": ["BBB", "AAA"] },
    });
    expect(seasonPhase(done)).toBe("complete");
  });
});

describe("season complete: the engine says the title is decided", () => {
  test("standings are final and the champion is clinched, everyone else is out", () => {
    const rows = driverStatus(complete);
    expect(rows[0]!.status).toBe("clinched");
    expect(rows[0]!.pointsToClinch).toBe(0);
    expect(rows.slice(1).every((r) => r.status === "eliminated" && r.pointsToClinch === null)).toBe(true);
    const teams = teamStatus(complete);
    expect(teams[0]!.status).toBe("clinched");
    expect(teams.slice(1).every((r) => r.status === "eliminated")).toBe(true);
  });

  test("the path of the champion needs nothing, the path of anyone else is closed", () => {
    const [champion, second] = computeDriverStandings(complete);
    const win = solveWdc(complete, champion!.id);
    expect(win.verdict).toBe("clinched");
    expect(win.pointsNeeded).toBe(0);
    expect(win.minWins).toEqual({ total: 0, races: 0, sprints: 0 });
    const lose = solveWdc(complete, second!.id);
    expect(lose.verdict).toBe("eliminated");
    expect(lose.minWins).toBeNull();
    expect(lose.easiest).toBeNull();

    const [leader, runnerUp] = computeConstructorStandings(complete);
    expect(solveWcc(complete, leader!.id).verdict).toBe("clinched");
    expect(solveWcc(complete, runnerUp!.id).verdict).toBe("eliminated");
  });

  test("odds are exact: 100% for the champion, none for anyone else, marked final", () => {
    const odds = computeOdds(complete, undefined, { nSims: 200 });
    expect(odds.final).toBe(true);
    expect(odds.wdc).toHaveLength(1);
    expect(odds.wdc[0]!.id).toBe(computeDriverStandings(complete)[0]!.id);
    expect(odds.wdc[0]!.probability).toBe(1);
    expect(odds.wdc[0]!.display).toBe("100%");
    expect(odds.wcc).toHaveLength(1);
    expect(odds.wcc[0]!.id).toBe(computeConstructorStandings(complete)[0]!.id);
    expect(odds.wcc[0]!.display).toBe("100%");
    expect(odds.maxStdError).toBe(0);
    expect(odds.lowConfidence).toBe(false);
  });

  test("odds of a running season are not final and never say 100%", () => {
    const odds = computeOdds(real, undefined, { nSims: 200 });
    expect(odds.final).toBeUndefined();
    expect(odds.wdc.every((r) => r.display !== "100%" && r.display !== "0%")).toBe(true);
  });

  test("no NaN or infinity anywhere", () => {
    const [champion] = computeDriverStandings(complete);
    const [leader] = computeConstructorStandings(complete);
    const everything = [
      computeDriverStandings(complete),
      computeConstructorStandings(complete),
      driverStatus(complete),
      teamStatus(complete),
      solveWdc(complete, champion!.id),
      solveWcc(complete, leader!.id),
      computeOdds(complete, undefined, { nSims: 100 }),
      buildCheckReport(complete),
    ];
    for (const item of everything) expect(nonFinite(item)).toEqual([]);
  });

  test("the check report names the final state in words", () => {
    const text = formatCheckReport(buildCheckReport(complete), "x.sqlite");
    expect(text).toContain("Season complete");
  });
});

describe("season not started: the model uses the prior only", () => {
  test("every table is at zero, in a fixed order, and nobody is out", () => {
    const drivers = computeDriverStandings(notStarted);
    expect(drivers).toHaveLength(23);
    expect(drivers.every((r) => r.points === 0)).toBe(true);
    expect(computeConstructorStandings(notStarted)).toEqual([]);
    expect(teamStatus(notStarted)).toEqual([]);
    expect(driverStatus(notStarted).every((r) => r.status === "alive")).toBe(true);
  });

  test("the path solver does not crash", () => {
    const [first] = computeDriverStandings(notStarted);
    const path = solveWdc(notStarted, first!.id);
    expect(path.verdict).toBe("alive");
    expect(nonFinite(path)).toEqual([]);
  });

  test("odds exist, sum to 100% over the drivers, are not final and carry the low-confidence flag", () => {
    const odds = computeOdds(notStarted, undefined, { nSims: 300 });
    expect(odds.final).toBeUndefined();
    expect(odds.lowConfidence).toBe(true);
    const total = odds.wdc.reduce((sum, r) => sum + r.probability, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(nonFinite(odds)).toEqual([]);
  });

  test("a race forecast works and has no NaN", () => {
    const forecast = forecastRace(notStarted, { nSims: 200 });
    expect(Object.keys(forecast.win)).toHaveLength(23);
    expect(nonFinite(forecast)).toEqual([]);
  });

  test("the check report names the state in words", () => {
    const text = formatCheckReport(buildCheckReport(notStarted), "x.sqlite");
    expect(text).toContain("Season not started");
  });

  test("a season with no driver at all still answers", () => {
    expect(computeDriverStandings(noDrivers)).toEqual([]);
    expect(driverStatus(noDrivers)).toEqual([]);
    expect(nonFinite(computeOdds(noDrivers, undefined, { nSims: 50 }))).toEqual([]);
    expect(forecastRace(noDrivers, { nSims: 50 }).win).toEqual({});
  });
});
