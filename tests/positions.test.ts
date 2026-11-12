/**
 * Phase 7, Step 2: the "best place" rule (D43), as a pure function.
 *   best = 1 + the number of OTHER entries whose points are strictly greater than this entry's ceiling.
 * All hand-made numbers below were worked out on paper; the real-data numbers are the ones listed in
 * docs/PHASE_7.md ("Real data check").
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bestPositions,
  driverPositionEntries,
  teamPositionEntries,
  type PositionEntry,
} from "../engine/positions";
import { computeConstructorStandings, computeDriverStandings } from "../engine/standings";
import { driverStatus } from "../engine/status";
import { teamStatus } from "../engine/teamStatus";
import type { Scenario, SeasonState } from "../engine/types";
import { makeState } from "./helpers";

const entry = (id: string, points: number, ceiling: number): PositionEntry => ({ id, points, ceiling });
const obj = (m: Map<string, number>) => Object.fromEntries(m);

describe("bestPositions: the rule on a small table", () => {
  const entries = [
    entry("A", 100, 150),
    entry("B", 90, 140),
    entry("C", 60, 110),
    entry("D", 50, 80),
    entry("E", 30, 30),
  ];

  test("counts the other entries whose points are strictly above this ceiling", () => {
    // A: none above 150. B: none above 140. C: none above 110.
    // D: A (100) and B (90) are above 80 -> P3. E: A, B, C, D are above 30 -> P5.
    expect(obj(bestPositions(entries))).toEqual({ A: 1, B: 1, C: 1, D: 3, E: 5 });
  });

  test("the order of the input does not matter", () => {
    const shuffled = [entries[3]!, entries[0]!, entries[4]!, entries[2]!, entries[1]!];
    expect(obj(bestPositions(shuffled))).toEqual({ A: 1, B: 1, C: 1, D: 3, E: 5 });
  });

  test("a tie on points is not 'strictly greater': it never lowers the best place", () => {
    const tied = [entry("X", 80, 80), entry("Y", 80, 80), entry("Z", 70, 70)];
    // X and Y are level, so neither is above the other; both are P1. Z has X and Y above it -> P3.
    expect(obj(bestPositions(tied))).toEqual({ X: 1, Y: 1, Z: 3 });
  });

  test("an entry whose ceiling equals a rival's points is not pushed below that rival", () => {
    // P can reach exactly 100 = Q's points: not strictly greater, so P is still P1 on points alone.
    expect(obj(bestPositions([entry("Q", 100, 100), entry("P", 40, 100)]))).toEqual({ Q: 1, P: 1 });
    // one point short of Q: Q is strictly above P's ceiling.
    expect(obj(bestPositions([entry("Q", 100, 100), entry("P", 40, 99)]))).toEqual({ Q: 1, P: 2 });
  });

  test("an entry never counts itself", () => {
    expect(obj(bestPositions([entry("A", 50, 50)]))).toEqual({ A: 1 });
  });

  test("an empty list gives an empty map and does not throw", () => {
    expect(() => bestPositions([])).not.toThrow();
    expect(bestPositions([]).size).toBe(0);
  });

  test("does not modify its input", () => {
    const input = entries.map((e) => ({ ...e }));
    const snapshot = JSON.parse(JSON.stringify(input));
    Object.freeze(input);
    for (const e of input) Object.freeze(e);
    bestPositions(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------------------------------
// Hand-made season: three teams, one race left.
//   After 3 races (order AAA, CCC, BBB, DDD, EEE, FFF each time):
//   AAA 75, CCC 54, BBB 45, DDD 36, EEE 30, FFF 24.  One race left: any driver can add at most 25.
//   Ceilings: AAA 100, CCC 79, BBB 70, DDD 61, EEE 55, FFF 49.
const teams = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] };
const order = ["AAA", "CCC", "BBB", "DDD", "EEE", "FFF"];
const threeRaces = { "1:race": order, "2:race": order, "3:race": order };
const oneLeft = () => makeState({ rounds: 4, completed: 3, teams, results: threeRaces });

const driverBest = (s: SeasonState, sc?: Scenario) => obj(bestPositions(driverPositionEntries(driverStatus(s, sc))));
const teamBest = (s: SeasonState, sc?: Scenario) => obj(bestPositions(teamPositionEntries(teamStatus(s, sc))));

describe("driverPositionEntries / teamPositionEntries", () => {
  test("drivers: id, projected points, and maxPossible as the ceiling", () => {
    const rows = driverStatus(oneLeft());
    const entries = driverPositionEntries(rows);
    expect(entries).toHaveLength(rows.length);
    expect(entries[0]).toEqual({ id: "AAA", points: 75, ceiling: 100 });
    expect(entries.find((e) => e.id === "FFF")).toEqual({ id: "FFF", points: 24, ceiling: 49 });
  });

  test("teams: id, projected points, and maxPossible as the ceiling", () => {
    const entries = teamPositionEntries(teamStatus(oneLeft()));
    expect(entries.map((e) => e.id)).toEqual(["red", "blue", "green"]);
    expect(entries[0]).toEqual({ id: "red", points: 120, ceiling: 163 });
    expect(entries[2]).toEqual({ id: "green", points: 54, ceiling: 97 });
  });

  test("the rows are not modified", () => {
    const rows = driverStatus(oneLeft());
    const snapshot = JSON.parse(JSON.stringify(rows));
    driverPositionEntries(rows);
    teamPositionEntries(teamStatus(oneLeft()));
    expect(JSON.parse(JSON.stringify(rows))).toEqual(snapshot);
  });
});

describe("bestPositions on a hand-made season", () => {
  test("drivers: best places by hand", () => {
    // AAA: none above 100 -> 1.  CCC: AAA has 75, not above 79 -> 1.
    // BBB (70): AAA 75 above -> 2.  DDD (61): AAA -> 2.  EEE (55): AAA -> 2.
    // FFF (49): AAA 75 and CCC 54 above -> 3.
    expect(driverBest(oneLeft())).toEqual({ AAA: 1, CCC: 1, BBB: 2, DDD: 2, EEE: 2, FFF: 3 });
  });

  test("teams: red 120 / ceiling 163, blue 90 / 133, green 54 / 97", () => {
    // red: 1. blue: red has 120 < 133 -> 1. green (97): red 120 and blue 90? 90 < 97, so only red -> 2.
    expect(teamBest(oneLeft())).toEqual({ red: 1, blue: 1, green: 2 });
  });

  test("1 <= best <= the place in the projected table, for every entry", () => {
    const s = oneLeft();
    for (const sc of [undefined, { locks: { "4:race": { fixed: { FFF: 1 } } } } as Scenario]) {
      const best = driverBest(s, sc);
      for (const r of computeDriverStandings(s, sc)) {
        expect(best[r.id]!).toBeGreaterThanOrEqual(1);
        expect(best[r.id]!).toBeLessThanOrEqual(r.rank);
      }
      const tbest = teamBest(s, sc);
      for (const r of computeConstructorStandings(s, sc)) {
        expect(tbest[r.id]!).toBeGreaterThanOrEqual(1);
        expect(tbest[r.id]!).toBeLessThanOrEqual(r.rank);
      }
    }
  });

  test("best is 1 exactly when the entry can still win the title (no ties in this table)", () => {
    const s = oneLeft();
    const best = driverBest(s);
    for (const r of driverStatus(s)) expect(best[r.driver] === 1).toBe(r.status !== "eliminated");
    const tbest = teamBest(s);
    for (const r of teamStatus(s)) expect(tbest[r.team] === 1).toBe(r.status !== "eliminated");
  });
});

describe("bestPositions: a driver who is not racing", () => {
  // HHH raced in round 1 only, so he is not in the latest round: his ceiling is just his points.
  // After 2 races: AAA 50, BBB 36, CCC 30, HHH 12.  One race left (round 3).
  const s = makeState({
    rounds: 3,
    completed: 2,
    teams: { red: ["AAA", "BBB"], blue: ["CCC", "HHH"] },
    results: { "1:race": ["AAA", "BBB", "CCC", "HHH"], "2:race": ["AAA", "BBB", "CCC"] },
  });

  test("the ceiling of the driver who is not racing is his points", () => {
    const hhh = driverStatus(s).find((r) => r.driver === "HHH")!;
    expect(hhh.points).toBe(12);
    expect(hhh.maxPossible).toBe(12);
  });

  test("his best place is his place by points", () => {
    // AAA, BBB and CCC all have more than 12 -> P4, which is also his place in the table.
    const best = driverBest(s);
    expect(best["HHH"]).toBe(4);
    expect(computeDriverStandings(s).find((r) => r.id === "HHH")!.rank).toBe(4);
  });

  test("the same rule holds for the team with a car that is not racing", () => {
    // red 86 (ceiling 86 + 43 = 129). blue 42: only CCC races, so the ceiling is 42 + 25 = 67; red 86 is above.
    expect(teamBest(s)).toEqual({ red: 1, blue: 2 });
  });
});

describe("bestPositions follows the scenario", () => {
  test("with every remaining session locked, each ceiling equals the points and best is the place", () => {
    const s = oneLeft();
    const sc: Scenario = { locks: { "4:race": { fixed: { AAA: 1, CCC: 2, BBB: 3, DDD: 4, EEE: 5, FFF: 6 } } } };
    for (const r of driverStatus(s, sc)) expect(r.maxPossible).toBe(r.points);
    for (const r of teamStatus(s, sc)) expect(r.maxPossible).toBe(r.points);
    // projected: AAA 100, CCC 72, BBB 60, DDD 48, EEE 40, FFF 32 (no ties)
    expect(driverBest(s, sc)).toEqual({ AAA: 1, CCC: 2, BBB: 3, DDD: 4, EEE: 5, FFF: 6 });
    // teams: red 160, blue 120, green 72
    expect(teamBest(s, sc)).toEqual({ red: 1, blue: 2, green: 3 });
  });

  test("with nothing locked and nothing left to run, best equals the place by points", () => {
    const s = makeState({ rounds: 3, completed: 3, teams, results: threeRaces });
    expect(driverBest(s)).toEqual({ AAA: 1, CCC: 2, BBB: 3, DDD: 4, EEE: 5, FFF: 6 });
  });

  // Two races left (rounds 4 and 5). Without a lock every ceiling is points + 50:
  //   AAA 125, CCC 104, BBB 95, DDD 86, EEE 80, FFF 74. Only FFF (74 < AAA's 75) has someone above.
  const twoLeft = () => makeState({ rounds: 5, completed: 3, teams, results: threeRaces });

  test("two open races: only FFF is below the leader's points", () => {
    expect(driverBest(twoLeft())).toEqual({ AAA: 1, CCC: 1, BBB: 1, DDD: 1, EEE: 1, FFF: 2 });
  });

  test("a lock in one of them changes the values as a hand calculation says", () => {
    // 4:race locked with FFF in P1: FFF 24 + 25 = 49; the others add 0 there (decision b).
    // Open: 5:race (+25 at most). Ceilings: AAA 100, CCC 79, BBB 70, DDD 61, EEE 55, FFF 74.
    // AAA 75 is above BBB, DDD, EEE and FFF; CCC's ceiling 79 is above AAA's 75.
    const sc: Scenario = { locks: { "4:race": { fixed: { FFF: 1 } } } };
    expect(driverBest(twoLeft(), sc)).toEqual({ AAA: 1, CCC: 1, BBB: 2, DDD: 2, EEE: 2, FFF: 2 });
  });
});

// ---------------------------------------------------------------------------------------------------
const FIXTURE = join(import.meta.dir, "fixtures", "season-2026-r16.json");

describe.skipIf(!existsSync(FIXTURE))("bestPositions on the real fixture (Round 16, 8 sessions left)", () => {
  let cached: SeasonState | undefined;
  const load = (): SeasonState => (cached ??= JSON.parse(readFileSync(FIXTURE, "utf8")) as SeasonState);

  test("drivers: the numbers listed in docs/PHASE_7.md", () => {
    const best = driverBest(load());
    const expected: Record<string, string[]> = {
      "1": ["ANT", "RUS", "HAM", "LEC", "NOR", "VER"],
      "2": ["PIA", "HAD", "LAW"],
      "3": ["GAS", "LIN"],
      "4": ["COL", "BEA", "BOR"],
      "5": ["HUL", "OCO", "ALO", "SAI", "ALB"],
      "7": ["STR", "BOT", "PER"],
      "20": ["TSU"],
    };
    const want: Record<string, number> = {};
    for (const [place, codes] of Object.entries(expected)) for (const c of codes) want[c] = Number(place);
    expect(best).toEqual(want);
  });

  test("teams: the numbers listed in docs/PHASE_7.md", () => {
    expect(teamBest(load())).toEqual({
      mercedes: 1, ferrari: 1, mclaren: 1, red_bull: 1,
      rb: 2,
      alpine: 3, haas: 3, audi: 3, williams: 3, aston_martin: 3, cadillac: 3,
    });
  });

  test("best is 1 exactly when the entry is not eliminated, for drivers and for teams", () => {
    const s = load();
    const best = driverBest(s);
    for (const r of driverStatus(s)) expect(best[r.driver] === 1).toBe(r.status !== "eliminated");
    const tbest = teamBest(s);
    for (const r of teamStatus(s)) expect(tbest[r.team] === 1).toBe(r.status !== "eliminated");
  });

  test("1 <= best <= rank in the projected table", () => {
    const s = load();
    const best = driverBest(s);
    for (const r of computeDriverStandings(s)) {
      expect(best[r.id]!).toBeGreaterThanOrEqual(1);
      expect(best[r.id]!).toBeLessThanOrEqual(r.rank);
    }
  });
});
