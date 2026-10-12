import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addClassifiedToFile, applyClassified, readClassified } from "../scripts/addClassified";
import { formatState } from "../scripts/exportFixture";
import { buildDb, cleanupDbs, defaultSeed } from "./dbHelpers";
import type { ResultRow, SeasonState } from "../engine/types";

const tmpDirs: string[] = [];
afterAll(() => {
  cleanupDbs();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The default seed's season as a flag-less fixture (what the Round 16 file looks like before Step 2). */
function legacyFixture(): SeasonState {
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
    })) as ResultRow[],
    qualifying: [],
    drivers: [],
    teams: [],
    health: { status: "ok", checkedAt: "2026-01-01T00:00:00Z" },
    schemaVersion: 2,
  };
}

function tempFixture(state: SeasonState): string {
  const dir = mkdtempSync(join(tmpdir(), "ttf-fx-"));
  tmpDirs.push(dir);
  const path = join(dir, "fixture.json");
  writeFileSync(path, formatState(state));
  return path;
}

const retireDdd = (seed: ReturnType<typeof defaultSeed>) => {
  const r = seed.results.find((x) => x.round === 1 && x.session === "Race" && x.abbr === "DDD");
  if (r) r.classified = false;
};

describe("readClassified", () => {
  test("keys are round:kind:driver and values follow is_classified", () => {
    const flags = readClassified(buildDb(retireDdd), 2026);
    expect(flags.size).toBe(10);
    expect(flags.get("1:race:DDD")).toBe(false);
    expect(flags.get("1:race:AAA")).toBe(true);
    expect(flags.get("2:sprint:BBB")).toBe(true);
  });
});

describe("applyClassified", () => {
  test("adds the flag to every row and changes nothing else", () => {
    const legacy = legacyFixture();
    const flags = readClassified(buildDb(retireDdd), 2026);
    const { rows, missing } = applyClassified(legacy.results, flags);
    expect(missing).toEqual([]);
    expect(rows).toHaveLength(legacy.results.length);
    expect(rows.filter((r) => !r.classified)).toHaveLength(1);
    const stripped = rows.map(({ classified: _c, ...rest }) => rest);
    expect(stripped).toEqual(legacy.results);
  });

  test("reports rows that have no match in the database", () => {
    const legacy = legacyFixture();
    legacy.results.push({ round: 9, kind: "race", driver: "ZZZ", team: "alpha", position: 1, points: 25 } as ResultRow);
    const flags = readClassified(buildDb(), 2026);
    const { missing } = applyClassified(legacy.results, flags);
    expect(missing).toEqual(["9:race:ZZZ"]);
  });
});

describe("addClassifiedToFile", () => {
  test("writes the flags and keeps the file otherwise identical", () => {
    const legacy = legacyFixture();
    const fixture = tempFixture(legacy);
    const summary = addClassifiedToFile(buildDb(retireDdd), fixture);
    expect(summary).toEqual({ rows: 10, nonClassified: 1 });

    const written = JSON.parse(readFileSync(fixture, "utf8")) as SeasonState;
    expect(written.results.every((r) => typeof r.classified === "boolean")).toBe(true);
    expect(written.results.filter((r) => !r.classified).map((r) => `${r.round}:${r.kind}:${r.driver}`)).toEqual(["1:race:DDD"]);
    expect({ ...written, results: [] }).toEqual({ ...legacy, results: [] });
  });

  test("running it twice gives the same file", () => {
    const fixture = tempFixture(legacyFixture());
    const db = buildDb(retireDdd);
    addClassifiedToFile(db, fixture);
    const first = readFileSync(fixture, "utf8");
    addClassifiedToFile(db, fixture);
    expect(readFileSync(fixture, "utf8")).toBe(first);
  });

  test("refuses to write when any row has no match, and leaves the file untouched", () => {
    const legacy = legacyFixture();
    legacy.results.push({ round: 9, kind: "race", driver: "ZZZ", team: "alpha", position: 1, points: 25 } as ResultRow);
    const fixture = tempFixture(legacy);
    const before = readFileSync(fixture, "utf8");
    expect(() => addClassifiedToFile(buildDb(), fixture)).toThrow(/9:race:ZZZ/);
    expect(readFileSync(fixture, "utf8")).toBe(before);
  });

  test("a database from another season is refused the same way", () => {
    const legacy = legacyFixture();
    legacy.season = 2025;
    const fixture = tempFixture(legacy);
    expect(() => addClassifiedToFile(buildDb(), fixture)).toThrow(/no match/);
  });
});
