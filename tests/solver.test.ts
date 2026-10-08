import { describe, expect, test } from "bun:test";
import { InvalidScenarioError, validateScenario } from "../engine/scenario";
import { computeDriverStandings } from "../engine/standings";
import { driverStatus } from "../engine/status";
import { paceLimit, solveWdc, type PathResult } from "../engine/solver";
import type { Scenario, SeasonState } from "../engine/types";
import { makeState } from "./helpers";

const abc = { t: ["AAA", "BBB", "CCC"] };
const podium = ["AAA", "BBB", "CCC"];

// AAA 75, BBB 54, CCC 45. Remaining: 4:race (25). CCC is eliminated (max 70).
const three = () =>
  makeState({ rounds: 4, completed: 3, teams: abc, results: { "1:race": podium, "2:race": podium, "3:race": podium } });

// AAA 50, BBB 36, CCC 30. Remaining: 3:race, 4:race.
const two = () => makeState({ rounds: 4, completed: 2, teams: abc, results: { "1:race": podium, "2:race": podium } });

// Countback case. AAA 62, BBB 80 (BBB won four of five races, AAA one). 6:race remains.
// AAA finishing P2 in 6:race ties BBB on 80 points, but BBB has 4 wins to AAA's 1.
const tie = () =>
  makeState({
    rounds: 6, completed: 5, teams: { t: ["AAA", "BBB"] },
    results: {
      "1:race": ["BBB", "AAA"],
      "2:race": ["BBB", "AAA"],
      "3:race": { order: ["BBB", "AAA"], tier: "ge25" },
      "4:race": { order: ["BBB", "AAA"], tier: "ge25" },
      "5:race": { order: ["AAA", "BBB"], tier: "lt25" },
    },
  });

// AAA 113, BBB 82 (gap 31). Remaining: 6:race and 6:sprint.
const sprintGap31 = () =>
  makeState({
    rounds: 6, sprints: [6], completed: 5, teams: { t: ["AAA", "BBB"] },
    results: {
      "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"], "3:race": ["AAA", "BBB"], "4:race": ["AAA", "BBB"],
      "5:race": { order: ["AAA", "BBB"], tier: "ge25" },
    },
  });

// AAA 112, BBB 80 (gap 32; AAA won all six). Remaining: 7:race and 7:sprint.
const sprintGap32 = () =>
  makeState({
    rounds: 7, sprints: [7], completed: 6, teams: { t: ["AAA", "BBB"] },
    results: {
      "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"], "3:race": ["AAA", "BBB"], "4:race": ["AAA", "BBB"],
      "5:race": { order: ["AAA", "BBB"], tier: "lt25" }, "6:race": { order: ["AAA", "BBB"], tier: "lt25" },
    },
  });

/** n drivers D01..Dn all finishing in code order for three rounds; a fourth race remains. */
const field = (n: number, skipLast = 0) => {
  const codes = Array.from({ length: n }, (_, i) => `D${String(i + 1).padStart(2, "0")}`);
  const last = codes.slice(0, n - skipLast);
  return makeState({
    rounds: 4, completed: 3, teams: { t: codes },
    results: { "1:race": codes, "2:race": codes, "3:race": last },
  });
};

describe("solveWdc: one clear case per output (three drivers, one race left)", () => {
  test("AAA, the leader: alive, needs nothing more, P2 everywhere is enough", () => {
    expect(solveWdc(three(), "AAA")).toEqual({
      driver: "AAA", verdict: "alive", exact: false, points: 75, maxPossible: 100,
      pointsNeeded: 0, difficulty: 0,
      minWins: { total: 0, races: 0, sprints: 0 },
      rivalBudgets: [{ driver: "BBB", budget: 45, paceLimit: 1 }],
      easiest: { locks: { "4:race": { fixed: { AAA: 2 } } } },
    });
  });

  test("BBB: needs 22 of 25 remaining points, must win the race, AAA must stay below P9", () => {
    const r = solveWdc(three(), "BBB");
    expect(r).toMatchObject({
      driver: "BBB", verdict: "alive", exact: false, points: 54, maxPossible: 79,
      pointsNeeded: 22, minWins: { total: 1, races: 1, sprints: 0 },
      rivalBudgets: [{ driver: "AAA", budget: 3, paceLimit: 9 }],
      easiest: { locks: { "4:race": { fixed: { BBB: 1 } } } },
    });
    expect(r.difficulty).toBeCloseTo(22 / 25, 10);
  });

  test("CCC, eliminated: nulls, and the budgets show why (AAA's is negative)", () => {
    expect(solveWdc(three(), "CCC")).toEqual({
      driver: "CCC", verdict: "eliminated", exact: false, points: 45, maxPossible: 70,
      pointsNeeded: null, difficulty: null, minWins: null,
      rivalBudgets: [
        { driver: "AAA", budget: -6, paceLimit: null },
        { driver: "BBB", budget: 15, paceLimit: 3 },
      ],
      easiest: null,
    });
  });

  test("a clinched driver: nothing needed, no rival can threaten, easiest is just the existing locks", () => {
    const scenario: Scenario = { locks: { "4:race": { fixed: { AAA: 1 } } } };
    expect(solveWdc(three(), "AAA", scenario)).toEqual({
      driver: "AAA", verdict: "clinched", exact: false, points: 100, maxPossible: 100,
      pointsNeeded: 0, difficulty: 0,
      minWins: { total: 0, races: 0, sprints: 0 },
      rivalBudgets: [],
      easiest: { locks: { "4:race": { fixed: { AAA: 1 } } } },
    });
  });

  test("verdict always equals driverStatus", () => {
    for (const d of podium) {
      const row = driverStatus(three()).find((r) => r.driver === d);
      if (!row) throw new Error(`no status row for ${d}`);
      expect(solveWdc(three(), d).verdict).toBe(row.status);
    }
  });
});

describe("solveWdc: minWins", () => {
  test("a tie that only countback decides: AAA needs a win, not just P2 (driver id would say 0)", () => {
    // With AAA at P2 the points tie at 80 and BBB wins on countback, even though "AAA" sorts first.
    const tied = computeDriverStandings(tie(), { locks: { "6:race": { fixed: { AAA: 2 } } } });
    expect(tied.map((r) => [r.id, r.points])).toEqual([["BBB", 80], ["AAA", 80]]);

    const r = solveWdc(tie(), "AAA");
    expect(r.minWins).toEqual({ total: 1, races: 1, sprints: 0 });
    expect(r.easiest).toEqual({ locks: { "6:race": { fixed: { AAA: 1 } } } });
    expect(r).toMatchObject({ verdict: "alive", points: 62, maxPossible: 87, pointsNeeded: 19 });
    expect(r.difficulty).toBeCloseTo(19 / 25, 10);
    expect(r.rivalBudgets).toEqual([{ driver: "BBB", budget: 6, paceLimit: 7 }]);
  });

  test("the leader of that tie needs no wins at all", () => {
    const r = solveWdc(tie(), "BBB");
    expect(r.minWins).toEqual({ total: 0, races: 0, sprints: 0 });
    expect(r.pointsNeeded).toBe(0);
    expect(r.easiest).toEqual({ locks: { "6:race": { fixed: { BBB: 2 } } } });
  });

  test("wins go to races before sprints", () => {
    const r = solveWdc(sprintGap31(), "BBB");
    expect(r.minWins).toEqual({ total: 1, races: 1, sprints: 0 });
    expect(r.easiest).toEqual({
      locks: { "6:race": { fixed: { BBB: 1 } }, "6:sprint": { fixed: { BBB: 2 } } },
    });
  });

  test("a countback tie pushes the answer from 1 win to 2 (race + sprint)", () => {
    // gap 32: race win + sprint P2 gives 32 -> a tie that AAA (six wins) takes on countback.
    const r = solveWdc(sprintGap32(), "BBB");
    expect(r.minWins).toEqual({ total: 2, races: 1, sprints: 1 });
    expect(r.easiest).toEqual({
      locks: { "7:race": { fixed: { BBB: 1 } }, "7:sprint": { fixed: { BBB: 1 } } },
    });
    expect(r.pointsNeeded).toBe(33);
    expect(r.maxPossible).toBe(113);
    expect(r.rivalBudgets).toEqual([{ driver: "AAA", budget: 0, paceLimit: 11 }]);
  });

  test("an eliminated driver has no minWins and no easiest scenario", () => {
    const r = solveWdc(three(), "CCC");
    expect(r.minWins).toBeNull();
    expect(r.easiest).toBeNull();
  });

  test("the scenario's own locks are kept in the easiest scenario", () => {
    const scenario: Scenario = { locks: { "3:race": { fixed: { BBB: 1 } } } };
    const r = solveWdc(two(), "AAA", scenario);
    expect(r).toMatchObject({ points: 50, pointsNeeded: 12, minWins: { total: 0, races: 0, sprints: 0 } });
    expect(r.easiest).toEqual({ locks: { "3:race": { fixed: { BBB: 1 } }, "4:race": { fixed: { AAA: 2 } } } });
  });
});

describe("solveWdc: easiest is a witness the engine accepts", () => {
  const cases: [string, SeasonState, Scenario | undefined][] = [
    ["three", three(), undefined],
    ["two", two(), undefined],
    ["tie", tie(), undefined],
    ["sprintGap31", sprintGap31(), undefined],
    ["sprintGap32", sprintGap32(), undefined],
    ["two + lock", two(), { locks: { "3:race": { fixed: { BBB: 1 } } } }],
  ];
  for (const [name, state, scenario] of cases) {
    test(`every non-eliminated driver: valid scenario, ranks first (${name})`, () => {
      const contenders = driverStatus(state, scenario).filter((r) => r.status !== "eliminated");
      expect(contenders.length).toBeGreaterThan(0);
      for (const c of contenders) {
        const r = solveWdc(state, c.driver, scenario);
        expect(r.easiest).not.toBeNull();
        expect(() => validateScenario(state, r.easiest as Scenario)).not.toThrow();
        expect(computeDriverStandings(state, r.easiest as Scenario)[0]?.id).toBe(c.driver);
      }
    });
  }

  test("one win fewer would not be enough (minWins is minimal)", () => {
    for (const [state, d] of [[three(), "BBB"], [tie(), "AAA"], [sprintGap32(), "BBB"]] as const) {
      const r = solveWdc(state, d);
      expect(r.minWins).not.toBeNull();
      if (!r.minWins || r.minWins.total === 0) continue;
      const easiest = r.easiest as Scenario;
      // turn the last win into a P2: X must no longer rank first
      const lastWinKey = Object.entries(easiest.locks).reverse().find(([, l]) => l.fixed[d] === 1)?.[0];
      expect(lastWinKey).toBeDefined();
      const weaker: Scenario = { locks: { ...easiest.locks, [lastWinKey as keyof typeof easiest.locks]: { fixed: { [d]: 2 } } } };
      expect(computeDriverStandings(state, weaker)[0]?.id).not.toBe(d);
    }
  });
});

describe("solveWdc: exact (decision b)", () => {
  test("false with fewer than 9 fillers; true with 9 (boundary)", () => {
    // n = 10: 2 contenders, 8 active eliminated. n = 11: 9 active eliminated.
    expect(solveWdc(field(10), "D01").exact).toBe(false);
    expect(solveWdc(field(11), "D01").exact).toBe(true);
    expect(solveWdc(field(22), "D01").exact).toBe(true);
  });

  test("two contenders in the 11-driver field", () => {
    const rows = driverStatus(field(11));
    expect(rows.filter((r) => r.status !== "eliminated").map((r) => r.driver)).toEqual(["D01", "D02"]);
  });

  test("an inactive driver cannot fill a position, so it does not count", () => {
    // 11 drivers, but D10 and D11 are absent from the last round: 9 non-contenders, only 7 active fillers.
    expect(solveWdc(field(11, 2), "D01").exact).toBe(false);
  });

  test("exact does not depend on which driver is solved", () => {
    expect(solveWdc(field(11), "D05").exact).toBe(true);
    expect(solveWdc(field(10), "D05").exact).toBe(false);
  });
});

describe("paceLimit", () => {
  test("null when the budget is negative", () => {
    expect(paceLimit(-1, 7, 1)).toBeNull();
  });

  test("11 (outside the zone) when the budget is 0", () => {
    expect(paceLimit(0, 7, 1)).toBe(11);
    expect(paceLimit(0, 1, 0)).toBe(11);
  });

  test("smallest p whose total fits the budget", () => {
    expect(paceLimit(1, 1, 0)).toBe(10); // P10 = 1
    expect(paceLimit(3, 1, 0)).toBe(9); // P9 = 2, P8 = 4
    expect(paceLimit(15, 1, 0)).toBe(3); // P3 = 15
    expect(paceLimit(25, 1, 0)).toBe(1);
    expect(paceLimit(133, 7, 1)).toBe(2); // 7 x 18 + 7
    expect(paceLimit(132, 7, 1)).toBe(3); // 7 x 15 + 6 = 111
    expect(paceLimit(183, 7, 1)).toBe(1); // 7 x 25 + 8
    expect(paceLimit(182, 7, 1)).toBe(2);
  });

  test("sprints add their own scale (P9 and below score 0 in a sprint)", () => {
    expect(paceLimit(1, 1, 1)).toBe(10); // race P10 = 1 + sprint P10 = 0
    expect(paceLimit(2, 0, 2)).toBe(8); // P7 = 2 each -> 4 > 2, P8 = 1 each -> 2
  });

  test("with nothing left to run any budget >= 0 gives P1", () => {
    expect(paceLimit(0, 0, 0)).toBe(1);
  });
});

describe("solveWdc: errors and purity", () => {
  test("an unknown driver throws RangeError", () => {
    expect(() => solveWdc(three(), "ZZZ")).toThrow(RangeError);
  });

  test("an invalid scenario throws InvalidScenarioError", () => {
    expect(() => solveWdc(three(), "AAA", { locks: { "3:race": { fixed: { AAA: 1 } } } })).toThrow(InvalidScenarioError);
  });

  test("an inactive driver is eliminated with null path fields", () => {
    const s = field(11, 2);
    const r: PathResult = solveWdc(s, "D10");
    expect(r.verdict).toBe("eliminated");
    expect(r.pointsNeeded).toBeNull();
    expect(r.minWins).toBeNull();
    expect(r.easiest).toBeNull();
    expect(r.maxPossible).toBe(r.points);
  });

  test("inputs are not modified", () => {
    const s = two();
    const scenario: Scenario = { locks: { "3:race": { fixed: { BBB: 1 } } } };
    const before = JSON.stringify([s, scenario]);
    solveWdc(s, "AAA", scenario);
    expect(JSON.stringify([s, scenario])).toBe(before);
  });
});
