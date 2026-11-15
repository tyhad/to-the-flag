/**
 * Exporting the starting grid (Phase 8, Step 7): the rows, the CSV and JSON text, the range of places for the
 * picture, the file names, and the data the picture is drawn from. Pure: no DOM, no clipboard, no files.
 *
 * The rows are the same as the overlay feed's (`GET /api/feed/grid`, `api/gridFeed.ts`), and a test keeps the two in
 * step. Nothing here carries a token, a path or a note.
 */
import { teamCars, type SeasonState } from "../../engine";
import type { GridSource } from "./grid";

/** The grid in use, as `GET /api/grid` gives it. */
export interface ExportGrid {
  order: readonly string[];
  pit: readonly string[];
  source: GridSource;
}

export interface GridExportRow {
  /** Starting place, 1-based; pit-lane starters come after everyone else. */
  position: number;
  driver: string;
  name: string;
  /** The constructor id, like the feed. */
  team: string;
  /** A pit-lane start (only a manual grid knows which drivers those are). */
  pit: boolean;
  source: GridSource;
}

/** The grid as rows, pole first: everyone on the grid, then the pit-lane starters in the order given. */
export function buildGridExportRows(state: SeasonState, grid: ExportGrid): GridExportRow[] {
  const names = new Map(state.drivers.map((d) => [d.code, d.name]));
  const teams = new Map<string, string>();
  for (const [team, codes] of teamCars(state)) for (const code of codes) teams.set(code, team);
  const row = (code: string, position: number, pit: boolean): GridExportRow => ({
    position,
    driver: code,
    name: names.get(code) ?? code,
    team: teams.get(code) ?? "",
    pit,
    source: grid.source,
  });
  return [
    ...grid.order.map((code, i) => row(code, i + 1, false)),
    ...grid.pit.map((code, i) => row(code, grid.order.length + i + 1, true)),
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// CSV and JSON
// ---------------------------------------------------------------------------------------------------------------------

export const CSV_COLUMNS = ["position", "driver", "name", "team", "pit", "source"] as const;

/** One CSV field: quoted when it holds a comma, a quote, a line break, or blanks at either end; quotes are doubled. */
export function csvField(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The header line and one line per row, in grid order, joined by line feeds. */
export function gridToCsv(rows: readonly GridExportRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) lines.push(CSV_COLUMNS.map((column) => csvField(row[column])).join(","));
  return lines.join("\n");
}

/** The same rows as a JSON array, indented, so it reads well when pasted. `JSON.parse` gives the rows back. */
export function gridToJson(rows: readonly GridExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// The range of places for the picture
// ---------------------------------------------------------------------------------------------------------------------

export type GridRangeChoice = "all" | "10" | "12" | "custom";

export interface GridRange {
  from: number;
  to: number;
}

/** "P6–P15" */
export function formatGridRange(range: GridRange): string {
  return `P${range.from}–P${range.to}`;
}

export interface ResolvedGridRange {
  /** The places to draw, or null for the whole grid. */
  range: GridRange | null;
  /** Why nothing can be drawn (the range starts after the last place), in plain words. */
  problem: string | null;
}

/**
 * The places the picture shows. "All" and any choice that already covers the whole grid give null. A custom range is
 * made sensible: it starts at 1 or later, ends at or after where it starts and at most at the last place. Only a range
 * that starts after the last place has nothing to show.
 */
export function resolveGridRange(choice: GridRangeChoice, custom: GridRange, total: number): ResolvedGridRange {
  if (total < 1) return { range: null, problem: "There are no places to export." };
  let from = 1;
  let to = total;
  if (choice === "10") to = 10;
  else if (choice === "12") to = 12;
  else if (choice === "custom") {
    from = Number.isFinite(custom.from) ? Math.max(1, Math.floor(custom.from)) : 1;
    to = Number.isFinite(custom.to) ? Math.max(from, Math.floor(custom.to)) : from;
  }
  if (from > total) return { range: null, problem: `The grid has only ${total} places.` };
  to = Math.min(to, total);
  return { range: from === 1 && to === total ? null : { from, to }, problem: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `starting-grid-square-2026-r17.png`, `starting-grid-2026-r17-p6-p15.png` for a part of the grid,
 * `starting-grid-2026-r17.csv`. Only the season, the round and the choices: nothing else goes into a name.
 */
export function gridExportFilename(
  kind: "png" | "csv" | "json",
  parts: { season: number; round: number; size?: "square" | "wide"; range?: GridRange | null },
): string {
  const size = kind === "png" && parts.size ? `${parts.size}-` : "";
  const range = kind === "png" && parts.range ? `-p${parts.range.from}-p${parts.range.to}` : "";
  return `starting-grid-${size}${parts.season}-r${parts.round}${range}.${kind}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// What the picture is drawn from
// ---------------------------------------------------------------------------------------------------------------------

export interface GridCardRow {
  position: number;
  code: string;
  /** For the team color; "" when the driver has no team yet. */
  teamId: string;
  pit: boolean;
}

export interface GridCardView {
  season: number;
  round: number;
  /** The name of the race, when the schedule has it. */
  raceName: string | null;
  source: GridSource;
  /** Every place of the grid, pole first. The picture shows `range` of them (all when it is null). */
  rows: GridCardRow[];
  range: GridRange | null;
}

/** The picture's data, or null when there is no grid (before qualifying) or no race left. */
export function buildGridCardView(
  state: SeasonState,
  info: { round: number | null; effective: ExportGrid | null },
  range: GridRange | null,
): GridCardView | null {
  if (info.round === null || info.effective === null) return null;
  const round = info.round;
  return {
    season: state.season,
    round,
    raceName: state.rounds.find((r) => r.round === round)?.name || null,
    source: info.effective.source,
    rows: buildGridExportRows(state, info.effective).map((r) => ({ position: r.position, code: r.driver, teamId: r.team, pit: r.pit })),
    range,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The controls
// ---------------------------------------------------------------------------------------------------------------------

/** Said under the buttons while the grid on screen has changes that are not saved yet: the export is of the saved grid. */
export const UNSAVED_EXPORT_NOTE = "The export is of the saved grid. Save your changes first to include them.";

/** The note to show, or null. */
export function exportNote(unsavedChanges: boolean): string | null {
  return unsavedChanges ? UNSAVED_EXPORT_NOTE : null;
}

/** Said when only a part of the grid is chosen for the picture: the data exports are never cut. */
export const FULL_DATA_NOTE = "The CSV and JSON always have every place.";

/** What the buttons say after copying, in plain words. */
export function copyMessage(kind: "CSV" | "JSON", copied: boolean): string {
  return copied ? `Copied the ${kind}.` : `Could not copy the ${kind}. Your browser did not allow it; use Download instead.`;
}
