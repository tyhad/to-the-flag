/**
 * Test-only: builds a tiny F1GStats-shaped SQLite file (schema_version 2) in a temp dir.
 * Default season (4 rounds, 4 drivers, 2 teams):
 *   R1 (no sprint, completed)  R2 (sprint, completed)  R3 (no sprint, scheduled)  R4 (sprint, scheduled)
 *   Standings: AAA 57, BBB 41, CCC 39, DDD 12 (sum 149). DDD is absent from R2, so inactive.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gpPoints, sprintPoints } from "../engine/points";

export interface SeedResult {
  round: number;
  session: "Race" | "Sprint";
  abbr: string;
  name: string;
  teamName: string | null;
  constructorId: string | null;
  position: number | null;
  points: number;
}

export interface Seed {
  /** null = no schema_version key in meta */
  schemaVersion: number | null;
  season: number;
  schedule: { round: number; name: string; hasSprint: boolean; status: string }[];
  results: SeedResult[];
  /** null = the qualifying_results table does not exist */
  qualifying: { round: number; abbr: string; position: number | null }[] | null;
  /** null = computed from results */
  standings: { abbr: string; name: string; points: number }[] | null;
  health: { status: string; checkedAt: string }[];
}

const TEAM_NAMES: Record<string, string> = { alpha: "Alpha", beta: "Beta" };

export function sessionRows(
  round: number,
  session: "Race" | "Sprint",
  order: [abbr: string, constructorId: string][],
): SeedResult[] {
  return order.map(([abbr, constructorId], i) => ({
    round,
    session,
    abbr,
    name: `Driver ${abbr}`,
    teamName: TEAM_NAMES[constructorId] ?? constructorId,
    constructorId,
    position: i + 1,
    points: session === "Race" ? gpPoints(i + 1) : sprintPoints(i + 1),
  }));
}

export function defaultSeed(): Seed {
  return {
    schemaVersion: 2,
    season: 2026,
    schedule: [
      { round: 1, name: "GP One", hasSprint: false, status: "completed" },
      { round: 2, name: "GP Two", hasSprint: true, status: "completed" },
      { round: 3, name: "GP Three", hasSprint: false, status: "scheduled" },
      { round: 4, name: "GP Four", hasSprint: true, status: "scheduled" },
    ],
    results: [
      ...sessionRows(1, "Race", [["AAA", "alpha"], ["BBB", "alpha"], ["CCC", "beta"], ["DDD", "beta"]]),
      ...sessionRows(2, "Sprint", [["BBB", "alpha"], ["AAA", "alpha"], ["CCC", "beta"]]),
      ...sessionRows(2, "Race", [["AAA", "alpha"], ["CCC", "beta"], ["BBB", "alpha"]]),
    ],
    qualifying: [
      { round: 1, abbr: "AAA", position: 1 },
      { round: 1, abbr: "BBB", position: 2 },
      { round: 1, abbr: "CCC", position: 3 },
      { round: 1, abbr: "DDD", position: 4 },
      { round: 2, abbr: "BBB", position: 1 },
      { round: 2, abbr: "AAA", position: 2 },
      { round: 2, abbr: "CCC", position: null }, // missing placement
    ],
    standings: null,
    health: [
      { status: "warn", checkedAt: "2026-03-01T10:00:00Z" },
      { status: "ok", checkedAt: "2026-03-08T10:00:00Z" },
    ],
  };
}

const dirs: string[] = [];

export function cleanupDbs(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Builds a database from the default seed, optionally changed by `mutate`. Returns the file path. */
export function buildDb(mutate?: (seed: Seed) => void): string {
  const seed = defaultSeed();
  mutate?.(seed);

  const dir = mkdtempSync(join(tmpdir(), "ttf-"));
  dirs.push(dir);
  const path = join(dir, "f1gstats.sqlite");
  const db = new Database(path, { create: true });

  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.query("INSERT INTO meta (key, value) VALUES (?, ?)").run("season", String(seed.season));
  if (seed.schemaVersion !== null) {
    db.query("INSERT INTO meta (key, value) VALUES (?, ?)").run("schema_version", String(seed.schemaVersion));
  }

  db.run(`CREATE TABLE driver_standings (
    id INTEGER PRIMARY KEY, position INTEGER, driver_name TEXT, driver_abbr TEXT, team_name TEXT,
    points REAL, wins INTEGER, podiums INTEGER, dnf_dns INTEGER)`);
  db.run(`CREATE TABLE schedule_full (
    season INTEGER NOT NULL, round INTEGER NOT NULL, race_name TEXT, has_sprint INTEGER NOT NULL,
    race_start_utc TEXT, sprint_start_utc TEXT, status TEXT NOT NULL, PRIMARY KEY (season, round))`);
  db.run(`CREATE TABLE race_results (
    season INTEGER NOT NULL, round INTEGER NOT NULL, session TEXT NOT NULL, driver_abbr TEXT NOT NULL,
    driver_name TEXT, team_name TEXT, constructor_id TEXT, grid INTEGER, position INTEGER,
    position_text TEXT, points REAL NOT NULL, status TEXT, is_classified INTEGER NOT NULL,
    PRIMARY KEY (season, round, session, driver_abbr))`);
  db.run(`CREATE TABLE data_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT, season INTEGER NOT NULL, checked_at TEXT NOT NULL,
    status TEXT NOT NULL, details_json TEXT NOT NULL)`);
  if (seed.qualifying !== null) {
    db.run(`CREATE TABLE qualifying_results (
      season INTEGER NOT NULL, round INTEGER NOT NULL, driver_abbr TEXT NOT NULL, position INTEGER,
      PRIMARY KEY (season, round, driver_abbr))`);
  }

  for (const s of seed.schedule) {
    db.query(
      "INSERT INTO schedule_full (season, round, race_name, has_sprint, status) VALUES (?, ?, ?, ?, ?)",
    ).run(seed.season, s.round, s.name, s.hasSprint ? 1 : 0, s.status);
  }
  for (const r of seed.results) {
    db.query(
      `INSERT INTO race_results (season, round, session, driver_abbr, driver_name, team_name,
        constructor_id, position, points, is_classified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(seed.season, r.round, r.session, r.abbr, r.name, r.teamName, r.constructorId, r.position, r.points);
  }
  for (const q of seed.qualifying ?? []) {
    db.query("INSERT INTO qualifying_results (season, round, driver_abbr, position) VALUES (?, ?, ?, ?)").run(
      seed.season, q.round, q.abbr, q.position,
    );
  }
  for (const h of seed.health) {
    db.query("INSERT INTO data_health (season, checked_at, status, details_json) VALUES (?, ?, ?, '[]')").run(
      seed.season, h.checkedAt, h.status,
    );
  }

  let standings = seed.standings;
  if (standings === null) {
    const sums = new Map<string, { name: string; points: number }>();
    for (const r of seed.results) {
      const cur = sums.get(r.abbr) ?? { name: r.name, points: 0 };
      cur.points += r.points;
      sums.set(r.abbr, cur);
    }
    standings = [...sums.entries()].map(([abbr, v]) => ({ abbr, ...v }));
  }
  standings
    .slice()
    .sort((a, b) => b.points - a.points)
    .forEach((s, i) => {
      db.query(
        `INSERT INTO driver_standings (position, driver_name, driver_abbr, team_name, points, wins, podiums, dnf_dns)
         VALUES (?, ?, ?, 'x', ?, 0, 0, 0)`,
      ).run(i + 1, s.name, s.abbr, s.points);
    });

  db.close();
  return path;
}
