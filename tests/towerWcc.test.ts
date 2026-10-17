/** Phase 5 Step 6: status tags in the WCC table (pure view-model). */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { teamStatus } from "../engine/teamStatus";
import type { Scenario, SeasonState } from "../engine/types";
import { LONG_SHOT_GAP_SHARE, buildTowerRows, statusTag, type TowerRow } from "../web/viewModel/tower";
import { makeState } from "./helpers";

const byId = (rows: TowerRow[], id: string): TowerRow => {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};
const statuses = (rows: TowerRow[]) => Object.fromEntries(rows.map((r) => [r.id, r.status]));

const four = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"], gold: ["GGG", "HHH"] };
const eight = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"]; // team points: red 43, blue 27, green 18, gold 10

// After 3 races: red 129, blue 81, green 54, gold 30. Remaining: 4:race and 5:race (86 on offer for a team).
const season = () =>
  makeState({ rounds: 5, completed: 3, teams: four, results: { "1:race": eight, "2:race": eight, "3:race": eight } });

describe("WCC tags: one per status", () => {
  const rows = buildTowerRows(season(), undefined, "wcc");

  test("alive, long shot and eliminated", () => {
    // blue: gap 48 of 86 (56%) -> alive. green: gap 75 of 86 (87%) -> long shot. gold: 30 + 86 < 129 -> eliminated.
    expect(statuses(rows)).toEqual({ red: "alive", blue: "alive", green: "longShot", gold: "eliminated" });
  });

  test("the tag copy is the same as for drivers", () => {
    expect(statusTag(byId(rows, "red"))).toEqual({ label: "Alive", tone: "alive" });
    expect(statusTag(byId(rows, "green"))).toEqual({ label: "Long shot", tone: "longShot" });
    expect(statusTag(byId(rows, "gold"))).toEqual({ label: "Eliminated", tone: "eliminated" });
  });

  test("an eliminated team is flagged so the row can be struck through; the others are not", () => {
    expect(byId(rows, "gold").eliminated).toBe(true);
    for (const id of ["red", "blue", "green"]) expect(byId(rows, id).eliminated).toBe(false);
  });

  test("constructor rows are never inactive", () => {
    for (const r of rows) expect(r.inactive).toBe(false);
  });

  test("the statuses are the engine's statuses (only alive may turn into long shot)", () => {
    const engine: Record<string, string> = Object.fromEntries(
      teamStatus(season()).map((s) => [s.team, s.status]),
    );
    for (const r of rows) {
      const shown = r.status === "longShot" ? "alive" : r.status;
      expect(String(shown)).toBe(engine[r.id] ?? "missing");
    }
  });

  test("the rest of the row is unchanged", () => {
    const red = byId(rows, "red");
    expect(red).toMatchObject({ label: "red", name: "red", teamId: "red", rank: 1, points: 129, pointsAdded: 0 });
  });
});

describe("WCC tags: the long shot rule", () => {
  test("it uses two thirds of what a team can still score, with the team maxima", () => {
    expect(LONG_SHOT_GAP_SHARE).toBeCloseTo(2 / 3, 12);
    // two races left: 86 on offer. Two thirds is 57.3: gap 48 is below it, gap 75 is above it.
    const rows = buildTowerRows(season(), undefined, "wcc");
    expect(byId(rows, "blue").status).toBe("alive");
    expect(byId(rows, "green").status).toBe("longShot");
  });

  test("a gap of exactly two thirds is a long shot", () => {
    // S: red 43, blue 27, green 18. T: green takes P3 and P5, blue P4 and P6.
    const S = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
    const T = ["AAA", "BBB", "EEE", "CCC", "FFF", "DDD"];
    const s = makeState({
      rounds: 7, completed: 4, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
      results: { "1:race": S, "2:race": S, "3:race": T, "4:race": T },
    });
    // red 172, blue 94 (gap 78), green 86 (gap 86). Three races left: 129 on offer, two thirds is 86.
    const rows = buildTowerRows(s, undefined, "wcc");
    expect(byId(rows, "green").points).toBe(86);
    expect(byId(rows, "blue").status).toBe("alive");
    expect(byId(rows, "green").status).toBe("longShot");
  });

  test("locked sessions leave less to win, so the rule uses what is still unlocked", () => {
    // red 86, blue 46 (gap 40), green 44 (gap 42). Two races left (86): both alive. Lock 3:race with EEE out of
    // the points: only 4:race (43) is left, and both gaps are above two thirds of it (28.7), yet both can still win.
    const U = ["AAA", "BBB", "CCC", "EEE", "FFF", "DDD"];
    const s = makeState({
      rounds: 4, completed: 2, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
      results: { "1:race": U, "2:race": U },
    });
    const before = buildTowerRows(s, undefined, "wcc");
    expect(statuses(before)).toEqual({ red: "alive", blue: "alive", green: "alive" });

    const scenario: Scenario = { locks: { "3:race": { fixed: { EEE: "out" } } } };
    const after = buildTowerRows(s, scenario, "wcc");
    expect(statuses(after)).toEqual({ red: "alive", blue: "longShot", green: "longShot" });
  });

  test("a sprint counts as 15 for a team", () => {
    // one sprint and one race left: 15 + 43 = 58 on offer. Two thirds is 38.7.
    const S = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
    const s = makeState({
      rounds: 4, sprints: [4], completed: 3, teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
      results: { "1:race": S, "2:race": S, "3:race": S },
    });
    // red 129, blue 81 (gap 48 of 58, 83%, max 139 > 129), green 54 (gap 75: max 112 < 129, eliminated)
    const rows = buildTowerRows(s, undefined, "wcc");
    expect(statuses(rows)).toEqual({ red: "alive", blue: "longShot", green: "eliminated" });
  });
});

describe("WCC tags: clinched, and a scenario that changes a status", () => {
  test("a team that has clinched the title", () => {
    const scenario: Scenario = {
      locks: { "4:race": { fixed: { AAA: 1, BBB: 2 } }, "5:race": { fixed: { AAA: 1, BBB: 2 } } },
    };
    const rows = buildTowerRows(season(), scenario, "wcc");
    expect(statuses(rows)).toEqual({ red: "clinched", blue: "eliminated", green: "eliminated", gold: "eliminated" });
    expect(statusTag(byId(rows, "red"))).toEqual({ label: "Clinched", tone: "clinched" });
    expect(byId(rows, "red").eliminated).toBe(false);
  });

  test("a lock turns a long shot into an eliminated team", () => {
    // blue one-two in 4:race: blue 124, red 129, only 5:race (43) left. Green 54 + 43 < 129.
    const scenario: Scenario = { locks: { "4:race": { fixed: { CCC: 1, DDD: 2 } } } };
    const rows = buildTowerRows(season(), scenario, "wcc");
    expect(statuses(rows)).toEqual({ red: "alive", blue: "alive", green: "eliminated", gold: "eliminated" });
    expect(byId(rows, "blue").pointsAdded).toBe(43);
  });

  test("the leader changes and so does the table order, with the tags following the projected table", () => {
    const scenario: Scenario = {
      locks: { "4:race": { fixed: { CCC: 1, DDD: 2 } }, "5:race": { fixed: { CCC: 1, DDD: 2 } } },
    };
    const rows = buildTowerRows(season(), scenario, "wcc");
    expect(rows.map((r) => r.id).slice(0, 2)).toEqual(["blue", "red"]);
    expect(statuses(rows)).toMatchObject({ blue: "clinched", red: "eliminated" });
  });

  test("an invalid scenario still throws", () => {
    const bad: Scenario = { locks: { "1:race": { fixed: { AAA: 1 } } } };
    expect(() => buildTowerRows(season(), bad, "wcc")).toThrow();
  });
});

describe("WCC tags: a team with no active car", () => {
  const s = makeState({
    rounds: 3, completed: 2, teams: { red: ["AAA", "BBB"], gone: ["CCC"] },
    results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["AAA", "BBB"] },
  });
  const rows = buildTowerRows(s, undefined, "wcc");

  test("has no tag and is not struck through", () => {
    const gone = byId(rows, "gone");
    expect(gone.status).toBeNull();
    expect(statusTag(gone)).toBeNull();
    expect(gone.eliminated).toBe(false);
  });

  test("the team that is left still gets its status", () => {
    expect(byId(rows, "red").status).toBe("clinched");
  });
});

describe("WCC tags on the real Round 16 snapshot", () => {
  const real = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8"),
  ) as SeasonState;
  const rows = buildTowerRows(real, undefined, "wcc");

  test("four teams are in the title fight, nobody has clinched, seven are out", () => {
    expect(rows.filter((r) => r.status === "alive" || r.status === "longShot")).toHaveLength(4);
    expect(rows.filter((r) => r.status === "clinched")).toHaveLength(0);
    expect(rows.filter((r) => r.status === "eliminated")).toHaveLength(7);
  });

  test("Mercedes and Ferrari are alive; McLaren and Red Bull are long shots", () => {
    // 316 on offer, two thirds is 210.7: Ferrari's gap is 151, McLaren's 240, Red Bull's 258.
    expect(byId(rows, "mercedes").status).toBe("alive");
    expect(byId(rows, "ferrari").status).toBe("alive");
    expect(byId(rows, "mclaren").status).toBe("longShot");
    expect(byId(rows, "red_bull").status).toBe("longShot");
  });

  test("every team has a tag, because every team has two active drivers", () => {
    for (const r of rows) expect(statusTag(r)).not.toBeNull();
  });
});
