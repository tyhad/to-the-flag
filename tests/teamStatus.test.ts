import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InvalidScenarioError } from "../engine/scenario";
import { computeConstructorStandings } from "../engine/standings";
import { teamStatus, type TeamStatusRow } from "../engine/teamStatus";
import type { Scenario, SeasonState } from "../engine/types";
import { makeState } from "./helpers";

const row = (rows: TeamStatusRow[], team: string): TeamStatusRow => {
  const found = rows.find((r) => r.team === team);
  if (!found) throw new Error(`no row ${team}`);
  return found;
};
const statuses = (rows: TeamStatusRow[]) => Object.fromEntries(rows.map((r) => [r.team, r.status]));

const teams = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] };
const order = ["AAA", "CCC", "BBB", "DDD", "EEE", "FFF"];

// After 3 races: red 120, blue 90, green 54. Remaining: 4:race (43 for a team).
const three = () =>
  makeState({ rounds: 4, completed: 3, teams, results: { "1:race": order, "2:race": order, "3:race": order } });

describe("teamStatus: three teams, one race left", () => {
  const rows = teamStatus(three());

  test("rows come in table order", () => {
    expect(rows.map((r) => r.team)).toEqual(["red", "blue", "green"]);
  });

  test("two alive, one eliminated", () => {
    expect(statuses(rows)).toEqual({ red: "alive", blue: "alive", green: "eliminated" });
  });

  test("every field", () => {
    expect(row(rows, "red")).toEqual({
      team: "red", status: "alive", points: 120, maxPossible: 163, gapToLeader: 0, pointsToClinch: 14,
    });
    expect(row(rows, "blue")).toEqual({
      team: "blue", status: "alive", points: 90, maxPossible: 133, gapToLeader: 30, pointsToClinch: 74,
    });
    expect(row(rows, "green")).toEqual({
      team: "green", status: "eliminated", points: 54, maxPossible: 97, gapToLeader: 66, pointsToClinch: null,
    });
  });
});

describe("teamStatus: clinched", () => {
  test("a lock that gives the leader a one-two in the last race clinches the title", () => {
    const rows = teamStatus(three(), { locks: { "4:race": { fixed: { AAA: 1, BBB: 2 } } } });
    expect(statuses(rows)).toEqual({ red: "clinched", blue: "eliminated", green: "eliminated" });
    expect(row(rows, "red").pointsToClinch).toBe(0);
    expect(row(rows, "blue").pointsToClinch).toBeNull();
  });

  test("with nothing left to run, the leader is clinched and maxPossible equals points", () => {
    const s = makeState({ rounds: 2, completed: 2, teams, results: { "1:race": order, "2:race": order } });
    const rows = teamStatus(s);
    expect(statuses(rows)).toEqual({ red: "clinched", blue: "eliminated", green: "eliminated" });
    for (const r of rows) expect(r.maxPossible).toBe(r.points);
  });
});

describe("teamStatus: a lock changes a status", () => {
  test("a one-two for the chaser eliminates the leader", () => {
    const rows = teamStatus(three(), { locks: { "4:race": { fixed: { CCC: 1, DDD: 2 } } } });
    // blue 90 + 43 = 133 against red 120 with nothing left to run
    expect(statuses(rows)).toEqual({ blue: "clinched", red: "eliminated", green: "eliminated" });
    expect(rows.map((r) => r.team)).toEqual(["blue", "red", "green"]);
    expect(row(rows, "red").gapToLeader).toBe(13);
  });
});

describe("teamStatus: countback uses both cars together", () => {
  // Round 1: AAA BBB CCC EEE DDD FFF. Round 2: CCC EEE DDD AAA BBB FFF.
  // red 65 [1,1,0,1,1], blue 65 [1,0,2,0,1]: same points, both with one win; red has the second place.
  const tie = () =>
    makeState({
      rounds: 2, completed: 2, teams,
      results: {
        "1:race": ["AAA", "BBB", "CCC", "EEE", "DDD", "FFF"],
        "2:race": ["CCC", "EEE", "DDD", "AAA", "BBB", "FFF"],
      },
    });

  test("the tie is real and red is ahead on combined counts", () => {
    const table = computeConstructorStandings(tie());
    expect(table[0]?.id).toBe("red");
    expect(table[0]?.points).toBe(table[1]?.points);
  });

  test("so red is clinched and blue is out despite equal points", () => {
    const rows = teamStatus(tie());
    expect(statuses(rows)).toEqual({ red: "clinched", blue: "eliminated", green: "eliminated" });
    expect(row(rows, "blue").gapToLeader).toBe(0);
  });
});

describe("teamStatus: cars", () => {
  // EEE is the only active car of green (FFF is missing in round 2). Remaining: 3:race, 4:sprint, 4:race.
  const oneCar = () =>
    makeState({
      rounds: 4, sprints: [4], completed: 2, teams,
      results: { "1:race": order, "2:race": ["AAA", "CCC", "BBB", "DDD", "EEE"] },
    });

  test("a one-car team can only take P1: 25 per race, 8 per sprint", () => {
    const rows = teamStatus(oneCar());
    // green has 28 points (EEE 20 + FFF 8) and 25 + 8 + 25 left
    expect(row(rows, "green").maxPossible).toBe(28 + 25 + 8 + 25);
    expect(row(rows, "red").maxPossible).toBe(80 + 43 + 15 + 43);
    expect(statuses(rows)).toEqual({ red: "alive", blue: "alive", green: "alive" });
  });

  test("a team with no active car is always eliminated", () => {
    const s = makeState({
      rounds: 3, completed: 2, teams: { red: ["AAA", "BBB"], gone: ["CCC"] },
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["AAA", "BBB"] },
    });
    const rows = teamStatus(s);
    expect(row(rows, "gone")).toEqual({
      team: "gone", status: "eliminated", points: 15, maxPossible: 15, gapToLeader: 71, pointsToClinch: null,
    });
    // the only team with cars left cannot be caught
    expect(row(rows, "red").status).toBe("clinched");
  });
});

describe("teamStatus: invariants and inputs", () => {
  const cases: [string, SeasonState, Scenario | undefined][] = [
    ["three, no scenario", three(), undefined],
    ["three, red one-two", three(), { locks: { "4:race": { fixed: { AAA: 1, BBB: 2 } } } }],
    ["three, blue one-two", three(), { locks: { "4:race": { fixed: { CCC: 1, DDD: 2 } } } }],
    ["three, green wins", three(), { locks: { "4:race": { fixed: { EEE: 1, FFF: 2 } } } }],
  ];

  for (const [name, state, scenario] of cases) {
    test(`someone can always still be champion, and clinched means the rest are out (${name})`, () => {
      const rows = teamStatus(state, scenario);
      const contenders = rows.filter((r) => r.status !== "eliminated");
      expect(contenders.length).toBeGreaterThanOrEqual(1);
      for (const r of rows.filter((x) => x.status === "clinched")) {
        expect(contenders).toEqual([r]);
      }
    });
  }

  test("an invalid scenario throws InvalidScenarioError", () => {
    expect(() => teamStatus(three(), { locks: { "2:race": { fixed: { AAA: 1 } } } })).toThrow(InvalidScenarioError);
    expect(() => teamStatus(three(), { locks: { "4:race": { fixed: { ZZZ: 1 } } } })).toThrow(InvalidScenarioError);
  });

  test("does not modify its inputs", () => {
    const s = three();
    const scenario: Scenario = { locks: { "4:race": { fixed: { CCC: 1 } } } };
    const sBefore = JSON.stringify(s);
    const scBefore = JSON.stringify(scenario);
    teamStatus(s, scenario);
    expect(JSON.stringify(s)).toBe(sBefore);
    expect(JSON.stringify(scenario)).toBe(scBefore);
  });
});

describe("teamStatus: the Round 16 fixture", () => {
  const real = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8"),
  ) as SeasonState;
  const rows = teamStatus(real);

  test("four teams are alive, seven are out, nobody has clinched", () => {
    expect(rows.filter((r) => r.status === "alive").length).toBe(4);
    expect(rows.filter((r) => r.status === "eliminated").length).toBe(7);
    expect(rows.filter((r) => r.status === "clinched").length).toBe(0);
  });

  test("the alive teams are the top four of the table", () => {
    expect(rows.slice(0, 4).every((r) => r.status === "alive")).toBe(true);
    expect(rows.slice(0, 4).map((r) => r.points)).toEqual([556, 405, 316, 298]);
  });

  test("points sum to 1796 and every team can still score 316", () => {
    expect(rows.reduce((sum, r) => sum + r.points, 0)).toBe(1796);
    for (const r of rows) expect(r.maxPossible - r.points).toBe(7 * 43 + 15);
  });

  test("the leader needs 166 more points to be safe", () => {
    const leader = rows[0];
    expect(leader?.gapToLeader).toBe(0);
    expect(leader?.pointsToClinch).toBe(405 + 316 - 556 + 1);
  });

  test("the rows agree with the constructor standings", () => {
    const table = computeConstructorStandings(real);
    expect(rows.map((r) => r.team)).toEqual(table.map((r) => r.id));
    expect(rows.map((r) => r.points)).toEqual(table.map((r) => r.points));
  });
});
