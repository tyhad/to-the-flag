/**
 * Dev only. Usage: bun scripts/seedGrid.ts [--from <f1gstats.sqlite>] [--out <file.sqlite>] [--source openf1|qualifying]
 *
 * Copies the F1GStats database to a separate file and adds a TEST starting grid for the next race (the active drivers
 * in championship order), so the Race tab, the source tags and the "OpenF1 has a different grid" notice can be tried
 * before qualifying, or any time the real data has no grid. The original database is only read, never changed.
 *
 *   --from    the database to copy (default: F1GSTATS_DB, or ../F1GStats/f1gstats.sqlite)
 *   --out     the copy to write (default: ./test-grid.sqlite; an existing file there is replaced)
 *   --source  what the test grid pretends to be: openf1 (default) or qualifying
 *
 * Then start the app on the copy:  F1GSTATS_DB=./test-grid.sqlite bun run dev
 * (PowerShell: $env:F1GSTATS_DB="./test-grid.sqlite"; bun run dev)
 * Do not use the copy for anything real: its grid is invented.
 */
import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config";
import { loadSeason } from "../data/loadSeason";
import { activeDrivers } from "../engine/sessions";
import { nextScheduledRound } from "../engine/grid";
import { teamCars } from "../engine/teams";

export type SeedSource = "openf1" | "qualifying";

export interface SeedOptions {
  from: string;
  out: string;
  source?: SeedSource;
}

export interface SeedResult {
  out: string;
  round: number;
  source: SeedSource;
  /** The test grid, pole first. */
  order: string[];
}

/** The `grid_source` text F1GStats writes for each kind of grid. */
const GRID_SOURCE: Record<SeedSource, string> = { openf1: "openf1", qualifying: "qualifying_fallback" };

export function seedGrid(options: SeedOptions): SeedResult {
  const source = options.source ?? "openf1";
  const from = resolve(options.from);
  const out = resolve(options.out);
  if (from === out) throw new Error("--out must be a different file from --from: the original database is never changed.");
  if (!existsSync(from)) throw new Error(`Database file not found: ${from} (use --from, or set F1GSTATS_DB)`);

  const state = loadSeason(from);
  const round = nextScheduledRound(state);
  if (round === null) throw new Error("No race is left in this season, so there is no next race to give a grid to.");

  // Championship order: points so far, then code. Only drivers who are racing.
  const points = new Map<string, number>();
  for (const r of state.results) points.set(r.driver, (points.get(r.driver) ?? 0) + r.points);
  const order = [...activeDrivers(state)].sort((a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  if (order.length < 2) throw new Error("Fewer than two drivers are racing, so there is no grid to make.");

  const names = new Map(state.drivers.map((d) => [d.code, d.name]));
  const teamNames = new Map(state.teams.map((t) => [t.id, t.name]));
  const teamOf = new Map<string, string>();
  for (const [team, codes] of teamCars(state)) for (const code of codes) teamOf.set(code, teamNames.get(team) ?? team);

  if (existsSync(out)) rmSync(out);
  const original = new Database(from, { readonly: true });
  try {
    original.query("VACUUM INTO ?").run(out);
  } finally {
    original.close();
  }

  const copy = new Database(out);
  try {
    copy.run(`CREATE TABLE IF NOT EXISTS starting_grid (
      id INTEGER PRIMARY KEY AUTOINCREMENT, round INTEGER, round_relation TEXT, position INTEGER,
      driver_name TEXT, driver_abbr TEXT, team_name TEXT, grid_source TEXT
    )`);
    // Only this race's rows are replaced; the grids of other rounds stay as they were.
    copy.query("DELETE FROM starting_grid WHERE round = ?").run(round);
    const insert = copy.query(
      "INSERT INTO starting_grid (round, round_relation, position, driver_name, driver_abbr, team_name, grid_source) VALUES (?, 'next', ?, ?, ?, ?, ?)",
    );
    order.forEach((code, i) => insert.run(round, i + 1, names.get(code) ?? code, code, teamOf.get(code) ?? "", GRID_SOURCE[source]));
  } finally {
    copy.close();
  }
  return { out, round, source, order };
}

function parseArgs(argv: string[]): SeedOptions {
  const config = loadConfig();
  const options: SeedOptions = { from: config.f1gstatsDb, out: "./test-grid.sqlite" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--from" || flag === "--out" || flag === "--source") {
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
      i++;
      if (flag === "--from") options.from = value;
      else if (flag === "--out") options.out = value;
      else if (value === "openf1" || value === "qualifying") options.source = value;
      else throw new Error('--source must be "openf1" or "qualifying".');
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const result = seedGrid(parseArgs(process.argv.slice(2)));
    console.log(`Wrote ${result.out}`);
    console.log(`Test grid for round ${result.round}, shown as "${result.source}": ${result.order.join(" ")}`);
    console.log("");
    console.log("Start the app on the copy:");
    console.log(`  F1GSTATS_DB=${result.out} bun run dev`);
    console.log(`  (PowerShell: $env:F1GSTATS_DB="${result.out}"; bun run dev)`);
    console.log("The grid is invented. Do not use this copy for anything real.");
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
