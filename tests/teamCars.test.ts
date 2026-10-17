import { describe, expect, test } from "bun:test";
import { validateScenario } from "../engine/scenario";
import { teamCars, teamSessionMax, teamWitnessScenario } from "../engine/teams";
import type { Scenario } from "../engine/types";
import { makeState } from "./helpers";

// Three teams of two. Round 1: AAA CCC BBB DDD EEE FFF. Round 2 (FFF is missing, so FFF is inactive):
// AAA CCC BBB DDD EEE. Points: AAA 50, CCC 36, BBB 30, DDD 24, EEE 20, FFF 8.
// Remaining: 3:race, 4:sprint, 4:race.
const teams = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] };
const r1 = ["AAA", "CCC", "BBB", "DDD", "EEE", "FFF"];
const r2 = ["AAA", "CCC", "BBB", "DDD", "EEE"];

const season = () =>
  makeState({ rounds: 4, sprints: [4], completed: 2, teams, results: { "1:race": r1, "2:race": r2 } });

describe("teamCars", () => {
  test("lists the active drivers of every team, best driver first", () => {
    const cars = teamCars(season());
    expect(cars.get("red")).toEqual(["AAA", "BBB"]);
    expect(cars.get("blue")).toEqual(["CCC", "DDD"]);
  });

  test("an inactive driver is not a car", () => {
    expect(teamCars(season()).get("green")).toEqual(["EEE"]);
  });

  test("every team of the season has an entry, also one with no active car", () => {
    const s = makeState({
      rounds: 3, completed: 1, teams: { red: ["AAA", "BBB"], gone: ["CCC"] },
      results: { "1:race": ["AAA", "BBB"] },
    });
    const cars = teamCars(s);
    expect([...cars.keys()].sort()).toEqual(["gone", "red"]);
    expect(cars.get("gone")).toEqual([]);
  });

  test("a driver follows their latest team after a mid-season change", () => {
    const s = makeState({
      rounds: 4, completed: 2, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
      results: { "1:race": ["AAA", "CCC", "BBB", "DDD"], "2:race": ["AAA", "CCC", "BBB", "DDD"] },
      teamChanges: [
        { driver: "BBB", team: "blue", fromRound: 2 },
        { driver: "DDD", team: "red", fromRound: 2 },
      ],
    });
    const cars = teamCars(s);
    expect(cars.get("red")).toEqual(["AAA", "DDD"]);
    expect(cars.get("blue")).toEqual(["CCC", "BBB"]);
  });

  test("equal points are ordered by driver code", () => {
    const s = makeState({
      rounds: 3, completed: 1, teams: { red: ["ZZZ", "BBB"] },
      results: { "1:race": ["ZZZ", "BBB"] },
    });
    // ZZZ 25, BBB 18: points first
    expect(teamCars(s).get("red")).toEqual(["ZZZ", "BBB"]);
    const tie = makeState({
      rounds: 3, completed: 2, teams: { red: ["ZZZ", "BBB"] },
      results: { "1:race": ["ZZZ", "BBB"], "2:race": ["BBB", "ZZZ"] },
    });
    // ZZZ 43, BBB 43: tie, so code order
    expect(teamCars(tie).get("red")).toEqual(["BBB", "ZZZ"]);
  });

  test("does not modify the state", () => {
    const s = season();
    const before = JSON.stringify(s);
    teamCars(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("teamSessionMax", () => {
  test("two cars: P1 + P2", () => {
    expect(teamSessionMax(2, "race")).toBe(43);
    expect(teamSessionMax(2, "sprint")).toBe(15);
  });
  test("one car: P1 only", () => {
    expect(teamSessionMax(1, "race")).toBe(25);
    expect(teamSessionMax(1, "sprint")).toBe(8);
  });
  test("no car scores nothing", () => {
    expect(teamSessionMax(0, "race")).toBe(0);
  });
  test("agrees with teamSessionMaxPoints for two cars", () => {
    expect(teamSessionMax(2, "race")).toBe(25 + 18);
  });
});

describe("teamWitnessScenario", () => {
  test("puts the team's cars on P1 and P2 in every open session", () => {
    const w = teamWitnessScenario(season(), undefined, "red");
    expect(Object.keys(w.locks).sort()).toEqual(["3:race", "4:race", "4:sprint"]);
    for (const lock of Object.values(w.locks)) expect(lock.fixed).toEqual({ AAA: 1, BBB: 2 });
  });

  test("offset 1 gives P2 and P3", () => {
    const w = teamWitnessScenario(season(), undefined, "blue", 1);
    for (const lock of Object.values(w.locks)) expect(lock.fixed).toEqual({ CCC: 2, DDD: 3 });
  });

  test("a one-car team takes one place", () => {
    const w = teamWitnessScenario(season(), undefined, "green");
    for (const lock of Object.values(w.locks)) expect(lock.fixed).toEqual({ EEE: 1 });
  });

  test("keeps the scenario's locks and only fills open sessions", () => {
    const given: Scenario = { locks: { "3:race": { fixed: { CCC: 1 }, tier: "ge50" } } };
    const w = teamWitnessScenario(season(), given, "red");
    expect(w.locks["3:race"]).toEqual({ fixed: { CCC: 1 }, tier: "ge50" });
    expect(w.locks["4:race"]?.fixed).toEqual({ AAA: 1, BBB: 2 });
    expect(w.locks["4:sprint"]?.fixed).toEqual({ AAA: 1, BBB: 2 });
  });

  test("a place beyond the points zone becomes out", () => {
    // sprint zone is 8: offset 7 puts the two cars on P8 and P9 -> P9 is out
    const w = teamWitnessScenario(season(), undefined, "red", 7);
    expect(w.locks["4:sprint"]?.fixed).toEqual({ AAA: 8, BBB: "out" });
    expect(w.locks["4:race"]?.fixed).toEqual({ AAA: 8, BBB: 9 });
  });

  test("the result is a valid scenario", () => {
    for (const offset of [0, 1, 2, 9]) {
      expect(() => validateScenario(season(), teamWitnessScenario(season(), undefined, "red", offset))).not.toThrow();
    }
  });

  test("a team with no active car adds nothing", () => {
    const s = makeState({
      rounds: 3, completed: 1, teams: { red: ["AAA", "BBB"], gone: ["CCC"] },
      results: { "1:race": ["AAA", "BBB"] },
    });
    expect(teamWitnessScenario(s, undefined, "gone")).toEqual({ locks: {} });
  });

  test("an unknown team throws RangeError", () => {
    expect(() => teamWitnessScenario(season(), undefined, "nope")).toThrow(RangeError);
  });

  test("does not modify its inputs", () => {
    const s = season();
    const given: Scenario = { locks: { "3:race": { fixed: { CCC: 1 } } } };
    const sBefore = JSON.stringify(s);
    const gBefore = JSON.stringify(given);
    teamWitnessScenario(s, given, "red");
    expect(JSON.stringify(s)).toBe(sBefore);
    expect(JSON.stringify(given)).toBe(gBefore);
  });
});
