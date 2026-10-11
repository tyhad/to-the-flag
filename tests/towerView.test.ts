/** Phase 2 Step 5: the standings tower view-model (pure). */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeConstructorStandings, computeDriverStandings } from "../engine/standings";
import type { Scenario, SeasonState } from "../engine/types";
import {
  LONG_SHOT_GAP_SHARE,
  buildTowerRows,
  formatDelta,
  formatPoints,
  statusTag,
  type TowerRow,
} from "../web/viewModel/tower";
import { makeState } from "./helpers";

const byId = (rows: TowerRow[], id: string): TowerRow => {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

// After 3 races of [AAA, BBB, CCC, DDD]: AAA 75, BBB 54, CCC 45, DDD 36. Remaining: 4:race and 5:race (50 points).
const four = () =>
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

describe("formatDelta", () => {
  test("positions gained, lost and unchanged", () => {
    expect(formatDelta(12)).toEqual({ text: "▲ 12", tone: "up", description: "Up 12 places" });
    expect(formatDelta(1)).toEqual({ text: "▲ 1", tone: "up", description: "Up 1 place" });
    expect(formatDelta(-8)).toEqual({ text: "▼ 8", tone: "down", description: "Down 8 places" });
    expect(formatDelta(-1).description).toBe("Down 1 place");
    expect(formatDelta(0)).toEqual({ text: "●", tone: "none", description: "No change in position" });
  });
});

describe("formatPoints", () => {
  test("integers stay integers and half points keep one decimal", () => {
    expect(formatPoints(320)).toBe("320");
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(12.5)).toBe("12.5");
  });
});

describe("statusTag", () => {
  const base = { status: null, inactive: false } as const;

  test("one label and tone per status, in sentence case", () => {
    expect(statusTag({ ...base, status: "clinched" })).toEqual({ label: "Clinched", tone: "clinched" });
    expect(statusTag({ ...base, status: "alive" })).toEqual({ label: "Alive", tone: "alive" });
    expect(statusTag({ ...base, status: "longShot" })).toEqual({ label: "Long shot", tone: "longShot" });
    expect(statusTag({ ...base, status: "eliminated" })).toEqual({ label: "Eliminated", tone: "eliminated" });
  });

  test("an inactive driver shows the text 'not racing', whatever the status", () => {
    expect(statusTag({ status: null, inactive: true })).toEqual({ label: "not racing", tone: "inactive" });
    expect(statusTag({ status: "eliminated", inactive: true })).toEqual({ label: "not racing", tone: "inactive" });
  });

  test("a constructor row has no status tag", () => {
    expect(statusTag(base)).toBeNull();
  });
});

describe("buildTowerRows: drivers, no locks", () => {
  const state = four();
  const rows = buildTowerRows(state, undefined, "wdc");

  test("rows follow the engine's table order and points", () => {
    const table = computeDriverStandings(state);
    expect(rows.map((r) => r.id)).toEqual(table.map((r) => r.id));
    expect(rows.map((r) => r.points)).toEqual(table.map((r) => r.points));
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  test("nothing moved and nothing was added", () => {
    for (const r of rows) {
      expect(r.rankChange).toBe(0);
      expect(r.pointsAdded).toBe(0);
      expect(r.basePoints).toBe(r.points);
    }
  });

  test("label is the driver code, name the full name, team id feeds the color strip", () => {
    const aaa = byId(rows, "AAA");
    expect(aaa.label).toBe("AAA");
    expect(aaa.name).toBe("AAA");
    expect(aaa.teamId).toBe("red");
    expect(byId(rows, "DDD").teamId).toBe("blue");
  });

  test("status tags: alive for the leader and near chasers, long shot when the gap is too big", () => {
    // 50 points left. A gap of 30 (CCC) needs 60% of them; DDD's gap of 39 needs 78%.
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      AAA: "alive",
      BBB: "alive",
      CCC: "alive",
      DDD: "longShot",
    });
  });

  test("the long shot rule is two thirds of the points still on offer", () => {
    expect(LONG_SHOT_GAP_SHARE).toBeCloseTo(2 / 3, 10);
  });
});

describe("buildTowerRows: eliminated and inactive drivers", () => {
  // AAA 75, BBB 54, CCC 45, DDD 36, EEE 20 (raced twice, not in round 3). One race left (25).
  const state = makeState({
    rounds: 4,
    completed: 3,
    teams: { t: ["AAA", "BBB", "CCC", "DDD", "EEE"] },
    results: {
      "1:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
      "2:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
      "3:race": ["AAA", "BBB", "CCC", "DDD"],
    },
  });
  const rows = buildTowerRows(state, undefined, "wdc");

  test("an active driver who can no longer win is eliminated", () => {
    for (const id of ["CCC", "DDD"]) {
      expect(byId(rows, id).status).toBe("eliminated");
      expect(byId(rows, id).eliminated).toBe(true);
      expect(byId(rows, id).inactive).toBe(false);
    }
    expect(byId(rows, "AAA").eliminated).toBe(false);
    expect(byId(rows, "BBB").eliminated).toBe(false);
  });

  test("an inactive driver is flagged inactive, not eliminated, and has no status", () => {
    const eee = byId(rows, "EEE");
    expect(eee.inactive).toBe(true);
    expect(eee.eliminated).toBe(false);
    expect(eee.status).toBeNull();
    expect(statusTag(eee)).toEqual({ label: "not racing", tone: "inactive" });
  });

  test("an inactive driver keeps their points and place in the table", () => {
    expect(byId(rows, "EEE").points).toBe(20);
    expect(byId(rows, "EEE").rank).toBe(5);
  });
});

describe("buildTowerRows: clinched", () => {
  test("a driver nobody else can catch is clinched", () => {
    // AAA 100 after 4 wins, BBB 72, one race (25) left: BBB max 97 < 100.
    const state = makeState({
      rounds: 5,
      completed: 4,
      teams: { t: ["AAA", "BBB"] },
      results: {
        "1:race": ["AAA", "BBB"],
        "2:race": ["AAA", "BBB"],
        "3:race": ["AAA", "BBB"],
        "4:race": ["AAA", "BBB"],
      },
    });
    const rows = buildTowerRows(state, undefined, "wdc");
    expect(byId(rows, "AAA").status).toBe("clinched");
    expect(byId(rows, "BBB").status).toBe("eliminated");
  });
});

describe("buildTowerRows: with a locked scenario", () => {
  const state = four();
  // 4:race: DDD wins, CCC second. DDD 36+25 = 61, CCC 45+18 = 63. Others add 0.
  const scenario: Scenario = { locks: { "4:race": { fixed: { DDD: 1, CCC: 2 } } } };

  test("current and projected points, and who moved", () => {
    const rows = buildTowerRows(state, scenario, "wdc");
    const ddd = byId(rows, "DDD");
    expect(ddd.basePoints).toBe(36);
    expect(ddd.points).toBe(61);
    expect(ddd.pointsAdded).toBe(25);
    expect(ddd.rank).toBe(3);
    expect(ddd.baseRank).toBe(4);
    expect(ddd.rankChange).toBe(1);
    const ccc = byId(rows, "CCC");
    expect(ccc.points).toBe(63);
    expect(ccc.rankChange).toBe(1);
    const bbb = byId(rows, "BBB");
    expect(bbb.points).toBe(54);
    expect(bbb.rankChange).toBe(-2);
    expect(statusDelta(bbb)).toBe("▼ 2");
  });

  test("locked sessions leave less to win, so the long shot rule uses what is still unlocked", () => {
    // Only 5:race (25) is left. AAA 75, CCC 63, DDD 61, BBB 54: BBB's gap 21 needs 84% -> long shot.
    const rows = buildTowerRows(state, scenario, "wdc");
    expect(byId(rows, "AAA").status).toBe("alive");
    expect(byId(rows, "BBB").status).toBe("longShot");
  });

  test("an invalid scenario throws instead of drawing a wrong table", () => {
    const bad: Scenario = { locks: { "1:race": { fixed: { AAA: 1 } } } };
    expect(() => buildTowerRows(state, bad, "wdc")).toThrow();
  });
});

describe("buildTowerRows: WCC after a locked scenario", () => {
  const state = four();
  // red: AAA 75 + BBB 54 = 129. blue: CCC 45 + DDD 36 = 81. Lock 4:race: CCC wins, DDD second: blue +43.
  const scenario: Scenario = { locks: { "4:race": { fixed: { CCC: 1, DDD: 2 } } } };
  const rows = buildTowerRows(state, scenario, "wcc");

  test("rows are constructors, in the engine's order", () => {
    const table = computeConstructorStandings(state, scenario);
    expect(rows.map((r) => r.id)).toEqual(table.map((r) => r.id));
    expect(rows.map((r) => r.points)).toEqual(table.map((r) => r.points));
  });

  test("label and name are the team name; the strip uses the team id itself", () => {
    const blue = byId(rows, "blue");
    expect(blue.label).toBe("blue");
    expect(blue.name).toBe("blue");
    expect(blue.teamId).toBe("blue");
  });

  test("points added by the lock show per constructor", () => {
    expect(byId(rows, "blue").basePoints).toBe(81);
    expect(byId(rows, "blue").points).toBe(124);
    expect(byId(rows, "blue").pointsAdded).toBe(43);
    expect(byId(rows, "red").points).toBe(129);
    expect(byId(rows, "red").pointsAdded).toBe(0);
  });

  test("no status tag and no inactive flag on constructor rows", () => {
    for (const r of rows) {
      expect(r.status).toBeNull();
      expect(r.inactive).toBe(false);
      expect(r.eliminated).toBe(false);
      expect(statusTag(r)).toBeNull();
    }
  });

  test("a constructor that overtakes another shows the position change", () => {
    // Lock the whole podium for blue so it passes red: blue 81 + 25 + 18 = 124 < 129, so add 5:race too.
    const both: Scenario = {
      locks: {
        "4:race": { fixed: { CCC: 1, DDD: 2 } },
        "5:race": { fixed: { CCC: 1, DDD: 2 } },
      },
    };
    const wcc = buildTowerRows(state, both, "wcc");
    expect(wcc.map((r) => r.id)).toEqual(["blue", "red"]);
    expect(byId(wcc, "blue").rankChange).toBe(1);
    expect(byId(wcc, "red").rankChange).toBe(-1);
  });
});

const REAL = join(import.meta.dir, "fixtures", "season-2026-r16.json");

describe.skipIf(!existsSync(REAL))("buildTowerRows on the real Round 16 snapshot", () => {
  let cached: SeasonState | undefined;
  const load = (): SeasonState => (cached ??= JSON.parse(readFileSync(REAL, "utf8")) as SeasonState);

  test("with no locks the table is the engine's table, point for point", () => {
    const state = load();
    const rows = buildTowerRows(state, undefined, "wdc");
    const table = computeDriverStandings(state);
    expect(rows.map((r) => [r.id, r.points])).toEqual(table.map((r) => [r.id, r.points]));
    expect(rows[0]?.id).toBe("ANT");
    expect(rows[0]?.points).toBe(320);
    expect(rows.every((r) => r.rankChange === 0 && r.pointsAdded === 0)).toBe(true);
  });

  test("six drivers are alive or long shots, nobody has clinched, TSU is not racing", () => {
    const rows = buildTowerRows(load(), undefined, "wdc");
    const tags = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(tags.ANT).toBe("alive");
    expect(tags.RUS).toBe("alive");
    expect(tags.HAM).toBe("alive");
    expect(tags.LEC).toBe("longShot");
    expect(tags.NOR).toBe("longShot");
    expect(tags.VER).toBe("longShot");
    expect(rows.filter((r) => r.status === "clinched")).toHaveLength(0);
    expect(rows.filter((r) => r.status === "alive" || r.status === "longShot")).toHaveLength(6);
    const tsu = byId(rows, "TSU");
    expect(tsu.inactive).toBe(true);
    expect(tsu.status).toBeNull();
  });

  test("every constructor in the snapshot gets a row", () => {
    const state = load();
    const rows = buildTowerRows(state, undefined, "wcc");
    expect(rows.map((r) => r.id).sort()).toEqual(state.teams.map((t) => t.id).sort());
  });
});

function statusDelta(row: TowerRow): string {
  return formatDelta(row.rankChange).text;
}
