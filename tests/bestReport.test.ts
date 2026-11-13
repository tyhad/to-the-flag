/**
 * Phase 7, Step 6: the Best position in `bun run check` (rows, text tables and --json).
 * The numbers are the engine's (`bestPositions`); the hand-made ones were worked out on paper.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSeason } from "../data/loadSeason";
import { bestPositions, driverPositionEntries, teamPositionEntries } from "../engine/positions";
import { driverStatus } from "../engine/status";
import { teamStatus } from "../engine/teamStatus";
import type { SeasonState } from "../engine/types";
import { buildCheckReport, formatCheckReport, runCheck } from "../scripts/check";
import { buildDb, cleanupDbs } from "./dbHelpers";
import { makeState } from "./helpers";

afterAll(cleanupDbs);

const DRIVER_HEAD = /^#\s+Driver\s/;
const TEAM_HEAD = /^#\s+Team\s/;

/** The text of one cell of a table line, found by where the header puts its column. */
function cell(table: string, headerStart: RegExp, header: string, line: (l: string) => boolean): string {
  const lines = table.split("\n");
  const head = lines.find((l) => headerStart.test(l))!;
  const col = head.indexOf(header);
  const row = lines.find((l) => l !== head && line(l))!;
  return row.slice(col, col + header.length + 1).trim();
}

// ---------------------------------------------------------------------------------------------------
// Mini season (as in check.test.ts): after round 2, remaining 3:race, 4:sprint, 4:race (58 points for a car).
//   AAA 57 (ceiling 115), BBB 41 (99), CCC 39 (97), DDD 12 (inactive: ceiling 12)  -> P1, P1, P1, P4
//   alpha 98 (199), beta 51 (109)                                                  -> P1, P1
const dbPath = buildDb();
const mini = loadSeason(dbPath);

describe("buildCheckReport: bestPosition", () => {
  const report = buildCheckReport(mini);

  test("WDC rows carry bestPosition, by hand", () => {
    // AAA, BBB, CCC: nobody has more than their ceilings -> 1. DDD (12, not racing): AAA, BBB and CCC are above -> 4.
    expect(report.wdc.map((r) => [r.driver, r.bestPosition])).toEqual([["AAA", 1], ["BBB", 1], ["CCC", 1], ["DDD", 4]]);
  });

  test("WCC rows carry bestPosition, by hand", () => {
    // alpha's 98 is not above beta's ceiling of 109.
    expect(report.wcc.map((r) => [r.team, r.bestPosition])).toEqual([["alpha", 1], ["beta", 1]]);
  });

  test("a number, never null or missing", () => {
    for (const r of [...report.wdc, ...report.wcc]) expect(Number.isInteger(r.bestPosition)).toBe(true);
  });

  test("1 <= bestPosition <= rank, and 1 exactly when not eliminated", () => {
    for (const r of report.wdc) {
      expect(r.bestPosition).toBeGreaterThanOrEqual(1);
      expect(r.bestPosition).toBeLessThanOrEqual(r.rank);
      expect(r.bestPosition === 1).toBe(r.status !== "eliminated");
    }
    for (const r of report.wcc) expect(r.bestPosition === 1).toBe(r.status !== "eliminated");
  });

  test("the other row fields are unchanged", () => {
    expect(report.wdc[0]).toMatchObject({ rank: 1, driver: "AAA", points: 57, maxPossible: 115, gapToLeader: 0 });
    expect(report.wcc[1]).toMatchObject({ rank: 2, team: "beta", points: 51, maxPossible: 109, gapToLeader: 47 });
  });

  test("the report is still plain JSON and the input state is not modified", () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    const before = JSON.stringify(mini);
    buildCheckReport(mini);
    expect(JSON.stringify(mini)).toBe(before);
  });
});

describe("formatCheckReport: the Best column", () => {
  const text = formatCheckReport(buildCheckReport(mini), "some/path.sqlite");

  test("the WDC table has a Best column between Status and Points", () => {
    const head = text.split("\n").find((l) => l.startsWith("#") && l.includes("Driver"))!;
    expect(head).toContain("Best");
    expect(head.indexOf("Status")).toBeLessThan(head.indexOf("Best"));
    expect(head.indexOf("Best")).toBeLessThan(head.indexOf("Points"));
  });

  test("each WDC row shows its place as 'P1'.. in that column", () => {
    const get = (name: string) => cell(text, DRIVER_HEAD, "Best", (l) => l.includes(name));
    expect(get("Driver AAA")).toBe("P1");
    expect(get("Driver BBB")).toBe("P1");
    expect(get("Driver DDD")).toBe("P4");
  });

  test("the WCC table has the same column, in the same place", () => {
    const head = text.split("\n").find((l) => l.startsWith("#") && l.includes("Team"))!;
    expect(head.indexOf("Status")).toBeLessThan(head.indexOf("Best"));
    expect(head.indexOf("Best")).toBeLessThan(head.indexOf("Points"));
    expect(cell(text, TEAM_HEAD, "Best", (l) => l.includes("Alpha"))).toBe("P1");
    expect(cell(text, TEAM_HEAD, "Best", (l) => l.includes("Beta"))).toBe("P1");
  });

  test("the columns after it still line up: points, max, gap and ToClinch are where they were relative to the header", () => {
    const head = text.split("\n").find((l) => l.startsWith("#") && l.includes("Driver"))!;
    const row = text.split("\n").find((l) => l.includes("Driver AAA") && l.includes("alive"))!;
    expect(row.slice(head.indexOf("Points"), head.indexOf("Points") + 2)).toBe("57");
    expect(row.slice(head.indexOf("Max"), head.indexOf("Max") + 3)).toBe("115");
  });

  test("the path sections are unchanged", () => {
    expect(text).toContain("AAA (Driver AAA): alive");
    expect(text).toContain("alpha (Alpha): alive, 98 pts, max 199");
  });
});

describe("runCheck --json", () => {
  test("includes bestPosition in every WDC and WCC row", () => {
    const r = runCheck(["--db", dbPath, "--json"], "unused");
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout) as ReturnType<typeof buildCheckReport>;
    expect(json.wdc.map((x) => x.bestPosition)).toEqual([1, 1, 1, 4]);
    expect(json.wcc.map((x) => x.bestPosition)).toEqual([1, 1]);
    expect(json).toEqual(buildCheckReport(mini));
  });

  test("text output shows the column too", () => {
    const r = runCheck(["--db", dbPath], "unused");
    expect(r.stdout).toContain("Best");
    expect(r.stdout).toContain("P4");
  });
});

// ---------------------------------------------------------------------------------------------------
// Three teams, one race left: red 120 (ceiling 163), blue 90 (133), green 54 (97).
//   Drivers: AAA 75 (100), CCC 54 (79), BBB 45 (70), DDD 36 (61), EEE 30 (55), FFF 24 (49).
describe("a season where some are out", () => {
  const order = ["AAA", "CCC", "BBB", "DDD", "EEE", "FFF"];
  const s = makeState({
    rounds: 4,
    completed: 3,
    teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
    results: { "1:race": order, "2:race": order, "3:race": order },
  });
  const report = buildCheckReport(s);

  test("drivers by hand", () => {
    // BBB (70), DDD (61), EEE (55) have AAA's 75 above them; FFF (49) also has CCC's 54.
    expect(Object.fromEntries(report.wdc.map((r) => [r.driver, r.bestPosition]))).toEqual({
      AAA: 1, CCC: 1, BBB: 2, DDD: 2, EEE: 2, FFF: 3,
    });
  });

  test("teams by hand: green (97) has red's 120 above it, blue's 90 is not", () => {
    expect(Object.fromEntries(report.wcc.map((r) => [r.team, r.bestPosition]))).toEqual({ red: 1, blue: 1, green: 2 });
  });

  test("the text shows P2 and P3 on those rows", () => {
    const text = formatCheckReport(report, "x");
    expect(cell(text, DRIVER_HEAD, "Best", (l) => /^\d+\s+FFF /.test(l))).toBe("P3");
    expect(cell(text, DRIVER_HEAD, "Best", (l) => /^\d+\s+BBB /.test(l))).toBe("P2");
    expect(cell(text, TEAM_HEAD, "Best", (l) => /^\d+\s+green /.test(l))).toBe("P2");
  });
});

// ---------------------------------------------------------------------------------------------------
const FIXTURE = join(import.meta.dir, "fixtures", "season-2026-r16.json");

describe.skipIf(!existsSync(FIXTURE))("check report on the real Round 16 snapshot", () => {
  const real = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as SeasonState) : undefined!;
  const report = () => buildCheckReport(real);

  test("the numbers equal the engine's, for every driver and team", () => {
    const drivers = bestPositions(driverPositionEntries(driverStatus(real)));
    const teams = bestPositions(teamPositionEntries(teamStatus(real)));
    for (const r of report().wdc) expect(r.bestPosition).toBe(drivers.get(r.driver)!);
    for (const r of report().wcc) expect(r.bestPosition).toBe(teams.get(r.team)!);
  });

  test("and the ones listed in docs/PHASE_7.md", () => {
    const wdc = Object.fromEntries(report().wdc.map((r) => [r.driver, r.bestPosition]));
    expect(wdc).toMatchObject({ ANT: 1, NOR: 1, VER: 1, PIA: 2, GAS: 3, LIN: 3, COL: 4, ALB: 5, STR: 7, TSU: 20 });
    const wcc = Object.fromEntries(report().wcc.map((r) => [r.team, r.bestPosition]));
    expect(wcc).toMatchObject({ mercedes: 1, red_bull: 1, rb: 2, alpine: 3, cadillac: 3 });
  });

  test("the text tables show 'P3' for GAS and 'P20' for TSU", () => {
    const text = formatCheckReport(report(), "x");
    expect(cell(text, DRIVER_HEAD, "Best", (l) => /^\d+\s+GAS /.test(l))).toBe("P3");
    expect(cell(text, DRIVER_HEAD, "Best", (l) => /^\d+\s+TSU /.test(l))).toBe("P20");
    expect(cell(text, TEAM_HEAD, "Best", (l) => /^\d+\s+rb /.test(l))).toBe("P2");
  });

  test("best >= 2 exactly when the status is eliminated (racing drivers and teams)", () => {
    for (const r of report().wdc) if (r.driver !== "TSU") expect(r.bestPosition >= 2).toBe(r.status === "eliminated");
    for (const r of report().wcc) expect(r.bestPosition >= 2).toBe(r.status === "eliminated");
  });
});
