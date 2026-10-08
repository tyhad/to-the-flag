import { describe, expect, test } from "bun:test";
import { InvalidScenarioError, validateScenario, type InvalidScenarioCode } from "../engine/scenario";
import type { Scenario } from "../engine/types";
import { makeState } from "./helpers";

// Remaining: 3:race, 4:sprint, 4:race. DDD is inactive (absent from round 2).
const state = makeState({
  rounds: 4,
  sprints: [2, 4],
  completed: 2,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
  results: {
    "1:race": ["AAA", "BBB", "CCC", "DDD"],
    "2:sprint": ["AAA", "BBB"],
    "2:race": ["AAA", "BBB", "CCC"],
  },
});

function codeOf(scenario: Scenario): InvalidScenarioCode | "valid" {
  try {
    validateScenario(state, scenario);
    return "valid";
  } catch (err) {
    if (err instanceof InvalidScenarioError) return err.code;
    throw err;
  }
}

describe("validateScenario: valid input", () => {
  test("empty scenario and empty locks are valid", () => {
    expect(codeOf({ locks: {} })).toBe("valid");
    expect(codeOf({ locks: { "3:race": { fixed: {} } } })).toBe("valid");
  });

  test("a normal scenario is valid", () => {
    expect(
      codeOf({
        locks: {
          "3:race": { fixed: { AAA: 1, BBB: 2, CCC: "out" }, tier: "ge50" },
          "4:sprint": { fixed: { BBB: 1 } },
        },
      }),
    ).toBe("valid");
  });

  test("the last position of each zone is valid (race 10, sprint 8)", () => {
    expect(codeOf({ locks: { "3:race": { fixed: { AAA: 10 } }, "4:sprint": { fixed: { AAA: 8 } } } })).toBe("valid");
  });

  test("several drivers may be 'out' in the same session", () => {
    expect(codeOf({ locks: { "3:race": { fixed: { AAA: "out", BBB: "out", CCC: "out" } } } })).toBe("valid");
  });
});

describe("validateScenario: InvalidScenarioError", () => {
  test("a session that is not remaining", () => {
    expect(codeOf({ locks: { "3:sprint": { fixed: { AAA: 1 } } } })).toBe("session_not_remaining"); // no sprint in round 3
    expect(codeOf({ locks: { "9:race": { fixed: { AAA: 1 } } } })).toBe("session_not_remaining"); // not in the calendar
  });

  test("a malformed session key", () => {
    const bad = { locks: { garbage: { fixed: { AAA: 1 } } } } as unknown as Scenario;
    expect(codeOf(bad)).toBe("session_not_remaining");
  });

  test("a lock on a session that already has results", () => {
    expect(codeOf({ locks: { "2:race": { fixed: { AAA: 1 } } } })).toBe("session_has_results");
    expect(codeOf({ locks: { "2:sprint": { fixed: { AAA: 1 } } } })).toBe("session_has_results");
  });

  test("an unknown driver", () => {
    expect(codeOf({ locks: { "3:race": { fixed: { ZZZ: 1 } } } })).toBe("unknown_driver");
  });

  test("an inactive driver", () => {
    expect(codeOf({ locks: { "3:race": { fixed: { DDD: 1 } } } })).toBe("inactive_driver");
    expect(codeOf({ locks: { "3:race": { fixed: { DDD: "out" } } } })).toBe("inactive_driver");
  });

  test("a position outside the zone", () => {
    expect(codeOf({ locks: { "3:race": { fixed: { AAA: 11 } } } })).toBe("position_out_of_zone");
    expect(codeOf({ locks: { "4:sprint": { fixed: { AAA: 9 } } } })).toBe("position_out_of_zone");
    for (const bad of [0, -1, 1.5, NaN]) {
      expect(codeOf({ locks: { "3:race": { fixed: { AAA: bad } } } })).toBe("position_out_of_zone");
    }
  });

  test("a duplicate position within a session", () => {
    expect(codeOf({ locks: { "3:race": { fixed: { AAA: 1, BBB: 1 } } } })).toBe("duplicate_position");
  });

  test("the same position in different sessions is fine", () => {
    expect(codeOf({ locks: { "3:race": { fixed: { AAA: 1 } }, "4:race": { fixed: { BBB: 1 } } } })).toBe("valid");
  });

  test("an unknown tier", () => {
    const bad = { locks: { "3:race": { fixed: { AAA: 1 }, tier: "half" } } } as unknown as Scenario;
    expect(codeOf(bad)).toBe("invalid_tier");
  });

  test("the error names the class, carries a code, and mentions the session", () => {
    try {
      validateScenario(state, { locks: { "3:race": { fixed: { ZZZ: 1 } } } });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidScenarioError);
      const e = err as InvalidScenarioError;
      expect(e.name).toBe("InvalidScenarioError");
      expect(e.code).toBe("unknown_driver");
      expect(e.message).toContain("3:race");
      expect(e.message).toContain("ZZZ");
    }
  });
});
