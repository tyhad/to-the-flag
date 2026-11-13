/**
 * Phase 7, Step 4: the Best column in the tower view-model (pure).
 * Every row has `best` (a number) and `bestText` ("P2"), from `bestPositions` applied to the PROJECTED table
 * of the current scenario, for the WDC and the WCC tab. All numbers below were worked out on paper.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeConstructorStandings, computeDriverStandings } from "../engine/standings";
import type { Scenario, SeasonState } from "../engine/types";
import {
  BEST_ACCESSIBLE_NAME,
  BEST_COLUMN_LABEL,
  BEST_HINT,
  buildTowerRows,
  formatBest,
  type TowerRow,
} from "../web/viewModel/tower";
import { makeState } from "./helpers";

const byId = (rows: TowerRow[], id: string): TowerRow => {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};
const bests = (rows: TowerRow[]) => Object.fromEntries(rows.map((r) => [r.id, r.best]));

describe("formatBest and the labels", () => {
  test("'P' and the place", () => {
    expect(formatBest(1)).toBe("P1");
    expect(formatBest(2)).toBe("P2");
    expect(formatBest(20)).toBe("P20");
  });

  test("the header, the accessible name and the hint say 'on points alone'", () => {
    expect(BEST_COLUMN_LABEL).toBe("Best");
    expect(BEST_ACCESSIBLE_NAME).toBe("Highest place still possible on points alone");
    expect(BEST_HINT).toBe("Best = the highest place still possible on points alone.");
  });
});

// ---------------------------------------------------------------------------------------------------
// Drivers. After 3 races of [AAA, BBB, CCC, DDD, EEE]: AAA 75, BBB 54, CCC 45, DDD 36; EEE raced twice (20)
// and is not in round 3, so he is not racing. One race left (25 points).
//   Ceilings: AAA 100, BBB 79, CCC 70, DDD 61, EEE 20 (his points).
const drivers = () =>
  makeState({
    rounds: 4,
    completed: 3,
    teams: { t: ["AAA", "BBB", "CCC", "DDD", "EEE"] },
    results: {
      "1:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
      "2:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
      "3:race": ["AAA", "BBB", "CCC", "DDD"],
    },
  });

describe("Best column: drivers", () => {
  const rows = buildTowerRows(drivers(), undefined, "wdc");

  test("values by hand", () => {
    // AAA: none above 100 -> 1. BBB: AAA's 75 is not above 79 -> 1.
    // CCC (70): AAA 75 above -> 2. DDD (61): AAA -> 2. EEE (20): all four above -> 5.
    expect(bests(rows)).toEqual({ AAA: 1, BBB: 1, CCC: 2, DDD: 2, EEE: 5 });
  });

  test("the text is 'P' and the number", () => {
    expect(rows.map((r) => r.bestText)).toEqual(["P1", "P1", "P2", "P2", "P5"]);
    for (const r of rows) expect(r.bestText).toBe(formatBest(r.best));
  });

  test("the leader is P1", () => {
    expect(rows[0]!.id).toBe("AAA");
    expect(rows[0]!.best).toBe(1);
    expect(rows[0]!.bestText).toBe("P1");
  });

  test("a driver who is not racing: his best place is his place by points", () => {
    const eee = byId(rows, "EEE");
    expect(eee.inactive).toBe(true);
    expect(eee.best).toBe(eee.rank);
    expect(eee.bestText).toBe("P5");
  });

  test("1 <= best <= rank for every row", () => {
    for (const r of rows) {
      expect(r.best).toBeGreaterThanOrEqual(1);
      expect(r.best).toBeLessThanOrEqual(r.rank);
    }
  });

  test("best is 1 exactly when the driver can still win the title (this table has no ties)", () => {
    for (const r of rows) {
      if (r.inactive) continue;
      expect(r.best === 1).toBe(r.status !== "eliminated");
    }
  });

  test("a lock changes the values: with CCC winning the last race, BBB falls from P1 to P3", () => {
    // 4:race locked, CCC P1: CCC 70, others add 0. Nothing is open any more, so best = place by points:
    // AAA 75, CCC 70, BBB 54, DDD 36, EEE 20.
    const scenario: Scenario = { locks: { "4:race": { fixed: { CCC: 1 } } } };
    const locked = buildTowerRows(drivers(), scenario, "wdc");
    expect(bests(locked)).toEqual({ AAA: 1, CCC: 2, BBB: 3, DDD: 4, EEE: 5 });
    expect(locked.map((r) => r.id)).toEqual(["AAA", "CCC", "BBB", "DDD", "EEE"]);
    expect(bests(rows).BBB).toBe(1); // before the lock
  });

  test("the rows come in the projected order and the values follow the table in that order", () => {
    const table = computeDriverStandings(drivers());
    expect(rows.map((r) => r.id)).toEqual(table.map((r) => r.id));
  });

  test("an invalid scenario still throws", () => {
    const bad: Scenario = { locks: { "1:race": { fixed: { AAA: 1 } } } };
    expect(() => buildTowerRows(drivers(), bad, "wdc")).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// Constructors. After 3 races of eight drivers: red 129, blue 81, green 54, gold 30. Two races left, 43 each for a team.
//   Ceilings: red 215, blue 167, green 140, gold 116.
const four = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"], gold: ["GGG", "HHH"] };
const eight = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"];
const season = () =>
  makeState({ rounds: 5, completed: 3, teams: four, results: { "1:race": eight, "2:race": eight, "3:race": eight } });

describe("Best column: constructors", () => {
  const rows = buildTowerRows(season(), undefined, "wcc");

  test("values by hand", () => {
    // red, blue: nobody above their ceilings. green (140): red's 129 is not above -> 1. gold (116): red 129 above -> 2.
    expect(bests(rows)).toEqual({ red: 1, blue: 1, green: 1, gold: 2 });
    expect(rows.map((r) => r.bestText)).toEqual(["P1", "P1", "P1", "P2"]);
  });

  test("best is 1 exactly when the team can still win the title", () => {
    for (const r of rows) expect(r.best === 1).toBe(r.status !== "eliminated");
  });

  test("1 <= best <= rank", () => {
    for (const r of rows) {
      expect(r.best).toBeGreaterThanOrEqual(1);
      expect(r.best).toBeLessThanOrEqual(r.rank);
    }
  });

  test("a lock changes the values: a blue one-two in 4:race", () => {
    // blue 124, red 129, green 54, gold 30; open: 5:race (43). Ceilings: red 172, blue 167, green 97, gold 73.
    // green: red and blue above 97 -> 3. gold: red and blue above 73 (green's 54 is not) -> 3.
    const scenario: Scenario = { locks: { "4:race": { fixed: { CCC: 1, DDD: 2 } } } };
    const locked = buildTowerRows(season(), scenario, "wcc");
    expect(bests(locked)).toEqual({ red: 1, blue: 1, green: 3, gold: 3 });
    expect(rows.map((r) => r.id)).toEqual(computeConstructorStandings(season()).map((r) => r.id));
  });

  test("a team with no active car: no tag, but a best place by points", () => {
    // red 86 (ceiling 86 + 43), gone 15 (ceiling 15): red's 86 is above -> P2.
    const s = makeState({
      rounds: 3,
      completed: 2,
      teams: { red: ["AAA", "BBB"], gone: ["CCC"] },
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["AAA", "BBB"] },
    });
    const r = buildTowerRows(s, undefined, "wcc");
    expect(byId(r, "gone").status).toBeNull();
    expect(byId(r, "gone").best).toBe(2);
    expect(byId(r, "gone").bestText).toBe("P2");
    expect(byId(r, "red").best).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------
const FIXTURE = join(import.meta.dir, "fixtures", "season-2026-r16.json");

describe.skipIf(!existsSync(FIXTURE))("Best column on the real Round 16 snapshot", () => {
  const real = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as SeasonState) : undefined!;
  const drv = () => buildTowerRows(real, undefined, "wdc");
  const team = () => buildTowerRows(real, undefined, "wcc");

  test("the numbers listed in docs/PHASE_7.md", () => {
    const rows = drv();
    const want: Record<string, string[]> = {
      P1: ["ANT", "RUS", "HAM", "LEC", "NOR", "VER"],
      P2: ["PIA", "HAD", "LAW"],
      P3: ["GAS", "LIN"],
      P4: ["COL", "BEA", "BOR"],
      P5: ["HUL", "OCO", "ALO", "SAI", "ALB"],
      P7: ["STR", "BOT", "PER"],
      P20: ["TSU"],
    };
    for (const [text, codes] of Object.entries(want)) {
      for (const code of codes) expect(byId(rows, code).bestText).toBe(text);
    }
    expect(rows).toHaveLength(Object.values(want).flat().length);
  });

  test("hand calculation for two drivers: count the drivers whose points are above the ceiling", () => {
    const rows = drv();
    // GAS can reach 41 + 183 = 224. Drivers above 224 today: ANT 320 and RUS 236 (HAM has 214) -> P3.
    expect(rows.filter((r) => r.points > 224)).toHaveLength(2);
    expect(byId(rows, "GAS").best).toBe(3);
    // ALB can reach 5 + 183 = 188. Above 188: ANT 320, RUS 236, HAM 214, LEC 191 (NOR and VER have exactly 188,
    // which is not above) -> P5.
    expect(rows.filter((r) => r.points > 188)).toHaveLength(4);
    expect(byId(rows, "ALB").best).toBe(5);
  });

  test("a driver with a ceiling of 1 point: TSU is not racing and sits where his points put him", () => {
    const tsu = byId(drv(), "TSU");
    expect(tsu.inactive).toBe(true);
    expect(tsu.best).toBe(tsu.rank);
  });

  test("teams: the numbers listed in docs/PHASE_7.md, and a hand calculation for RB", () => {
    const rows = team();
    for (const id of ["mercedes", "ferrari", "mclaren", "red_bull"]) expect(byId(rows, id).bestText).toBe("P1");
    expect(byId(rows, "rb").bestText).toBe("P2");
    for (const id of ["alpine", "haas", "audi", "williams", "aston_martin", "cadillac"]) {
      expect(byId(rows, id).bestText).toBe("P3");
    }
    // RB can reach 90 + 316 = 406: only Mercedes (556) is above it (Ferrari has 405).
    expect(rows.filter((r) => r.points > 406)).toHaveLength(1);
  });

  test("best >= 2 exactly when the entry can no longer win the title, for drivers and for teams", () => {
    for (const r of [...drv().filter((x) => !x.inactive), ...team()]) {
      expect(r.best >= 2).toBe(r.status === "eliminated");
    }
  });
});
