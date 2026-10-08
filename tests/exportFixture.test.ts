import { describe, expect, test } from "bun:test";
import { formatState } from "../scripts/exportFixture";
import { makeState } from "./helpers";

describe("formatState", () => {
  test("round-trips through JSON.parse", () => {
    const state = makeState({
      rounds: 3,
      sprints: [2],
      completed: 2,
      teams: { red: ["AAA", "BBB"], blue: ["CCC"] },
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["BBB", "AAA"], "2:sprint": ["CCC", "AAA"] },
      quali: { 1: ["AAA", "BBB"] },
    });
    expect(JSON.parse(formatState(state))).toEqual(state);
  });

  test("puts one array element per line and ends with a newline", () => {
    const state = makeState({ rounds: 1, completed: 1, teams: { red: ["AAA", "BBB"] }, results: { "1:race": ["AAA", "BBB"] } });
    const text = formatState(state);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.split("\n").filter((l) => l.includes('"driver":"AAA"'))).toHaveLength(1);
  });

  test("empty arrays stay valid", () => {
    const state = makeState({ rounds: 1, teams: { red: ["AAA"] } });
    expect(JSON.parse(formatState(state)).results).toEqual([]);
  });
});
