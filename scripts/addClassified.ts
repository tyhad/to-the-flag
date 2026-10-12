/**
 * Usage: bun scripts/addClassified.ts <path-to-f1gstats.sqlite> <fixture.json>
 *
 * Adds `classified` (from race_results.is_classified) to every result row of a fixture such as
 * tests/fixtures/season-2026-r16.json, matching on round, kind and driver. It does NOT re-export the fixture:
 * the database holds later rounds, and the fixture must stay the Round 16 snapshot. Nothing but the new flags changes.
 * The script refuses to write if any fixture row has no match in the database.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ResultRow, SeasonState } from "../engine/types";
import { formatState } from "./exportFixture";

type LooseRow = Omit<ResultRow, "classified"> & { classified?: boolean };
type LooseState = Omit<SeasonState, "results"> & { results: LooseRow[] };

const keyOf = (round: number, kind: string, driver: string) => `${round}:${kind}:${driver}`;

/** `round:kind:driver` -> classified, for one season of the database. */
export function readClassified(dbPath: string, season: number): Map<string, boolean> {
  if (!existsSync(dbPath)) throw new Error(`Database file not found: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query<{ round: number; session: string; driver_abbr: string; is_classified: number }, [number]>(
        "SELECT round, session, driver_abbr, is_classified FROM race_results WHERE season = ?",
      )
      .all(season);
    return new Map(rows.map((r) => [keyOf(r.round, r.session.toLowerCase(), r.driver_abbr), r.is_classified !== 0]));
  } finally {
    db.close();
  }
}

export function applyClassified(
  results: readonly LooseRow[],
  flags: ReadonlyMap<string, boolean>,
): { rows: ResultRow[]; missing: string[] } {
  const missing: string[] = [];
  const rows: ResultRow[] = [];
  for (const row of results) {
    const key = keyOf(row.round, row.kind, row.driver);
    const classified = flags.get(key);
    if (classified === undefined) {
      missing.push(key);
      continue;
    }
    rows.push({ ...row, classified });
  }
  return { rows, missing };
}

export function addClassifiedToFile(dbPath: string, fixturePath: string): { rows: number; nonClassified: number } {
  if (!existsSync(fixturePath)) throw new Error(`Fixture file not found: ${fixturePath}`);
  const state = JSON.parse(readFileSync(fixturePath, "utf8")) as LooseState;
  const flags = readClassified(dbPath, state.season);
  const { rows, missing } = applyClassified(state.results, flags);
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(", ");
    const more = missing.length > 5 ? ` and ${missing.length - 5} more` : "";
    throw new Error(
      `${missing.length} fixture row(s) have no match in the database for season ${state.season}: ${shown}${more}. Nothing was written.`,
    );
  }
  writeFileSync(fixturePath, formatState({ ...state, results: rows } as SeasonState));
  return { rows: rows.length, nonClassified: rows.filter((r) => !r.classified).length };
}

if (import.meta.main) {
  const [dbPath, fixturePath] = process.argv.slice(2);
  if (!dbPath || !fixturePath || process.argv.length !== 4) {
    console.error("Usage: bun scripts/addClassified.ts <path-to-f1gstats.sqlite> <fixture.json>");
    process.exit(1);
  }
  try {
    const { rows, nonClassified } = addClassifiedToFile(dbPath, fixturePath);
    console.log(`Wrote ${fixturePath}`);
    console.log(`${rows} result rows now carry "classified"; ${nonClassified} are false (DNF or not classified).`);
  } catch (err) {
    console.error(`${err instanceof Error ? err.name : "Error"}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
