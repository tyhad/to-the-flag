import { describe, expect, test } from "bun:test";
import { statusReport } from "../scripts/statusReport";
import { makeState } from "./helpers";

describe("statusReport", () => {
  const state = makeState({
    rounds: 4, sprints: [3], completed: 2, teams: { t: ["AAA", "BBB", "CCC"] },
    results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["AAA", "BBB", "CCC"] },
  });
  const text = statusReport(state);

  test("header names the season, the round and the remaining sessions", () => {
    expect(text).toContain("2026");
    expect(text).toContain("round 2");
    expect(text).toContain("2 races + 1 sprint");
  });

  test("has one line per driver with status, points and max", () => {
    const line = text.split("\n").find((l) => l.includes("AAA"));
    expect(line).toBeDefined();
    expect(line).toContain("alive");
    expect(line).toContain("50");
    expect(line).toContain("108");
  });

  test("an eliminated driver shows a dash for pointsToClinch", () => {
    // AAA 75, BBB 54, CCC 45 with one race left: CCC can reach at most 70.
    const podium = ["AAA", "BBB", "CCC"];
    const s = makeState({
      rounds: 4, completed: 3, teams: { t: podium },
      results: { "1:race": podium, "2:race": podium, "3:race": podium },
    });
    const lines = statusReport(s).split("\n");
    const ccc = lines.find((l) => l.includes("CCC"));
    expect(ccc).toContain("eliminated");
    expect(ccc?.trimEnd().endsWith("-")).toBe(true);
  });
});
