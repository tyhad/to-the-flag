import { describe, expect, test } from "bun:test";
import { InvalidScenarioError, validateScenario } from "../engine/scenario";
import { computeDriverStandings } from "../engine/standings";
import { driverStatus, witnessScenario, type DriverStatusRow } from "../engine/status";
import type { Scenario, SeasonState } from "../engine/types";
import { makeState } from "./helpers";

const row = (rows: DriverStatusRow[], driver: string): DriverStatusRow => {
  const found = rows.find((r) => r.driver === driver);
  if (!found) throw new Error(`no row ${driver}`);
  return found;
};
const statuses = (rows: DriverStatusRow[]) => Object.fromEntries(rows.map((r) => [r.driver, r.status]));

const abc = { t: ["AAA", "BBB", "CCC"] };
const podium = ["AAA", "BBB", "CCC"];

// AAA 75, BBB 54, CCC 45. Remaining: 4:race (25).
const three = () =>
  makeState({
    rounds: 4, completed: 3, teams: abc,
    results: { "1:race": podium, "2:race": podium, "3:race": podium },
  });

// AAA 50, BBB 36, CCC 30. Remaining: 3:race, 4:race (50).
const two = () =>
  makeState({ rounds: 4, completed: 2, teams: abc, results: { "1:race": podium, "2:race": podium } });

// BBB won all five races, AAA was always P2. BBB 95, AAA 70: exactly one race win (25) apart.
const duel = () =>
  makeState({
    rounds: 6, completed: 5, teams: { t: ["AAA", "BBB"] },
    results: {
      "1:race": ["BBB", "AAA"],
      "2:race": ["BBB", "AAA"],
      "3:race": { order: ["BBB", "AAA"], tier: "ge50" },
      "4:race": { order: ["BBB", "AAA"], tier: "ge25" },
      "5:race": { order: ["BBB", "AAA"], tier: "ge25" },
    },
  });

describe("driverStatus: three drivers, one race left", () => {
  const rows = driverStatus(three());

  test("rows come in table order", () => {
    expect(rows.map((r) => r.driver)).toEqual(["AAA", "BBB", "CCC"]);
  });

  test("one alive leader, one alive chaser, one eliminated", () => {
    expect(statuses(rows)).toEqual({ AAA: "alive", BBB: "alive", CCC: "eliminated" });
  });

  test("every field", () => {
    expect(row(rows, "AAA")).toEqual({
      driver: "AAA", status: "alive", points: 75, maxPossible: 100, gapToLeader: 0, pointsToClinch: 5,
    });
    expect(row(rows, "BBB")).toEqual({
      driver: "BBB", status: "alive", points: 54, maxPossible: 79, gapToLeader: 21, pointsToClinch: 47,
    });
    expect(row(rows, "CCC")).toEqual({
      driver: "CCC", status: "eliminated", points: 45, maxPossible: 70, gapToLeader: 30, pointsToClinch: null,
    });
  });
});

describe("driverStatus: clinched", () => {
  test("a lock that gives the leader the last race clinches the title", () => {
    const rows = driverStatus(three(), { locks: { "4:race": { fixed: { AAA: 1 } } } });
    expect(statuses(rows)).toEqual({ AAA: "clinched", BBB: "eliminated", CCC: "eliminated" });
    expect(row(rows, "AAA").pointsToClinch).toBe(0);
    expect(row(rows, "BBB").pointsToClinch).toBeNull();
  });

  test("with nothing left to run, the leader is clinched and maxPossible equals points", () => {
    const s = makeState({ rounds: 2, completed: 2, teams: abc, results: { "1:race": podium, "2:race": podium } });
    const rows = driverStatus(s);
    expect(statuses(rows)).toEqual({ AAA: "clinched", BBB: "eliminated", CCC: "eliminated" });
    for (const r of rows) expect(r.maxPossible).toBe(r.points);
  });
});

describe("driverStatus: locks change statuses", () => {
  test("everyone is alive before any lock", () => {
    const rows = driverStatus(two());
    expect(statuses(rows)).toEqual({ AAA: "alive", BBB: "alive", CCC: "alive" });
    expect(rows.map((r) => r.maxPossible)).toEqual([100, 86, 80]);
  });

  test("BBB wins 3:race -> CCC drops out, AAA and BBB stay alive", () => {
    const rows = driverStatus(two(), { locks: { "3:race": { fixed: { BBB: 1 } } } });
    expect(rows.map((r) => [r.driver, r.points])).toEqual([["BBB", 61], ["AAA", 50], ["CCC", 30]]);
    expect(statuses(rows)).toEqual({ AAA: "alive", BBB: "alive", CCC: "eliminated" });
  });

  test("AAA wins 3:race -> AAA clinches", () => {
    const rows = driverStatus(two(), { locks: { "3:race": { fixed: { AAA: 1 } } } });
    expect(statuses(rows)).toEqual({ AAA: "clinched", BBB: "eliminated", CCC: "eliminated" });
  });

  test("locked sessions are not counted twice in maxPossible", () => {
    const rows = driverStatus(two(), { locks: { "3:race": { fixed: { AAA: 1 } } } });
    expect(row(rows, "AAA").points).toBe(75);
    expect(row(rows, "AAA").maxPossible).toBe(100); // 75 + 25 for 4:race only
  });
});

describe("driverStatus: countback decides a tie", () => {
  test("the setup is a real tie: AAA can only reach BBB's current points", () => {
    const rows = driverStatus(duel());
    expect(row(rows, "AAA").maxPossible).toBe(95);
    expect(row(rows, "BBB").points).toBe(95);
  });

  test("equal points but BBB has more wins: BBB clinched, AAA eliminated (not decided by driver id)", () => {
    const rows = driverStatus(duel());
    expect(statuses(rows)).toEqual({ AAA: "eliminated", BBB: "clinched" });
  });

  test("the same tie in a locked final race: the standings agree with the status", () => {
    const scenario: Scenario = { locks: { "6:race": { fixed: { AAA: 1 } } } };
    const table = computeDriverStandings(duel(), scenario);
    expect(table.map((r) => [r.id, r.points])).toEqual([["BBB", 95], ["AAA", 95]]);
    expect(statuses(driverStatus(duel(), scenario))).toEqual({ AAA: "eliminated", BBB: "clinched" });
  });
});

describe("driverStatus: inactive drivers", () => {
  // DDD led after round 1 but is absent from round 2, so inactive. DDD 25, AAA 24, BBB 19. 3:race remains.
  const state = () =>
    makeState({
      rounds: 3, completed: 2, teams: { t: ["AAA", "BBB", "DDD"] },
      results: {
        "1:race": ["DDD", "AAA", "BBB"],
        "2:race": { order: ["AAA", "BBB"], tier: "lt25" },
      },
    });

  test("an inactive driver is always eliminated, even when leading on points", () => {
    const rows = driverStatus(state());
    expect(row(rows, "DDD").points).toBe(25);
    expect(row(rows, "DDD").status).toBe("eliminated");
    expect(row(rows, "DDD").maxPossible).toBe(25);
    expect(row(rows, "DDD").pointsToClinch).toBeNull();
  });

  test("active drivers stay in the fight and can still be eliminated by their own points only", () => {
    const rows = driverStatus(state());
    expect(statuses(rows)).toEqual({ AAA: "alive", BBB: "alive", DDD: "eliminated" });
  });

  test("an inactive rival counts as a points ceiling for pointsToClinch", () => {
    const rows = driverStatus(state());
    // AAA 24, BBB max 44, DDD fixed at 25 -> the highest rival ceiling is BBB's 44.
    expect(row(rows, "AAA").pointsToClinch).toBe(44 - 24 + 1);
  });
});

describe("driverStatus: maxPossible and gaps", () => {
  const sprinty = () =>
    makeState({
      rounds: 4, sprints: [3], completed: 2, teams: abc, results: { "1:race": podium, "2:race": podium },
    });

  test("maxPossible - points = 25 + 25 + 8 for every active driver (3:sprint, 3:race, 4:race)", () => {
    for (const r of driverStatus(sprinty())) expect(r.maxPossible - r.points).toBe(58);
  });

  test("a locked sprint leaves 50 for everyone", () => {
    const rows = driverStatus(sprinty(), { locks: { "3:sprint": { fixed: { CCC: 1 } } } });
    for (const r of rows) expect(r.maxPossible - r.points).toBe(50);
    expect(row(rows, "CCC").points).toBe(38);
  });

  test("gapToLeader is measured to the top of the projected table", () => {
    const rows = driverStatus(two(), { locks: { "3:race": { fixed: { BBB: 1 } } } });
    expect(rows.map((r) => r.gapToLeader)).toEqual([0, 11, 31]);
  });
});

describe("driverStatus: invariants and errors", () => {
  const cases: [string, SeasonState, Scenario | undefined][] = [
    ["three", three(), undefined],
    ["two", two(), undefined],
    ["two + BBB wins 3", two(), { locks: { "3:race": { fixed: { BBB: 1 } } } }],
    ["two + AAA wins 3", two(), { locks: { "3:race": { fixed: { AAA: 1 } } } }],
    ["two + CCC wins both", two(), { locks: { "3:race": { fixed: { CCC: 1 } }, "4:race": { fixed: { CCC: 1 } } } }],
    ["duel", duel(), undefined],
  ];
  for (const [name, state, scenario] of cases) {
    test(`someone can always still be champion; clinched means all others are out (${name})`, () => {
      const rows = driverStatus(state, scenario);
      const contenders = rows.filter((r) => r.status !== "eliminated");
      const clinched = rows.filter((r) => r.status === "clinched");
      expect(contenders.length).toBeGreaterThanOrEqual(1);
      expect(clinched.length).toBeLessThanOrEqual(1);
      if (clinched.length === 1) expect(contenders).toHaveLength(1);
      for (const r of rows) {
        expect(r.maxPossible).toBeGreaterThanOrEqual(r.points);
        expect(r.gapToLeader).toBeGreaterThanOrEqual(0);
      }
    });
  }

  test("an invalid scenario throws InvalidScenarioError", () => {
    expect(() => driverStatus(three(), { locks: { "3:race": { fixed: { AAA: 1 } } } })).toThrow(InvalidScenarioError);
  });

  test("the input state is not modified", () => {
    const s = two();
    const before = JSON.stringify(s);
    driverStatus(s, { locks: { "3:race": { fixed: { AAA: 1 } } } });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("witnessScenario", () => {
  const sprinty = () =>
    makeState({
      rounds: 4, sprints: [3], completed: 2, teams: abc, results: { "1:race": podium, "2:race": podium },
    });

  test("the driver wins every remaining session (sprints included)", () => {
    const w = witnessScenario(sprinty(), undefined, "AAA");
    expect(w.locks).toEqual({
      "3:sprint": { fixed: { AAA: 1 } },
      "3:race": { fixed: { AAA: 1 } },
      "4:race": { fixed: { AAA: 1 } },
    });
  });

  test("sessions the scenario already locks are left alone", () => {
    const scenario: Scenario = { locks: { "3:race": { fixed: { BBB: 1 }, tier: "ge50" } } };
    const w = witnessScenario(sprinty(), scenario, "AAA");
    expect(w.locks["3:race"]).toEqual({ fixed: { BBB: 1 }, tier: "ge50" });
    expect(w.locks["4:race"]).toEqual({ fixed: { AAA: 1 } });
  });

  test("the witness is a valid scenario and does not modify its input", () => {
    const scenario: Scenario = { locks: { "3:race": { fixed: { BBB: 1 } } } };
    const copy = JSON.stringify(scenario);
    const s = sprinty();
    expect(() => validateScenario(s, witnessScenario(s, scenario, "CCC"))).not.toThrow();
    expect(JSON.stringify(scenario)).toBe(copy);
  });
});
