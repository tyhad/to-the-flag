import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateScenario } from "../engine/scenario";
import { computeConstructorStandings } from "../engine/standings";
import { solveWcc, teamPaceLimit } from "../engine/teamSolver";
import { teamStatus } from "../engine/teamStatus";
import type { Scenario, SeasonState } from "../engine/types";
import { makeState } from "./helpers";

const teams = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] };

// Finishing orders. Team points per race (red / blue / green):
//   A 43 / 27 / 18    B 40 / 30 / 18    C 37 / 33 / 18    X 43 / 22 / 23
const A = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
const B = ["AAA", "CCC", "BBB", "DDD", "EEE", "FFF"];
const C = ["AAA", "CCC", "DDD", "BBB", "EEE", "FFF"];
const X = ["AAA", "BBB", "EEE", "CCC", "DDD", "FFF"];
const results = (orders: string[][]) => Object.fromEntries(orders.map((o, i) => [`${i + 1}:race`, o]));

// red 120, blue 90, green 54. Remaining: 4:race.
const three = () => makeState({ rounds: 4, completed: 3, teams, results: results([B, B, B]) });

// red 283, blue 207 (76 behind), green 126. Red won all 7 races, blue none. Remaining: 8:race, 9:race.
const tieGap = () => makeState({ rounds: 9, completed: 7, teams, results: results([A, A, A, B, B, C, C]) });

// red 215, blue 135 (80 behind), green 90. Remaining: 6:sprint, 6:race, 7:race.
const sprintGap = () =>
  makeState({ rounds: 7, sprints: [6], completed: 5, teams, results: results([A, A, A, A, A]) });

// red 166, blue 109 (57 behind), green 77. Remaining: 5:sprint, 5:race (58 for a team).
const sprintTwo = () =>
  makeState({ rounds: 5, sprints: [5], completed: 4, teams, results: results([X, A, A, C]) });

// EEE is the only active car of green. red 80, blue 60, green 28. Remaining: 3:race, 4:sprint, 4:race.
const oneCar = () =>
  makeState({
    rounds: 4, sprints: [4], completed: 2, teams,
    results: { "1:race": B, "2:race": ["AAA", "CCC", "BBB", "DDD", "EEE"] },
  });

const real = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8"),
) as SeasonState;

describe("teamPaceLimit", () => {
  test("a negative budget has no pace limit", () => {
    expect(teamPaceLimit(-1, 7, 1)).toBeNull();
  });

  // 7 races + 1 sprint: P3-P4 = 7 x 27 + 11 = 200, P5-P6 = 7 x 18 + 7 = 133,
  // P7-P8 = 7 x 10 + 3 = 73, P9-P10 = 7 x 3 + 0 = 21.
  test("budget 0 means outside the points", () => {
    expect(teamPaceLimit(0, 7, 1)).toBe(11);
    expect(teamPaceLimit(20, 7, 1)).toBe(11);
  });

  test("each pair step, at and just below its cost", () => {
    expect(teamPaceLimit(21, 7, 1)).toBe(9);
    expect(teamPaceLimit(72, 7, 1)).toBe(9);
    expect(teamPaceLimit(73, 7, 1)).toBe(7);
    expect(teamPaceLimit(132, 7, 1)).toBe(7);
    expect(teamPaceLimit(133, 7, 1)).toBe(5);
    expect(teamPaceLimit(199, 7, 1)).toBe(5);
    expect(teamPaceLimit(200, 7, 1)).toBe(3);
    expect(teamPaceLimit(10_000, 7, 1)).toBe(3);
  });

  test("a sprint scores nothing for P9-P10", () => {
    expect(teamPaceLimit(0, 0, 3)).toBe(9);
    expect(teamPaceLimit(9, 0, 3)).toBe(7);
  });

  test("with nothing left to run, any budget allows P3-P4", () => {
    expect(teamPaceLimit(0, 0, 0)).toBe(3);
  });
});

describe("solveWcc: three teams, one race left", () => {
  test("the chaser: every field", () => {
    const r = solveWcc(three(), "blue");
    expect(r.team).toBe("blue");
    expect(r.verdict).toBe("alive");
    expect(r.points).toBe(90);
    expect(r.maxPossible).toBe(133);
    expect(r.pointsNeeded).toBe(31); // 120 - 90 + 1
    expect(r.difficulty).toBeCloseTo(31 / 43, 10);
    // P2 and P3 is worth 33: 123 > 120
    expect(r.minOneTwos).toEqual({ total: 0, races: 0, sprints: 0 });
    // red may score 133 - 120 - 1 = 12: P7-P8 is worth 10 in a race
    expect(r.rivalBudgets).toEqual([{ team: "red", budget: 12, paceLimit: 7 }]);
    expect(r.exact).toBe(false);
  });

  test("the leader: needs nothing from here, and a rival may still score a lot", () => {
    const r = solveWcc(three(), "red");
    expect(r.verdict).toBe("alive");
    expect(r.pointsNeeded).toBe(0);
    expect(r.difficulty).toBe(0);
    expect(r.minOneTwos).toEqual({ total: 0, races: 0, sprints: 0 });
    expect(r.rivalBudgets).toEqual([{ team: "blue", budget: 72, paceLimit: 3 }]);
  });

  test("an eliminated team has null path fields and no budgets", () => {
    const r = solveWcc(three(), "green");
    expect(r.verdict).toBe("eliminated");
    expect(r.pointsNeeded).toBeNull();
    expect(r.difficulty).toBeNull();
    expect(r.minOneTwos).toBeNull();
    expect(r.easiest).toBeNull();
    expect(r.rivalBudgets).toEqual([]);
    expect(r.maxPossible).toBe(97);
  });

  test("a clinched team needs nothing and has no rivals to watch", () => {
    const scenario: Scenario = { locks: { "4:race": { fixed: { AAA: 1, BBB: 2 } } } };
    const r = solveWcc(three(), "red", scenario);
    expect(r.verdict).toBe("clinched");
    expect(r.pointsNeeded).toBe(0);
    expect(r.difficulty).toBe(0);
    expect(r.minOneTwos).toEqual({ total: 0, races: 0, sprints: 0 });
    expect(r.rivalBudgets).toEqual([]);
    expect(r.easiest).toEqual(scenario);
  });

  test("a team with no active car is eliminated with null path fields", () => {
    const s = makeState({
      rounds: 3, completed: 2, teams: { red: ["AAA", "BBB"], gone: ["CCC"] },
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["AAA", "BBB"] },
    });
    const r = solveWcc(s, "gone");
    expect(r.verdict).toBe("eliminated");
    expect(r.minOneTwos).toBeNull();
    expect(r.easiest).toBeNull();
  });
});

describe("solveWcc: minOneTwos", () => {
  test("one one-two is needed when P2 and P3 everywhere is not enough", () => {
    // blue is 80 behind: P2+P3 in all three sessions is 33 + 33 + 13 = 79, one race one-two makes 89
    const r = solveWcc(sprintGap(), "blue");
    expect(r.verdict).toBe("alive");
    expect(r.pointsNeeded).toBe(81);
    expect(r.minOneTwos).toEqual({ total: 1, races: 1, sprints: 0 });
  });

  test("races come before sprints, in calendar order", () => {
    const r = solveWcc(sprintGap(), "blue");
    expect(r.easiest?.locks["6:race"]?.fixed).toEqual({ CCC: 1, DDD: 2 });
    expect(r.easiest?.locks["7:race"]?.fixed).toEqual({ CCC: 2, DDD: 3 });
    expect(r.easiest?.locks["6:sprint"]?.fixed).toEqual({ CCC: 2, DDD: 3 });
  });

  test("a one-two in a sprint is the last to be needed", () => {
    // 5:race one-two + sprint P2/P3 = 56 is one short of the 57 gap; both one-twos give 58
    const r = solveWcc(sprintTwo(), "blue");
    expect(r.pointsNeeded).toBe(58);
    expect(r.difficulty).toBe(1);
    expect(r.minOneTwos).toEqual({ total: 2, races: 1, sprints: 1 });
  });

  test("a tie on points is settled by countback, and the witness counts that", () => {
    const state = tieGap();
    // one one-two and one P2/P3 put blue level with red on 283 points, but red has seven wins
    const level: Scenario = {
      locks: {
        "8:race": { fixed: { CCC: 1, DDD: 2 } },
        "9:race": { fixed: { CCC: 2, DDD: 3 } },
      },
    };
    const table = computeConstructorStandings(state, level);
    expect(table[0]?.id).toBe("red");
    expect(table[0]?.points).toBe(table[1]?.points);

    const r = solveWcc(state, "blue");
    expect(r.minOneTwos).toEqual({ total: 2, races: 2, sprints: 0 });
    expect(computeConstructorStandings(state, r.easiest as Scenario)[0]?.points).toBe(293);
  });

  test("a one-car team can only win, so its one-twos are wins", () => {
    const r = solveWcc(oneCar(), "green");
    expect(r.verdict).toBe("alive");
    expect(r.maxPossible).toBe(86);
    expect(r.pointsNeeded).toBe(53);
    // EEE alone: P2 everywhere is 43 (71 < 80), one win 50, two wins 57 -> 85 > 80
    expect(r.minOneTwos).toEqual({ total: 2, races: 2, sprints: 0 });
    expect(r.easiest?.locks["3:race"]?.fixed).toEqual({ EEE: 1 });
    expect(r.easiest?.locks["4:sprint"]?.fixed).toEqual({ EEE: 2 });
  });
});

describe("solveWcc: rival budgets and exact", () => {
  test("the pace limit follows the open races and sprints", () => {
    // blue max 236, red 215: red may score 20 in 2 races + 1 sprint; P9-P10 is worth 6, P7-P8 23
    const r = solveWcc(sprintGap(), "blue");
    expect(r.rivalBudgets).toEqual([{ team: "red", budget: 20, paceLimit: 9 }]);
  });

  test("exact is false with fewer than 8 drivers on eliminated teams", () => {
    expect(solveWcc(three(), "blue").exact).toBe(false);
    expect(solveWcc(oneCar(), "green").exact).toBe(false);
  });

  test("exact is true on the real data (14 drivers on eliminated teams)", () => {
    expect(solveWcc(real, "ferrari").exact).toBe(true);
  });
});

describe("solveWcc: scenario, errors and inputs", () => {
  test("easiest keeps the scenario's locks", () => {
    // green wins the sprint: blue (135, 86 left in the two races) is still alive on 221 against red's 215
    const scenario: Scenario = { locks: { "6:sprint": { fixed: { EEE: 1 } } } };
    const r = solveWcc(sprintGap(), "blue", scenario);
    expect(r.verdict).toBe("alive");
    expect(r.minOneTwos).toEqual({ total: 2, races: 2, sprints: 0 });
    expect(r.easiest?.locks["6:sprint"]).toEqual({ fixed: { EEE: 1 } });
    expect(r.easiest?.locks["6:race"]?.fixed).toEqual({ CCC: 1, DDD: 2 });
    expect(r.easiest?.locks["7:race"]?.fixed).toEqual({ CCC: 1, DDD: 2 });
  });

  test("a scenario changes the answer", () => {
    const base = solveWcc(three(), "blue");
    const locked = solveWcc(three(), "blue", { locks: { "4:race": { fixed: { AAA: 1, BBB: 2 } } } });
    expect(base.verdict).toBe("alive");
    expect(locked.verdict).toBe("eliminated");
  });

  test("an unknown team throws RangeError", () => {
    expect(() => solveWcc(three(), "nope")).toThrow(RangeError);
  });

  test("does not modify its inputs", () => {
    const s = sprintGap();
    const scenario: Scenario = { locks: { "6:race": { fixed: { AAA: 3 } } } };
    const sBefore = JSON.stringify(s);
    const scBefore = JSON.stringify(scenario);
    solveWcc(s, "blue", scenario);
    expect(JSON.stringify(s)).toBe(sBefore);
    expect(JSON.stringify(scenario)).toBe(scBefore);
  });
});

describe("solveWcc: invariants", () => {
  const cases: [string, SeasonState, Scenario | undefined][] = [
    ["three", three(), undefined],
    ["tieGap", tieGap(), undefined],
    ["sprintGap", sprintGap(), undefined],
    ["sprintTwo", sprintTwo(), undefined],
    ["oneCar", oneCar(), undefined],
    ["real", real, undefined],
    ["three + one-two", three(), { locks: { "4:race": { fixed: { AAA: 1, BBB: 2 } } } }],
  ];

  for (const [name, state, scenario] of cases) {
    test(`verdict equals teamStatus; easiest is valid and ranks the team first (${name})`, () => {
      const rows = teamStatus(state, scenario);
      for (const row of rows) {
        const r = solveWcc(state, row.team, scenario);
        expect(r.verdict).toBe(row.status);
        expect(r.points).toBe(row.points);
        expect(r.maxPossible).toBe(row.maxPossible);
        if (row.status === "eliminated") {
          expect([r.pointsNeeded, r.difficulty, r.minOneTwos, r.easiest]).toEqual([null, null, null, null]);
        } else {
          expect(r.minOneTwos).not.toBeNull();
          const easiest = r.easiest as Scenario;
          expect(() => validateScenario(state, easiest)).not.toThrow();
          expect(computeConstructorStandings(state, easiest)[0]?.id).toBe(row.team);
        }
      }
    });
  }
});

describe("solveWcc: the Round 16 fixture", () => {
  test("Ferrari needs 152 points and no one-two", () => {
    const r = solveWcc(real, "ferrari");
    expect(r.verdict).toBe("alive");
    expect(r.pointsNeeded).toBe(556 - 405 + 1);
    expect(r.minOneTwos).toEqual({ total: 0, races: 0, sprints: 0 });
  });

  test("McLaren needs 241 points and no one-two", () => {
    const r = solveWcc(real, "mclaren");
    expect(r.pointsNeeded).toBe(241);
    expect(r.minOneTwos).toEqual({ total: 0, races: 0, sprints: 0 });
  });

  test("Red Bull needs 259 points and two one-twos in races", () => {
    const r = solveWcc(real, "red_bull");
    expect(r.pointsNeeded).toBe(259);
    expect(r.minOneTwos).toEqual({ total: 2, races: 2, sprints: 0 });
  });

  test("Mercedes, the leader, needs nothing; the clinch number comes from teamStatus", () => {
    const r = solveWcc(real, "mercedes");
    expect(r.pointsNeeded).toBe(0);
    expect(teamStatus(real)[0]?.pointsToClinch).toBe(166);
    expect(r.rivalBudgets.map((b) => b.team).sort()).toEqual(["ferrari", "mclaren", "red_bull"]);
  });

  test("an eliminated team has no path", () => {
    const r = solveWcc(real, "rb");
    expect(r.verdict).toBe("eliminated");
    expect(r.minOneTwos).toBeNull();
  });
});
