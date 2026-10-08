/**
 * Usage: bun scripts/verifyStandings.ts [path-to-f1gstats.sqlite]
 * Compares the engine's base driver table (no locks) with F1GStats' own driver_standings:
 * same order and same points. Read-only. Defaults to F1GSTATS_DB from config.
 */
import { Database } from "bun:sqlite";
import { config } from "../config";
import { loadSeason } from "../data/loadSeason";
import { computeDriverStandings } from "../engine/standings";

export interface VerifyResult {
  ok: boolean;
  compared: number;
  mismatches: string[];
}

export function verifyBaseStandings(dbPath: string): VerifyResult {
  const state = loadSeason(dbPath);
  const db = new Database(dbPath, { readonly: true });
  let official: { driver_abbr: string; points: number }[];
  try {
    official = db
      .query<{ driver_abbr: string; points: number }, []>(
        "SELECT driver_abbr, points FROM driver_standings ORDER BY position, driver_abbr",
      )
      .all();
  } finally {
    db.close();
  }

  const table = computeDriverStandings(state);
  const mismatches: string[] = [];
  if (official.length !== table.length) {
    mismatches.push(`row count: driver_standings has ${official.length}, engine has ${table.length}`);
  }
  const n = Math.min(official.length, table.length);
  for (let i = 0; i < n; i++) {
    const o = official[i];
    const t = table[i];
    if (!o || !t) continue;
    if (o.driver_abbr !== t.id) {
      mismatches.push(`P${i + 1}: driver_standings has ${o.driver_abbr} (${o.points}), engine has ${t.id} (${t.points})`);
    } else if (o.points !== t.points) {
      mismatches.push(`P${i + 1} ${t.id}: driver_standings ${o.points} points, engine ${t.points}`);
    }
  }
  return { ok: mismatches.length === 0, compared: n, mismatches };
}

if (import.meta.main) {
  const dbPath = process.argv[2] ?? config.f1gstatsDb;
  try {
    const result = verifyBaseStandings(dbPath);
    if (result.ok) {
      console.log(`OK: engine base table matches driver_standings (${result.compared} drivers, order and points).`);
    } else {
      console.error(`MISMATCH (${result.mismatches.length}):`);
      for (const line of result.mismatches) console.error(`  ${line}`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`${err instanceof Error ? err.name : "Error"}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
