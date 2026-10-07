import { describe, expect, test } from "bun:test";
import { InvalidScenarioError } from "../engine/scenario";
import { computeConstructorStandings, computeDriverStandings } from "../engine/standings";
import type { DistanceTier } from "../engine/points";
import { makeState } from "./helpers";

const teams = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
// After round 1: AAA 25, BBB 18, CCC 15, DDD 12. Remaining: 2:race, 2:sprint, 3:race, 4:race.
const base = () =>
  makeState({ rounds: 4, sprints: [2], completed: 1, teams, results: { "1:race": ["AAA", "BBB", "CCC", "DDD"] } });

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const row = <T extends { id: string }>(rows: T[], id: string): T => {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

describe("driver standings: base table", () => {
  const rows = computeDriverStandings(base());

  test("points, order and ranks", () => {
    expect(rows.map((r) => [r.id, r.points, r.rank])).toEqual([
      ["AAA", 25, 1], ["BBB", 18, 2], ["CCC", 15, 3], ["DDD", 12, 4],
    ]);
  });

  test("without locks: basePoints = points, baseRank = rank, delta = 0", () => {
    for (const r of rows) {
      expect(r.basePoints).toBe(r.points);
      expect(r.baseRank).toBe(r.rank);
      expect(r.delta).toBe(0);
    }
  });

  test("empty scenario equals no scenario", () => {
    expect(computeDriverStandings(base(), { locks: {} })).toEqual(rows);
  });

  test("position counts are exposed", () => {
    expect(row(rows, "AAA").counts).toEqual({ race: [1], quali: [] });
    expect(row(rows, "CCC").counts.race).toEqual([0, 0, 1]);
  });

  test("an inactive driver stays in the table with their points", () => {
    const s = makeState({
      rounds: 3, completed: 2, teams,
      results: { "1:race": ["AAA", "BBB", "DDD"], "2:race": ["AAA", "BBB"] },
    });
    const table = computeDriverStandings(s);
    expect(table).toHaveLength(4);
    expect(row(table, "DDD").points).toBe(15); // P3 in round 1
    expect(row(table, "DDD").rank).toBe(3);
  });

  test("the input state is not modified", () => {
    const s = base();
    const before = JSON.stringify(s);
    computeDriverStandings(s, { locks: { "2:race": { fixed: { BBB: 1 } } } });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("driver standings: locked sessions (decision g)", () => {
  test("a locked race adds points, moves ranks, reports delta", () => {
    const rows = computeDriverStandings(base(), { locks: { "2:race": { fixed: { BBB: 1, AAA: 3 } } } });
    expect(rows.map((r) => [r.id, r.points])).toEqual([["BBB", 43], ["AAA", 40], ["CCC", 15], ["DDD", 12]]);
    const bbb = row(rows, "BBB");
    expect([bbb.rank, bbb.baseRank, bbb.basePoints, bbb.delta]).toEqual([1, 2, 18, 25]);
    const aaa = row(rows, "AAA");
    expect([aaa.rank, aaa.baseRank, aaa.basePoints, aaa.delta]).toEqual([2, 1, 25, 15]);
    expect(row(rows, "CCC").delta).toBe(0);
  });

  test("a locked sprint adds sprint points", () => {
    const rows = computeDriverStandings(base(), { locks: { "2:sprint": { fixed: { DDD: 1, CCC: 2 } } } });
    expect(rows.map((r) => [r.id, r.points])).toEqual([["AAA", 25], ["CCC", 22], ["DDD", 20], ["BBB", 18]]);
  });

  test("a tier on a sprint lock is ignored (one sprint scale)", () => {
    const rows = computeDriverStandings(base(), { locks: { "2:sprint": { fixed: { DDD: 1 }, tier: "lt25" } } });
    expect(row(rows, "DDD").delta).toBe(8);
  });

  test("unspecified drivers score 0 (decision b); 'out' scores 0 too", () => {
    const rows = computeDriverStandings(base(), { locks: { "2:race": { fixed: { AAA: "out", BBB: 1 } } } });
    expect(row(rows, "AAA").points).toBe(25);
    expect(row(rows, "CCC").points).toBe(15);
    expect(row(rows, "DDD").points).toBe(12);
    expect(row(rows, "BBB").points).toBe(43);
  });

  test("locks in several sessions add up", () => {
    const rows = computeDriverStandings(base(), {
      locks: { "2:race": { fixed: { DDD: 1 } }, "3:race": { fixed: { DDD: 1 } }, "2:sprint": { fixed: { DDD: 1 } } },
    });
    expect(row(rows, "DDD").points).toBe(12 + 25 + 25 + 8);
  });

  const TIER_P123: Record<DistanceTier, [number, number, number]> = {
    lt25: [6, 4, 3], ge25: [13, 10, 8], ge50: [19, 14, 12], full: [25, 18, 15],
  };
  for (const tier of Object.keys(TIER_P123) as DistanceTier[]) {
    test(`shortened race tier ${tier} gives ${TIER_P123[tier].join("-")}`, () => {
      const rows = computeDriverStandings(base(), { locks: { "2:race": { fixed: { DDD: 1, CCC: 2, BBB: 3 }, tier } } });
      expect([row(rows, "DDD").delta, row(rows, "CCC").delta, row(rows, "BBB").delta]).toEqual(TIER_P123[tier]);
      expect(row(rows, "AAA").delta).toBe(0);
    });
  }

  test("no tier means full", () => {
    const rows = computeDriverStandings(base(), { locks: { "2:race": { fixed: { DDD: 1 } } } });
    expect(row(rows, "DDD").delta).toBe(25);
  });

  test("locked race results count toward position counts", () => {
    const rows = computeDriverStandings(base(), { locks: { "2:race": { fixed: { DDD: 1 } } } });
    expect(row(rows, "DDD").counts.race).toEqual([1, 0, 0, 1]); // locked P1 + real P4 from round 1
  });

  test("an invalid scenario throws InvalidScenarioError", () => {
    expect(() => computeDriverStandings(base(), { locks: { "1:race": { fixed: { AAA: 1 } } } })).toThrow(InvalidScenarioError);
    expect(() => computeConstructorStandings(base(), { locks: { "2:race": { fixed: { ZZZ: 1 } } } })).toThrow(InvalidScenarioError);
  });
});

describe("countback in the standings (decision f)", () => {
  const six = { t1: ["AAA", "BBB", "CCC"], t2: ["DDD", "EEE", "FFF"] };

  test("tie on points is broken by wins (and not by driver id)", () => {
    // AAA 18 + 15 = 33, BBB 25 + 8 = 33. BBB has the win. Id order alone would put AAA first.
    const s = makeState({
      rounds: 2, completed: 2, teams: six,
      results: {
        "1:race": ["BBB", "AAA", "CCC"],
        "2:race": ["CCC", "DDD", "AAA", "EEE", "FFF", "BBB"],
      },
    });
    const table = computeDriverStandings(s);
    expect(row(table, "AAA").points).toBe(33);
    expect(row(table, "BBB").points).toBe(33);
    expect(row(table, "BBB").rank).toBeLessThan(row(table, "AAA").rank);
  });

  // AAA 15 + 8 = 23, BBB 18 + 5 = 23. BBB has a race P2; AAA has a sprint WIN.
  const sprintCase = () =>
    makeState({
      rounds: 2, sprints: [2], completed: 2, teams: { t: ["AAA", "BBB", "CCC", "DDD"] },
      results: {
        "1:race": ["CCC", "BBB", "AAA"],
        "2:sprint": ["AAA", "CCC", "DDD", "BBB"],
        "2:race": ["DDD"],
      },
    });

  test("sprint wins do not count: BBB (race P2) stays ahead of AAA (sprint win)", () => {
    const table = computeDriverStandings(sprintCase());
    expect(row(table, "AAA").points).toBe(23);
    expect(row(table, "BBB").points).toBe(23);
    expect(row(table, "BBB").rank).toBeLessThan(row(table, "AAA").rank);
  });

  test("the includeSprint option switches sprint results on", () => {
    const table = computeDriverStandings(sprintCase(), undefined, { countback: { includeSprint: true } });
    expect(row(table, "AAA").rank).toBeLessThan(row(table, "BBB").rank);
  });

  // AAA and BBB both finish P2 and P3 once: all race counts equal, 33 points each. CCC wins both races.
  const quali = (q: Record<number, string[]>) =>
    makeState({
      rounds: 2, completed: 2, teams: six, quali: q,
      results: { "1:race": ["CCC", "AAA", "BBB"], "2:race": ["CCC", "BBB", "AAA"] },
    });

  test("tie on all race counts: qualifying counts decide", () => {
    const t = computeDriverStandings(quali({ 1: ["BBB", "AAA"] }));
    expect(row(t, "AAA").points).toBe(row(t, "BBB").points);
    expect(row(t, "BBB").rank).toBeLessThan(row(t, "AAA").rank);
    const reversed = computeDriverStandings(quali({ 1: ["AAA", "BBB"] }));
    expect(row(reversed, "AAA").rank).toBeLessThan(row(reversed, "BBB").rank);
  });

  test("a missing qualifying row means no placement", () => {
    const t = computeDriverStandings(quali({ 1: ["BBB"] }));
    expect(row(t, "BBB").rank).toBeLessThan(row(t, "AAA").rank);
  });

  test("a full tie falls back to driver id (deterministic)", () => {
    const t = computeDriverStandings(quali({}));
    expect(row(t, "AAA").rank).toBeLessThan(row(t, "BBB").rank);
  });

  test("finishes outside the points zone count too (P11 beats P12 on equal points)", () => {
    const codes = Array.from({ length: 12 }, (_, i) => `D${String(i + 1).padStart(2, "0")}`);
    const order = [...codes.slice(0, 10), "D12", "D11"];
    const s = makeState({ rounds: 1, completed: 1, teams: { t: codes }, results: { "1:race": order } });
    const t = computeDriverStandings(s);
    expect(row(t, "D12").points).toBe(0);
    expect(row(t, "D11").points).toBe(0);
    expect(row(t, "D12").rank).toBe(11);
    expect(row(t, "D11").rank).toBe(12);
  });
});

describe("constructor standings", () => {
  const three = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["FFF"] };

  test("sums both cars", () => {
    const s = makeState({ rounds: 2, completed: 1, teams, results: { "1:race": ["AAA", "CCC", "BBB", "DDD"] } });
    const t = computeConstructorStandings(s);
    expect(t.map((r) => [r.id, r.points])).toEqual([["red", 40], ["blue", 30]]);
  });

  test("points follow constructor_id after a mid-season team change (decision d)", () => {
    const s = makeState({
      rounds: 3, completed: 2, teams,
      teamChanges: [{ driver: "CCC", team: "red", fromRound: 2 }],
      results: { "1:race": ["CCC", "AAA"], "2:race": ["CCC", "AAA"] },
    });
    const t = computeConstructorStandings(s);
    expect(row(t, "blue").points).toBe(25); // CCC's round 1 win, still blue
    expect(row(t, "red").points).toBe(18 + 25 + 18);
    const drivers = computeDriverStandings(s);
    expect(row(drivers, "CCC").points).toBe(50);
  });

  test("a locked session is credited to the driver's current team", () => {
    const s = makeState({
      rounds: 3, completed: 2, teams,
      teamChanges: [{ driver: "CCC", team: "red", fromRound: 2 }],
      results: { "1:race": ["CCC", "AAA"], "2:race": ["CCC", "AAA"] },
    });
    const t = computeConstructorStandings(s, { locks: { "3:race": { fixed: { CCC: 1 } } } });
    expect(row(t, "red").points).toBe(61 + 25);
    expect(row(t, "blue").points).toBe(25);
    expect(row(t, "red").delta).toBe(25);
  });

  test("countback sums both cars: a tie is broken by combined counts, not by id", () => {
    // red: P1 + P6 = 33, blue: P2 + P3 = 33. red has a win. Id order alone would put blue first.
    const six = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] };
    const s = makeState({
      rounds: 1, completed: 1, teams: six,
      results: { "1:race": ["AAA", "CCC", "DDD", "EEE", "FFF", "BBB"] },
    });
    const t = computeConstructorStandings(s);
    expect(row(t, "red").points).toBe(33);
    expect(row(t, "blue").points).toBe(33);
    expect(row(t, "red").counts.race).toEqual([1, 0, 0, 0, 0, 1]);
    expect(row(t, "red").rank).toBeLessThan(row(t, "blue").rank);
  });

  test("a constructor tie on all race counts is broken by team qualifying counts", () => {
    // red: AAA P2 + BBB P3 = 33; blue: CCC P3 + DDD P2 = 33; counts equal. Quali favours red; id order favours blue.
    const s = makeState({
      rounds: 2, completed: 2, teams: three, quali: { 1: ["AAA", "CCC"] },
      results: { "1:race": ["FFF", "AAA", "CCC"], "2:race": ["FFF", "DDD", "BBB"] },
    });
    const t = computeConstructorStandings(s);
    expect(ids(t)).toEqual(["green", "red", "blue"]);
  });

  test("a qualifying row for a driver without a result that round uses their nearest team", () => {
    const s = makeState({
      rounds: 2, completed: 2, teams, quali: { 1: ["BBB"] },
      results: { "1:race": ["AAA"], "2:race": ["AAA", "BBB"] },
    });
    expect(row(computeConstructorStandings(s), "red").counts.quali).toEqual([1]);
    expect(row(computeDriverStandings(s), "BBB").counts.quali).toEqual([1]);
  });

  test("base ranks and deltas work for constructors", () => {
    const s = makeState({ rounds: 3, completed: 1, teams, results: { "1:race": ["AAA", "CCC", "BBB", "DDD"] } });
    const t = computeConstructorStandings(s, { locks: { "2:race": { fixed: { CCC: 1, DDD: 2 } } } });
    expect(ids(t)).toEqual(["blue", "red"]);
    expect(row(t, "blue").baseRank).toBe(2);
    expect(row(t, "blue").delta).toBe(43);
  });
});
