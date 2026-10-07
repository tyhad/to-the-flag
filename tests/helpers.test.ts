import { describe, expect, test } from "bun:test";
import { makeState } from "./helpers";

const teams = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };

describe("makeState", () => {
  test("computes points from order and tier", () => {
    const s = makeState({
      rounds: 3,
      sprints: [2],
      completed: 2,
      teams,
      results: {
        "1:race": ["AAA", "BBB"],
        "2:race": { order: ["BBB", "AAA"], tier: "ge50" },
        "2:sprint": ["AAA", "CCC"],
      },
    });
    const pts = (round: number, kind: "race" | "sprint", d: string) =>
      s.results.find((r) => r.round === round && r.kind === kind && r.driver === d)?.points;
    expect(pts(1, "race", "AAA")).toBe(25);
    expect(pts(1, "race", "BBB")).toBe(18);
    expect(pts(2, "race", "BBB")).toBe(19);
    expect(pts(2, "race", "AAA")).toBe(14);
    expect(pts(2, "sprint", "CCC")).toBe(7);
  });

  test("rounds, asOfRound and statuses", () => {
    const s = makeState({ rounds: 3, sprints: [3], completed: 1, teams, results: { "1:race": ["AAA"] } });
    expect(s.asOfRound).toBe(1);
    expect(s.rounds.map((r) => r.status)).toEqual(["completed", "scheduled", "scheduled"]);
    expect(s.rounds.map((r) => r.hasSprint)).toEqual([false, false, true]);
  });

  test("a driver is active only if in the latest completed round", () => {
    const s = makeState({
      rounds: 3,
      completed: 2,
      teams,
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["AAA", "BBB"] },
    });
    const active = Object.fromEntries(s.drivers.map((d) => [d.code, d.active]));
    expect(active).toEqual({ AAA: true, BBB: true, CCC: false, DDD: false });
  });

  test("team changes follow the round (decision d)", () => {
    const s = makeState({
      rounds: 3,
      completed: 2,
      teams,
      teamChanges: [{ driver: "CCC", team: "red", fromRound: 2 }],
      results: { "1:race": ["CCC"], "2:race": ["CCC"] },
    });
    expect(s.results.map((r) => r.team)).toEqual(["blue", "red"]);
  });

  test("qualifying order becomes positions", () => {
    const s = makeState({ rounds: 2, teams, quali: { 1: ["BBB", "AAA"] } });
    expect(s.qualifying).toEqual([
      { round: 1, driver: "BBB", position: 1 },
      { round: 1, driver: "AAA", position: 2 },
    ]);
  });

  test("a weekend in progress is allowed (sprint done, race not)", () => {
    const s = makeState({ rounds: 3, sprints: [2], completed: 1, teams, results: { "1:race": ["AAA"], "2:sprint": ["AAA"] } });
    expect(s.results.some((r) => r.round === 2 && r.kind === "sprint")).toBe(true);
  });

  test("mistakes in a test setup throw", () => {
    expect(() => makeState({ rounds: 2, completed: 1, teams })).toThrow(/no race result/);
    expect(() => makeState({ rounds: 2, sprints: [1], completed: 1, teams, results: { "1:race": ["AAA"] } })).toThrow(/no sprint result/);
    expect(() => makeState({ rounds: 2, teams, results: { "1:sprint": ["AAA"] } })).toThrow(/no sprint/);
    expect(() => makeState({ rounds: 2, teams, results: { "5:race": ["AAA"] } })).toThrow(/calendar/);
    expect(() => makeState({ rounds: 2, teams, results: { "1:race": ["ZZZ"] } })).toThrow(/not in any team/);
    expect(() => makeState({ rounds: 2, teams, results: { "1:race": ["AAA", "AAA"] } })).toThrow(/duplicate/);
  });
});
