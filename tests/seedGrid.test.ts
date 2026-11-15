/**
 * Dev tool: scripts/seedGrid.ts adds a test starting grid to a COPY of the F1GStats database.
 * Default test season: rounds 1 and 2 done, standings AAA 57, BBB 41, CCC 39, DDD 12; DDD is not racing; round 3 is next.
 */
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSeason } from "../data/loadSeason";
import { resolveGrid } from "../engine/grid";
import { seedGrid } from "../scripts/seedGrid";
import { buildDb, cleanupDbs, sessionRows, type Seed } from "./dbHelpers";

const dir = mkdtempSync(join(tmpdir(), "ttf-seed-"));
let n = 0;
const out = () => join(dir, `copy-${++n}.sqlite`);

afterAll(() => {
  cleanupDbs();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // may still be open on Windows
  }
});

describe("seedGrid", () => {
  test("adds a grid for the next race: the racing drivers in championship order, shown as OpenF1", () => {
    const from = buildDb();
    const result = seedGrid({ from, out: out() });
    expect(result).toMatchObject({ round: 3, source: "openf1", order: ["AAA", "BBB", "CCC"] });
    const grid = loadSeason(result.out).upcomingGrid;
    expect(grid).toEqual({ round: 3, grid: { AAA: 1, BBB: 2, CCC: 3 }, source: "openf1" });
  });

  test("a qualifying test grid is stored the way F1GStats stores the qualifying fallback", () => {
    const result = seedGrid({ from: buildDb(), out: out(), source: "qualifying" });
    expect(loadSeason(result.out).upcomingGrid?.source).toBe("qualifying_fallback");
  });

  test("the original database is not changed", () => {
    const from = buildDb();
    const before = readFileSync(from);
    seedGrid({ from, out: out() });
    expect(readFileSync(from).equals(before)).toBe(true);
    expect(loadSeason(from).upcomingGrid).toBeUndefined();
  });

  test("the copy keeps everything else: the same season apart from the grid", () => {
    const from = buildDb();
    const result = seedGrid({ from, out: out() });
    expect({ ...loadSeason(result.out), upcomingGrid: undefined }).toEqual({ ...loadSeason(from), upcomingGrid: undefined });
  });

  test("replaces the grid of the next race only; other rounds keep theirs", () => {
    const from = buildDb((seed: Seed) => {
      seed.startingGrid = [
        { round: 3, abbr: "CCC", position: 1, source: "qualifying_fallback" },
        { round: 3, abbr: "BBB", position: 2, source: "qualifying_fallback" },
        { round: 4, abbr: "BBB", position: 1, source: "openf1" },
      ];
    });
    const result = seedGrid({ from, out: out() });
    const db = new Database(result.out, { readonly: true });
    const rows = db.query<{ round: number; driver_abbr: string; position: number }, []>("SELECT round, driver_abbr, position FROM starting_grid ORDER BY round, position").all();
    db.close();
    expect(rows.filter((r) => r.round === 3).map((r) => r.driver_abbr)).toEqual(["AAA", "BBB", "CCC"]);
    expect(rows.filter((r) => r.round === 4)).toEqual([{ round: 4, driver_abbr: "BBB", position: 1 }]);
  });

  test("running it again replaces the copy", () => {
    const from = buildDb();
    const target = out();
    seedGrid({ from, out: target });
    seedGrid({ from, out: target, source: "qualifying" });
    expect(loadSeason(target).upcomingGrid?.source).toBe("qualifying_fallback");
  });

  test("the test grid works with the manual grid: a different manual grid differs from the OpenF1 one", () => {
    const result = seedGrid({ from: buildDb(), out: out() });
    const state = loadSeason(result.out);
    const resolved = resolveGrid(state, { order: ["CCC", "BBB", "AAA"], pit: [] });
    expect(resolved.differs).toBe(true);
    expect(resolved.data?.source).toBe("openf1");
  });

  test("refuses to write over the original", () => {
    const from = buildDb();
    expect(() => seedGrid({ from, out: from })).toThrow("different file");
  });

  test("says so when the database is missing", () => {
    expect(() => seedGrid({ from: join(dir, "nope.sqlite"), out: out() })).toThrow("Database file not found");
  });

  test("says so when no race is left", () => {
    const from = buildDb((seed: Seed) => {
      const field: [string, string][] = [["AAA", "alpha"], ["BBB", "alpha"], ["CCC", "beta"]];
      seed.schedule = seed.schedule.map((r) => ({ ...r, status: "completed" }));
      seed.results = [...seed.results, ...sessionRows(3, "Race", field), ...sessionRows(4, "Sprint", field), ...sessionRows(4, "Race", field)];
    });
    expect(() => seedGrid({ from, out: out() })).toThrow("No race is left");
  });
});
