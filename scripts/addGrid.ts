/**
 * Usage: bun scripts/addGrid.ts <path-to-f1gstats.sqlite> <fixture.json>
 *
 * Adds `grid` (from race_results.grid) to every result row of a fixture such as
 * tests/fixtures/season-2026-r16.json, matching on round, kind and driver. It does NOT re-export the fixture:
 * the database holds later rounds, and the fixture must stay the Round 16 snapshot. Nothing but the new fields changes.
 * Pit-lane starts (grid 0 in Ergast/Jolpica) are stored as the session field size.
 * The script refuses to write if any fixture row has no match in the database.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ResultRow, SeasonState } from "../engine/types";
import { formatState } from "./exportFixture";

export type LooseRow = Omit<ResultRow, "grid"> & { grid?: number };
export type LooseState = Omit<SeasonState, "results"> & { results: LooseRow[] };

const keyOf = (round: number, kind: string, driver: string) => `${round}:${kind}:${driver}`;

/** `round:kind:driver` -> starting grid, for one season of the database. */
export function readGrid(dbPath: string, season: number): Map<string, number> {
  if (!existsSync(dbPath)) throw new Error(`Database file not found: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query<{ round: number; session: string; driver_abbr: string; grid: number | null }, [number]>(
        "SELECT round, session, driver_abbr, grid FROM race_results WHERE season = ?",
      )
      .all(season);

    const sessionSizes = new Map<string, number>();
    for (const r of rows) {
      const sessKey = `${r.round}:${r.session.toLowerCase()}`;
      sessionSizes.set(sessKey, (sessionSizes.get(sessKey) ?? 0) + 1);
    }

    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.grid == null) continue;
      const sessKey = `${r.round}:${r.session.toLowerCase()}`;
      const fieldSize = sessionSizes.get(sessKey) ?? 0;
      const grid = r.grid === 0 ? fieldSize : r.grid;
      map.set(keyOf(r.round, r.session.toLowerCase(), r.driver_abbr), grid);
    }
    return map;
  } finally {
    db.close();
  }
}

export function applyGrid(
  results: readonly LooseRow[],
  grids: ReadonlyMap<string, number>,
): { rows: ResultRow[]; missing: string[] } {
  const missing: string[] = [];
  const rows: ResultRow[] = [];
  for (const row of results) {
    const key = keyOf(row.round, row.kind, row.driver);
    const grid = grids.get(key);
    if (grid === undefined) {
      missing.push(key);
      continue;
    }
    rows.push({ ...row, grid });
  }
  return { rows, missing };
}

export function addGridToFile(dbPath: string, fixturePath: string): { rows: number } {
  if (!existsSync(fixturePath)) throw new Error(`Fixture file not found: ${fixturePath}`);
  const state = JSON.parse(readFileSync(fixturePath, "utf8")) as LooseState;
  const grids = readGrid(dbPath, state.season);
  const { rows, missing } = applyGrid(state.results, grids);
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(", ");
    const more = missing.length > 5 ? ` and ${missing.length - 5} more` : "";
    throw new Error(
      `${missing.length} fixture row(s) have no match in the database for season ${state.season}: ${shown}${more}. Nothing was written.`,
    );
  }
  writeFileSync(fixturePath, formatState({ ...state, results: rows } as SeasonState));
  return { rows: rows.length };
}

if (import.meta.main) {
  const [dbPath, fixturePath] = process.argv.slice(2);
  if (!dbPath || !fixturePath || process.argv.length !== 4) {
    console.error("Usage: bun scripts/addGrid.ts <path-to-f1gstats.sqlite> <fixture.json>");
    process.exit(1);
  }
  try {
    const { rows } = addGridToFile(dbPath, fixturePath);
    console.log(`Wrote ${fixturePath}`);
    console.log(`${rows} result rows now carry "grid".`);
  } catch (err) {
    console.error(`${err instanceof Error ? err.name : "Error"}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
