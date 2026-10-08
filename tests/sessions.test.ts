import { describe, expect, test } from "bun:test";
import { activeDrivers, parseSessionKey, remainingSessions, sessionKey } from "../engine/sessions";
import { makeState } from "./helpers";

const teams = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };

describe("session keys", () => {
  test("sessionKey and parseSessionKey round-trip", () => {
    expect(sessionKey(7, "sprint")).toBe("7:sprint");
    expect(parseSessionKey("12:race")).toEqual({ round: 12, kind: "race" });
    expect(parseSessionKey(sessionKey(3, "sprint"))).toEqual({ round: 3, kind: "sprint" });
  });

  test("invalid keys throw RangeError", () => {
    for (const bad of ["race", "1:quali", "0:race", "-1:race", "1.5:race", ":race", "1:race "]) {
      expect(() => parseSessionKey(bad)).toThrow(RangeError);
    }
  });
});

describe("remainingSessions", () => {
  test("every session without results, in calendar order (sprint before race)", () => {
    const s = makeState({
      rounds: 4,
      sprints: [2, 4],
      completed: 2,
      teams,
      results: { "1:race": ["AAA"], "2:sprint": ["AAA"], "2:race": ["AAA"] },
    });
    expect(remainingSessions(s)).toEqual(["3:race", "4:sprint", "4:race"]);
  });

  test("a weekend in progress: sprint done, race still remaining", () => {
    const s = makeState({
      rounds: 3,
      sprints: [2],
      completed: 1,
      teams,
      results: { "1:race": ["AAA"], "2:sprint": ["AAA"] },
    });
    expect(remainingSessions(s)).toEqual(["2:race", "3:race"]);
  });

  test("nothing remaining when the season is complete", () => {
    const s = makeState({ rounds: 1, completed: 1, teams, results: { "1:race": ["AAA"] } });
    expect(remainingSessions(s)).toEqual([]);
  });
});

describe("activeDrivers", () => {
  test("returns codes of active drivers", () => {
    const s = makeState({
      rounds: 2,
      completed: 2,
      teams,
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["BBB", "CCC"] },
    });
    expect(activeDrivers(s)).toEqual(["BBB", "CCC"]);
  });
});
