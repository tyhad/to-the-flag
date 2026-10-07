/**
 * Sanity checks on the REAL data snapshot (tests/fixtures/season-2026-r16.json),
 * created with `bun scripts/exportFixture.ts <db> tests/fixtures/season-2026-r16.json`.
 * Numbers come from the table in docs/PHASE_1.md ("What exists"). Skipped if the file is absent.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sessionMaxPoints, teamSessionMaxPoints } from "../engine/points";
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
});
