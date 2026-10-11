/** Phase 2 Step 8: comparing two scenarios (pure). */
import { describe, expect, test } from "bun:test";
import type { Scenario, SeasonState } from "../engine";
import {
  buildCompareRows,
  compareOptions,
  defaultCompareSides,
  describeCompareRow,
  resolveSide,
  formatPointsDiff,
  summarizeCompare,
  type CompareRow,
} from "../web/viewModel/compare";
import type { SavedScenario } from "../web/viewModel/scenarios";
import { makeState } from "./helpers";

// AAA 75, BBB 54, CCC 45, DDD 36 after 3 races. Remaining: 4:race and 5:race.
const four = (): SeasonState =>
  makeState({
    rounds: 5,
    completed: 3,
    teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
    results: {
      "1:race": ["AAA", "BBB", "CCC", "DDD"],
      "2:race": ["AAA", "BBB", "CCC", "DDD"],
      "3:race": ["AAA", "BBB", "CCC", "DDD"],
    },
  });

const BASE: Scenario = { locks: {} };
// 4:race: DDD wins, CCC second. DDD 61, CCC 63. AAA 75, BBB 54 stay.
const upset: Scenario = { locks: { "4:race": { fixed: { DDD: 1, CCC: 2 } } } };
const byId = (rows: CompareRow[], id: string): CompareRow => rows.find((r) => r.id === id)!;

describe("formatPointsDiff", () => {
  test("signed, with a real minus sign, and = for no change", () => {
    expect(formatPointsDiff(25)).toBe("+25");
    expect(formatPointsDiff(-10)).toBe("−10");
    expect(formatPointsDiff(12.5)).toBe("+12.5");
    expect(formatPointsDiff(0)).toBe("=");
  });
});

describe("buildCompareRows: drivers, Base vs a scenario", () => {
  const rows = buildCompareRows(four(), BASE, upset, "wdc");

  test("one row per driver, in the left scenario's order", () => {
    expect(rows.map((r) => r.id)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  test("ranks and points on both sides", () => {
    expect(byId(rows, "CCC")).toMatchObject({ leftRank: 3, rightRank: 2, leftPoints: 45, rightPoints: 63 });
    expect(byId(rows, "DDD")).toMatchObject({ leftRank: 4, rightRank: 3, leftPoints: 36, rightPoints: 61 });
    expect(byId(rows, "BBB")).toMatchObject({ leftRank: 2, rightRank: 4, leftPoints: 54, rightPoints: 54 });
  });

  test("rank change is positive when the driver is higher on the right", () => {
    expect(byId(rows, "CCC").rankChange).toBe(1);
    expect(byId(rows, "BBB").rankChange).toBe(-2);
    expect(byId(rows, "AAA").rankChange).toBe(0);
  });

  test("points difference is right minus left", () => {
    expect(byId(rows, "CCC").pointsDiff).toBe(18);
    expect(byId(rows, "DDD").pointsDiff).toBe(25);
    expect(byId(rows, "BBB").pointsDiff).toBe(0);
  });

  test("a row differs when the rank or the points differ", () => {
    expect(byId(rows, "AAA").differs).toBe(false);
    expect(byId(rows, "BBB").differs).toBe(true); // same points, lower place
    expect(byId(rows, "CCC").differs).toBe(true);
    expect(byId(rows, "DDD").differs).toBe(true);
  });

  test("carries the label, full name and team for the color strip", () => {
    expect(byId(rows, "CCC")).toMatchObject({ label: "CCC", name: "CCC", teamId: "blue" });
  });
});

describe("buildCompareRows: two scenarios", () => {
  test("compares any two, not only Base against one", () => {
    const other: Scenario = { locks: { "4:race": { fixed: { DDD: 1, CCC: 2 } }, "5:race": { fixed: { DDD: 1 } } } };
    const rows = buildCompareRows(four(), upset, other, "wdc");
    expect(byId(rows, "DDD")).toMatchObject({ leftPoints: 61, rightPoints: 86, pointsDiff: 25, rankChange: 2 });
    // DDD (86) now passes AAA (75): AAA keeps its points but loses a place.
    expect(byId(rows, "AAA")).toMatchObject({ pointsDiff: 0, rankChange: -1, differs: true });
    expect(byId(rows, "BBB").differs).toBe(false);
    // Order follows the left scenario: AAA 75, CCC 63, DDD 61, BBB 54.
    expect(rows.map((r) => r.id)).toEqual(["AAA", "CCC", "DDD", "BBB"]);
  });

  test("the same scenario on both sides differs nowhere", () => {
    const rows = buildCompareRows(four(), upset, upset, "wdc");
    expect(rows.every((r) => !r.differs)).toBe(true);
  });

  test("undefined counts as Base", () => {
    expect(buildCompareRows(four(), undefined, upset, "wdc")).toEqual(buildCompareRows(four(), BASE, upset, "wdc"));
  });
});

describe("buildCompareRows: constructors", () => {
  test("team points move, a place may not", () => {
    // red 129, blue 81. Blue gains 43 with the upset: 124, still second.
    const rows = buildCompareRows(four(), BASE, upset, "wcc");
    expect(rows.map((r) => r.id)).toEqual(["red", "blue"]);
    expect(byId(rows, "blue")).toMatchObject({ leftPoints: 81, rightPoints: 124, pointsDiff: 43, rankChange: 0, differs: true });
    expect(byId(rows, "red").differs).toBe(false);
  });
});

describe("summarizeCompare", () => {
  test("counts the rows that differ, in words", () => {
    const rows = buildCompareRows(four(), BASE, upset, "wdc");
    expect(summarizeCompare(rows, "wdc")).toBe("3 of 4 drivers differ.");
    expect(summarizeCompare(buildCompareRows(four(), BASE, upset, "wcc"), "wcc")).toBe("1 of 2 constructors differ.");
  });

  test("one row, and none", () => {
    const one = buildCompareRows(four(), BASE, { locks: { "4:race": { fixed: { AAA: 1 } } } }, "wdc");
    expect(summarizeCompare(one, "wdc")).toBe("1 of 4 drivers differ.");
    expect(summarizeCompare(buildCompareRows(four(), BASE, BASE, "wdc"), "wdc")).toBe(
      "No differences: both give the same table.",
    );
  });
});

describe("describeCompareRow", () => {
  const rows = buildCompareRows(four(), BASE, upset, "wdc");

  test("rank and points both changed", () => {
    expect(describeCompareRow(byId(rows, "CCC"))).toBe("Up 1 place and 18 more points");
  });

  test("a place lost with the same points", () => {
    expect(describeCompareRow(byId(rows, "BBB"))).toBe("Down 2 places, same points");
  });

  test("same place, different points", () => {
    const wcc = buildCompareRows(four(), BASE, upset, "wcc");
    expect(describeCompareRow(byId(wcc, "blue"))).toBe("Same position, 43 more points");
  });

  test("no change", () => {
    expect(describeCompareRow(byId(rows, "AAA"))).toBe("No change");
  });

  test("fewer points, and a single point", () => {
    const base: CompareRow = {
      id: "X", label: "X", name: "X", teamId: "", leftRank: 1, rightRank: 1,
      leftPoints: 10, rightPoints: 9, rankChange: 0, pointsDiff: -1, differs: true, inactive: false,
    };
    expect(describeCompareRow(base)).toBe("Same position, 1 fewer point");
    expect(describeCompareRow({ ...base, pointsDiff: -5 })).toBe("Same position, 5 fewer points");
    expect(describeCompareRow({ ...base, pointsDiff: 1 })).toBe("Same position, 1 more point");
  });
});

const saved = (id: string, name: string, over: Partial<SavedScenario> = {}): SavedScenario => ({
  id,
  name,
  season: 2026,
  asOfRound: 3,
  locks: { "4:race": { fixed: { DDD: 1 } } },
  valid: true,
  stale: false,
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
  ...over,
});

describe("compareOptions", () => {
  test("Base, the current sandbox, then every valid saved scenario", () => {
    const list = [saved("a", "Alpha"), saved("b", "Broken", { valid: false }), saved("c", "Gamma", { stale: true })];
    expect(compareOptions(list)).toEqual([
      { id: "base", label: "Base" },
      { id: "sandbox", label: "Current sandbox" },
      { id: "a", label: "Alpha" },
      { id: "c", label: "Gamma" },
    ]);
  });
});

describe("resolveSide", () => {
  const sandbox: Scenario = { locks: { "5:race": { fixed: { AAA: 1 } } } };
  const list = [saved("a", "Alpha"), saved("b", "Broken", { valid: false })];

  test("base is the real results", () => {
    expect(resolveSide("base", sandbox, list)).toEqual({ label: "Base", scenario: { locks: {} } });
  });

  test("sandbox is whatever is on screen", () => {
    expect(resolveSide("sandbox", sandbox, list)).toEqual({ label: "Current sandbox", scenario: sandbox });
  });

  test("a saved scenario uses its own locks and name", () => {
    expect(resolveSide("a", sandbox, list)).toEqual({
      label: "Alpha",
      scenario: { locks: { "4:race": { fixed: { DDD: 1 } } } },
    });
  });

  test("an invalid or unknown scenario cannot be compared", () => {
    expect(resolveSide("b", sandbox, list)).toBeNull();
    expect(resolveSide("gone", sandbox, list)).toBeNull();
  });
});

describe("defaultCompareSides", () => {
  const list = [saved("a", "Alpha"), saved("b", "Broken", { valid: false })];

  test("Base against the selected scenario", () => {
    expect(defaultCompareSides("a", list)).toEqual({ left: "base", right: "a" });
  });

  test("Base against the sandbox when nothing saved is selected, or the selection cannot be compared", () => {
    expect(defaultCompareSides(null, list)).toEqual({ left: "base", right: "sandbox" });
    expect(defaultCompareSides("b", list)).toEqual({ left: "base", right: "sandbox" });
    expect(defaultCompareSides("gone", list)).toEqual({ left: "base", right: "sandbox" });
  });
});
