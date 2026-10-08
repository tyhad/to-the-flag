/**
 * Sanity checks on the REAL data snapshot (tests/fixtures/season-2026-r16.json),
 * created with `bun scripts/exportFixture.ts <db> tests/fixtures/season-2026-r16.json`.
 * Numbers come from the table in docs/PHASE_1.md ("What exists"). Skipped if the file is absent.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sessionMaxPoints, teamSessionMaxPoints } from "../engine/points";
import { computeConstructorStandings, computeDriverStandings } from "../engine/standings";
import { driverStatus } from "../engine/status";
import { solveWdc } from "../engine/solver";
import { validateScenario } from "../engine/scenario";
import { buildCheckReport } from "../scripts/check";
import type { Scenario } from "../engine/types";
import { activeDrivers, parseSessionKey, remainingSessions } from "../engine/sessions";
import type { SeasonState } from "../engine/types";

const FIXTURE = join(import.meta.dir, "fixtures", "season-2026-r16.json");

describe.skipIf(!existsSync(FIXTURE))("real fixture season-2026-r16", () => {
  // describe bodies still run when skipped, so read the file lazily
  let cached: SeasonState | undefined;
  const load = (): SeasonState => (cached ??= JSON.parse(readFileSync(FIXTURE, "utf8")) as SeasonState);
  const remaining = () => remainingSessions(load()).map(parseSessionKey);

  test("calendar: 23 rounds, 6 sprint weekends, 16 completed, as of round 16", () => {
    const state = load();
    expect(state.season).toBe(2026);
    expect(state.rounds).toHaveLength(23);
    expect(state.rounds.filter((r) => r.hasSprint)).toHaveLength(6);
    expect(state.rounds.filter((r) => r.status === "completed")).toHaveLength(16);
    expect(state.asOfRound).toBe(16);
  });

  test("result rows: 352 race (16 x 22), 110 sprint (5 x 22)", () => {
    const state = load();
    expect(state.results.filter((r) => r.kind === "race")).toHaveLength(352);
    expect(state.results.filter((r) => r.kind === "sprint")).toHaveLength(110);
  });

  test("qualifying: 347 rows (5 missing)", () => {
    const state = load();
    expect(state.qualifying).toHaveLength(347);
  });

  test("23 drivers: 22 active, 1 inactive; 11 constructors", () => {
    const state = load();
    expect(state.drivers).toHaveLength(23);
    expect(activeDrivers(state)).toHaveLength(22);
    expect(state.drivers.filter((d) => !d.active)).toHaveLength(1);
    expect(state.teams).toHaveLength(11);
  });

  test("sum of all points is 1796", () => {
    const state = load();
    expect(state.results.reduce((a, r) => a + r.points, 0)).toBe(1796);
  });

  test("remaining sessions: 7 races + 1 sprint", () => {
    expect(remaining()).toHaveLength(8);
    expect(remaining().filter((s) => s.kind === "race")).toHaveLength(7);
    expect(remaining().filter((s) => s.kind === "sprint")).toHaveLength(1);
  });

  test("max points still available: driver 183, team 316", () => {
    expect(remaining().reduce((a, s) => a + sessionMaxPoints(s.kind), 0)).toBe(183);
    expect(remaining().reduce((a, s) => a + teamSessionMaxPoints(s.kind), 0)).toBe(316);
  });

  test("base driver table: 23 rows, ranks 1..23, points sum to 1796, no deltas", () => {
    const rows = computeDriverStandings(load());
    expect(rows).toHaveLength(23);
    expect(rows.map((r) => r.rank)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(rows.reduce((a, r) => a + r.points, 0)).toBe(1796);
    expect(rows.every((r) => r.delta === 0 && r.baseRank === r.rank)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.points).toBeGreaterThanOrEqual(rows[i]!.points);
  });

  test("base constructor table: 11 rows, points sum to 1796", () => {
    const rows = computeConstructorStandings(load());
    expect(rows).toHaveLength(11);
    expect(rows.reduce((a, r) => a + r.points, 0)).toBe(1796);
  });

  test("title status: maxPossible - points is 183 for every active driver, 0 for the inactive one", () => {
    const state = load();
    const active = new Set(activeDrivers(state));
    const rows = driverStatus(state);
    expect(rows).toHaveLength(23);
    for (const r of rows) expect(r.maxPossible - r.points).toBe(active.has(r.driver) ? 183 : 0);
  });

  test("title status at round 16: six alive, nobody clinched, everyone else eliminated", () => {
    const rows = driverStatus(load());
    const alive = rows.filter((r) => r.status === "alive").map((r) => r.driver).sort();
    expect(alive).toEqual(["ANT", "HAM", "LEC", "NOR", "RUS", "VER"]);
    expect(rows.some((r) => r.status === "clinched")).toBe(false);
    expect(rows.filter((r) => r.status === "eliminated")).toHaveLength(17);
    const leader = rows[0];
    expect(leader?.driver).toBe("ANT");
    expect(leader?.gapToLeader).toBe(0);
    expect(leader?.pointsToClinch).toBe(100);
  });

  test("path solver: NOR needs 133 of 183, matches the hand calculation", () => {
    // 133 = 7 races x P2 (18) + 1 sprint x P2 (7); ANT leads on 320, NOR has 188.
    const r = solveWdc(load(), "NOR");
    expect(r).toMatchObject({ verdict: "alive", exact: true, points: 188, maxPossible: 371, pointsNeeded: 133 });
    expect(r.difficulty).toBeCloseTo(133 / 183, 10);
    // If NOR wins everything: ANT may still score 50 (never better than P7), the others 134-182 (never better than P2).
    expect(r.rivalBudgets).toEqual([
      { driver: "ANT", budget: 50, paceLimit: 7 },
      { driver: "RUS", budget: 134, paceLimit: 2 },
      { driver: "HAM", budget: 156, paceLimit: 2 },
      { driver: "LEC", budget: 179, paceLimit: 2 },
      { driver: "VER", budget: 182, paceLimit: 2 },
    ]);
  });

  test("path solver: every contender has a valid easiest scenario; the eliminated have none", () => {
    const state = load();
    for (const row of driverStatus(state)) {
      const r = solveWdc(state, row.driver);
      expect(r.verdict).toBe(row.status);
      expect(r.exact).toBe(true);
      if (row.status === "eliminated") {
        expect(r.easiest).toBeNull();
        expect(r.minWins).toBeNull();
        expect(r.pointsNeeded).toBeNull();
      } else {
        expect(r.easiest).not.toBeNull();
        expect(() => validateScenario(state, r.easiest!)).not.toThrow();
      }
    }
  });

  test("path solver: PIA is eliminated because ANT's budget is negative (-10)", () => {
    const r = solveWdc(load(), "PIA");
    expect(r.maxPossible).toBe(311);
    expect(r.rivalBudgets.find((b) => b.driver === "ANT")).toEqual({ driver: "ANT", budget: -10, paceLimit: null });
  });

  test("hand check (Phase 1 done rule 4): ANT wins all 8 remaining sessions, RUS is P2 in all", () => {
    // By hand: ANT 320 + 7 x 25 + 8 = 503. RUS 236 + 7 x 18 + 7 = 369. Everyone else keeps their points.
    const state = load();
    const locks: Scenario["locks"] = {};
    for (const key of remainingSessions(state)) locks[key] = { fixed: { ANT: 1, RUS: 2 } };
    const rows = computeDriverStandings(state, { locks });
    const pts = Object.fromEntries(rows.map((r) => [r.id, r.points]));
    expect(pts.ANT).toBe(503);
    expect(pts.RUS).toBe(369);
    expect(pts.HAM).toBe(214);
    expect(pts.LEC).toBe(191);
    expect(pts.NOR).toBe(188);
    expect(pts.VER).toBe(188);
    expect(rows.map((r) => r.id).slice(0, 3)).toEqual(["ANT", "RUS", "HAM"]);
    const status = driverStatus(state, { locks });
    expect(status.find((r) => r.driver === "ANT")?.status).toBe("clinched");
    expect(status.filter((r) => r.status === "eliminated")).toHaveLength(22);
  });

  test("check report: round 16, 8 sessions left, 22 active + TSU inactive, 23 rows, 6 paths", () => {
    const report = buildCheckReport(load());
    expect(report.health.status).toBe("ok");
    expect(report.asOfRound).toBe(16);
    expect(report.remaining).toMatchObject({ races: 7, sprints: 1 });
    expect(report.remaining.sessions).toHaveLength(8);
    expect(report.drivers).toEqual({ active: 22, inactive: 1, inactiveCodes: ["TSU"] });
    expect(report.wdc).toHaveLength(23);
    expect(report.wdc[0]).toMatchObject({ rank: 1, driver: "ANT", points: 320, status: "alive" });
    expect(report.paths.map((p) => p.driver)).toEqual(["ANT", "RUS", "HAM", "LEC", "NOR", "VER"]);
  });
});
