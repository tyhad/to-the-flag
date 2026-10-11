/**
 * Read-only loader for f1gstats.sqlite -> SeasonState.
 * One of the only places (with scripts/) that may touch the database or the file system.
 * Never writes to the database. See docs/PHASE_1.md decisions a, c, d, e.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import type { QualiRow, ResultRow, RoundInfo, SeasonState } from "../engine/types";

export const MIN_SCHEMA_VERSION = 2;
const POINTS_EPSILON = 1e-6;

export class SchemaVersionError extends Error {
  constructor(
    readonly found: number,
    readonly required: number = MIN_SCHEMA_VERSION,
  ) {
    super(`f1gstats.sqlite has meta.schema_version ${found}, but ${required} or newer is required. Re-run F1GStats.`);
    this.name = "SchemaVersionError";
  }
}

export class DataInconsistentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataInconsistentError";
  }
}

interface ScheduleDb { round: number; race_name: string | null; has_sprint: number; status: string }
interface ResultDb {
  round: number; session: string; driver_abbr: string; driver_name: string | null;
  team_name: string | null; constructor_id: string | null; position: number | null; points: number;
}
interface StandingDb { driver_abbr: string; driver_name: string | null; points: number }
interface QualiDb { round: number; driver_abbr: string; position: number | null }
interface HealthDb { status: string; checked_at: string }

function tableExists(db: Database, name: string): boolean {
  return db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;
}

function readSchemaVersion(db: Database): number {
  if (!tableExists(db, "meta")) return 1; // implicit version 1, before Phase 0
  const row = db.query<{ value: string | null }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get();
  const version = Number(row?.value);
  return row?.value != null && Number.isFinite(version) ? version : 1;
}

function readMeta(db: Database, key: string): string | null {
  return db.query<{ value: string | null }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
}

export function loadSeason(dbPath: string): SeasonState {
  if (!existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath} (set F1GSTATS_DB or pass the path)`);
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    return readSeason(db);
  } finally {
    db.close();
  }
}

function readSeason(db: Database): SeasonState {
  const version = readSchemaVersion(db);
  if (version < MIN_SCHEMA_VERSION) throw new SchemaVersionError(version);

  const season = Number(readMeta(db, "season"));
  if (!Number.isInteger(season)) throw new DataInconsistentError("meta.season is missing or not an integer");

  // Calendar
  const scheduleRows = db
    .query<ScheduleDb, [number]>(
      "SELECT round, race_name, has_sprint, status FROM schedule_full WHERE season = ? ORDER BY round",
    )
    .all(season);
  if (scheduleRows.length === 0) throw new DataInconsistentError(`schedule_full has no rows for season ${season}`);
  const rounds: RoundInfo[] = scheduleRows.map((r) => {
    if (r.status !== "completed" && r.status !== "scheduled") {
      throw new DataInconsistentError(`schedule_full round ${r.round}: unknown status "${r.status}"`);
    }
    return {
      round: r.round,
      name: r.race_name ?? `Round ${r.round}`,
      hasSprint: r.has_sprint !== 0,
      status: r.status,
    };
  });
  const roundNumbers = new Set(rounds.map((r) => r.round));
  const asOfRound = Math.max(0, ...rounds.filter((r) => r.status === "completed").map((r) => r.round));

  // Results (decision d: team = constructor_id)
  const resultRows = db
    .query<ResultDb, [number]>(
      `SELECT round, session, driver_abbr, driver_name, team_name, constructor_id, position, points
       FROM race_results WHERE season = ? ORDER BY round, session, position`,
    )
    .all(season);
  const results: ResultRow[] = [];
  const driverNames = new Map<string, string>();
  const teamNames = new Map<string, string>();
  for (const r of resultRows) {
    const where = `race_results round ${r.round} ${r.session} ${r.driver_abbr}`;
    if (r.session !== "Race" && r.session !== "Sprint") {
      throw new DataInconsistentError(`${where}: unknown session "${r.session}"`);
    }
    if (!roundNumbers.has(r.round)) {
      throw new DataInconsistentError(`${where}: round ${r.round} is not in schedule_full`);
    }
    if (r.position == null) throw new DataInconsistentError(`${where}: position is null`);
    if (!r.constructor_id) throw new DataInconsistentError(`${where}: constructor_id is empty`);
    results.push({
      round: r.round,
      kind: r.session === "Race" ? "race" : "sprint",
      driver: r.driver_abbr,
      team: r.constructor_id,
      position: r.position,
      points: r.points,
    });
    if (r.driver_name) driverNames.set(r.driver_abbr, r.driver_name);
    teamNames.set(r.constructor_id, r.team_name || r.constructor_id);
  }

  // Decision e: a completed round must have every session
  const have = new Set(results.map((r) => `${r.round}:${r.kind}`));
  for (const round of rounds) {
    if (round.status !== "completed") continue;
    const missing = [`${round.round}:race`, ...(round.hasSprint ? [`${round.round}:sprint`] : [])].filter(
      (key) => !have.has(key),
    );
    if (missing.length > 0) {
      throw new DataInconsistentError(
        `Round ${round.round} is completed but has no results for: ${missing.join(", ")}`,
      );
    }
  }

  // Decision c: points from results must equal driver_standings
  const standings = db
    .query<StandingDb, []>("SELECT driver_abbr, driver_name, points FROM driver_standings")
    .all();
  const sums = new Map<string, number>();
  for (const r of results) sums.set(r.driver, (sums.get(r.driver) ?? 0) + r.points);
  const standingPoints = new Map(standings.map((s) => [s.driver_abbr, s.points]));
  const mismatches: string[] = [];
  for (const [code, pts] of standingPoints) {
    const sum = sums.get(code) ?? 0;
    if (Math.abs(sum - pts) > POINTS_EPSILON) mismatches.push(`${code} (standings ${pts}, results ${sum})`);
  }
  for (const [code, sum] of sums) {
    if (!standingPoints.has(code) && Math.abs(sum) > POINTS_EPSILON) {
      mismatches.push(`${code} (not in standings, results ${sum})`);
    }
  }
  if (mismatches.length > 0) {
    const shown = mismatches.slice(0, 5).join("; ");
    const more = mismatches.length > 5 ? ` and ${mismatches.length - 5} more` : "";
    throw new DataInconsistentError(`driver_standings points differ from race_results for: ${shown}${more}`);
  }

  // Qualifying (optional table). A missing position means no placement that round.
  const qualifying: QualiRow[] = tableExists(db, "qualifying_results")
    ? db
        .query<QualiDb, [number]>(
          "SELECT round, driver_abbr, position FROM qualifying_results WHERE season = ? ORDER BY round, position",
        )
        .all(season)
        .flatMap((q) => (q.position == null ? [] : [{ round: q.round, driver: q.driver_abbr, position: q.position }]))
    : [];

  // Drivers (decision a) and teams
  for (const s of standings) if (s.driver_name) driverNames.set(s.driver_abbr, s.driver_name);
  const activeCodes = new Set(results.filter((r) => r.round === asOfRound).map((r) => r.driver));
  const codes = new Set<string>([...standingPoints.keys(), ...sums.keys()]);
  const drivers = [...codes]
    .sort()
    .map((code) => ({ code, name: driverNames.get(code) ?? code, active: activeCodes.has(code) }));
  const teams = [...teamNames.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, name]) => ({ id, name }));

  // Health: latest row
  const healthRow = db
    .query<HealthDb, [number]>("SELECT status, checked_at FROM data_health WHERE season = ? ORDER BY id DESC LIMIT 1")
    .get(season);
  if (!healthRow) throw new DataInconsistentError(`data_health has no row for season ${season}`);
  if (healthRow.status !== "ok" && healthRow.status !== "warn" && healthRow.status !== "fail") {
    throw new DataInconsistentError(`data_health: unknown status "${healthRow.status}"`);
  }

  return {
    season,
    asOfRound,
    rounds,
    results,
    qualifying,
    drivers,
    teams,
    health: { status: healthRow.status, checkedAt: healthRow.checked_at },
    schemaVersion: version,
  };
}
