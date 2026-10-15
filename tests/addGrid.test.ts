import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addGridToFile, applyGrid, readGrid, type LooseRow, type LooseState } from "../scripts/addGrid";
import { formatState } from "../scripts/exportFixture";
import { buildDb, cleanupDbs, defaultSeed } from "./dbHelpers";
import type { ResultRow, SeasonState } from "../engine/types";

const tmpDirs: string[] = [];
afterAll(() => {
  cleanupDbs();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The default seed's season as a grid-less fixture. */
function gridlessFixture(): LooseState {
  const seed = defaultSeed();
  return {
    season: seed.season,
    asOfRound: 2,
    rounds: seed.schedule.map((s) => ({ round: s.round, name: s.name, hasSprint: s.hasSprint, status: s.status as "completed" | "scheduled" })),
    results: seed.results.map((r) => ({
      round: r.round,
      kind: r.session === "Race" ? "race" : "sprint",
      driver: r.abbr,
      team: r.constructorId!,
      position: r.position!,
      points: r.points,
      classified: r.classified ?? true,
    })),
    qualifying: [],
    drivers: [],
    teams: [],
    health: { status: "ok", checkedAt: "2026-01-01T00:00:00Z" },
    schemaVersion: 2,
  };
}

function tempFixture(state: LooseState | SeasonState): string {
  const dir = mkdtempSync(join(tmpdir(), "ttf-fx-"));
  tmpDirs.push(dir);
  const path = join(dir, "fixture.json");
  writeFileSync(path, formatState(state as SeasonState));
  return path;
}

const pitLaneDdd = (seed: ReturnType<typeof defaultSeed>) => {
  const r = seed.results.find((x) => x.round === 1 && x.session === "Race" && x.abbr === "DDD");
  if (r) r.grid = 0;
};

describe("readGrid", () => {
  test("keys are round:kind:driver and values follow grid", () => {
    const grids = readGrid(buildDb(), 2026);
    expect(grids.size).toBe(10);
    expect(grids.get("1:race:AAA")).toBe(1);
    expect(grids.get("1:race:BBB")).toBe(2);
    expect(grids.get("2:sprint:BBB")).toBe(1);
  });

  test("pit-lane start (grid 0) maps to session field size", () => {
    const grids = readGrid(buildDb(pitLaneDdd), 2026);
    // Round 1 Race has 4 drivers: AAA, BBB, CCC, DDD -> field size is 4
    expect(grids.get("1:race:DDD")).toBe(4);
  });
});

describe("applyGrid", () => {
  test("adds grid to every row and changes nothing else", () => {
    const gridless = gridlessFixture();
    const grids = readGrid(buildDb(pitLaneDdd), 2026);
    const { rows, missing } = applyGrid(gridless.results, grids);
    expect(missing).toEqual([]);
    expect(rows).toHaveLength(gridless.results.length);
    expect(rows.find((r) => r.round === 1 && r.kind === "race" && r.driver === "DDD")?.grid).toBe(4);
    const stripped = rows.map(({ grid: _g, ...rest }) => rest);
    expect(stripped).toEqual(gridless.results);
  });

  test("reports rows that have no match in the database", () => {
    const gridless = gridlessFixture();
    gridless.results.push({ round: 9, kind: "race", driver: "ZZZ", team: "alpha", position: 1, points: 25, classified: true });
    const grids = readGrid(buildDb(), 2026);
    const { missing } = applyGrid(gridless.results, grids);
    expect(missing).toEqual(["9:race:ZZZ"]);
  });
});

describe("addGridToFile", () => {
  test("writes grid and keeps the file otherwise identical", () => {
    const gridless = gridlessFixture();
    const fixture = tempFixture(gridless);
    const summary = addGridToFile(buildDb(pitLaneDdd), fixture);
    expect(summary).toEqual({ rows: 10 });

    const written = JSON.parse(readFileSync(fixture, "utf8")) as SeasonState;
    expect(written.results.every((r) => typeof r.grid === "number")).toBe(true);
    expect(written.results.find((r) => r.round === 1 && r.kind === "race" && r.driver === "DDD")?.grid).toBe(4);
    expect({ ...written, results: [] }).toEqual({ ...gridless, results: [] });
  });

  test("running it twice gives the same file", () => {
    const fixture = tempFixture(gridlessFixture());
    const db = buildDb(pitLaneDdd);
    addGridToFile(db, fixture);
    const first = readFileSync(fixture, "utf8");
    addGridToFile(db, fixture);
    expect(readFileSync(fixture, "utf8")).toBe(first);
  });

  test("refuses to write when any row has no match, and leaves the file untouched", () => {
    const gridless = gridlessFixture();
    gridless.results.push({ round: 9, kind: "race", driver: "ZZZ", team: "alpha", position: 1, points: 25, classified: true });
    const fixture = tempFixture(gridless);
    const before = readFileSync(fixture, "utf8");
    expect(() => addGridToFile(buildDb(), fixture)).toThrow(/9:race:ZZZ/);
    expect(readFileSync(fixture, "utf8")).toBe(before);
  });

  test("a database from another season is refused the same way", () => {
    const gridless = gridlessFixture();
    gridless.season = 2025;
    const fixture = tempFixture(gridless);
    expect(() => addGridToFile(buildDb(), fixture)).toThrow(/no match/);
  });
});
