/**
 * SeasonState loader and in-memory cache for API endpoints.
 * Reloads state automatically when database file's mtime or size changes.
 * Never leaks local file paths in error responses.
 */
import { existsSync, statSync } from "node:fs";
import { Database } from "bun:sqlite";
import { loadSeason, MIN_SCHEMA_VERSION, SchemaVersionError } from "../data/loadSeason";
import { nextScheduledRound, resolveGrid, type ResolvedGrid } from "../engine/grid";
import type { SeasonState } from "../engine/types";

/** Where the loader reads manual starting grids from (the `ScenarioDatabase`). */
export interface GridOverrideStore {
  getGridOverride(
    season: number,
    round: number,
  ): { order: readonly string[]; pit: readonly string[]; updatedAt: string } | null;
}

/** The body of GET /api/grid: which grid is in use for the next race, and where it comes from. */
export interface GridPayload {
  round: ResolvedGrid["round"];
  effective: ResolvedGrid["effective"];
  data: ResolvedGrid["data"];
  override: { updatedAt: string; valid: boolean } | null;
  differs: boolean;
}

export interface LoadedSeasonData {
  /** The season as the app uses it: the data file, with the manual starting grid merged in when one applies. */
  state: SeasonState;
  schemaVersion: number;
  /** The data file's ETag; it also changes whenever the manual grid in use changes. */
  etag: string;
  jsonString: string;
  mtimeMs: number;
  size: number;
  /** Which starting grid is in use for the next race (the same answer as GET /api/grid). */
  grid: GridPayload;
}

export type SeasonLoaderResult =
  | { ok: true; data: LoadedSeasonData }
  | {
      ok: false;
      error: "data_file_missing" | "schema_version_invalid" | "data_error";
      message: string;
      statusCode: 503;
    };

function readSchemaVersionQuick(dbPath: string): number | null {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const hasMeta =
        db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() !== null;
      if (!hasMeta) return 1;
      const row = db.query<{ value: string | null }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get();
      const ver = Number(row?.value);
      return row?.value != null && Number.isFinite(ver) ? ver : 1;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export class SeasonLoader {
  /** The data file as read, without any manual grid. Reloaded when the file's mtime or size changes. */
  private cached: LoadedSeasonData | null = null;
  /** `cached` with the manual grid applied, rebuilt when the file or the manual grid changes. */
  private composed: { key: string; data: LoadedSeasonData } | null = null;
  private gridStore: GridOverrideStore | null = null;

  constructor(private readonly dbPath: string, gridStore?: GridOverrideStore) {
    this.gridStore = gridStore ?? null;
  }

  /** Reads manual starting grids from this store from now on (the server connects its scenario database). */
  public setGridOverrides(store: GridOverrideStore | null): void {
    this.gridStore = store;
    this.composed = null;
  }

  /** Applies the manual starting grid of the next race, if there is one, to the data file's season. */
  private compose(base: LoadedSeasonData): LoadedSeasonData {
    const round = nextScheduledRound(base.state);
    const row = this.gridStore && round !== null ? this.gridStore.getGridOverride(base.state.season, round) : null;
    const stamp = row ? Bun.hash(`${row.updatedAt}|${JSON.stringify(row.order)}|${JSON.stringify(row.pit)}`).toString(36) : "-";
    const key = `${base.etag}|${stamp}`;
    if (this.composed?.key === key && this.composed.data.mtimeMs === base.mtimeMs) return this.composed.data;

    const resolved = resolveGrid(base.state, row ? { order: row.order, pit: row.pit } : null);
    const applied = resolved.overrideValid === true;
    const data: LoadedSeasonData = {
      ...base,
      state: resolved.state,
      // Same data file and same manual grid: same ETag. A different manual grid in use: a different one.
      etag: applied ? base.etag.replace(/"$/, `-g${stamp}"`) : base.etag,
      jsonString: applied ? JSON.stringify(resolved.state) : base.jsonString,
      grid: {
        round: resolved.round,
        effective: resolved.effective,
        data: resolved.data,
        override: row && resolved.overrideValid !== null ? { updatedAt: row.updatedAt, valid: resolved.overrideValid } : null,
        differs: resolved.differs,
      },
    };
    this.composed = { key, data };
    return data;
  }

  public getSeason(): SeasonLoaderResult {
    if (!existsSync(this.dbPath)) {
      this.cached = null;
      this.composed = null;
      return {
        ok: false,
        error: "data_file_missing",
        message: "F1GStats database file was not found. Please ensure the database file exists.",
        statusCode: 503,
      };
    }

    try {
      const stat = statSync(this.dbPath);
      if (
        this.cached &&
        this.cached.mtimeMs === stat.mtimeMs &&
        this.cached.size === stat.size
      ) {
        return { ok: true, data: this.compose(this.cached) };
      }

      const version = readSchemaVersionQuick(this.dbPath);
      if (version !== null && version < MIN_SCHEMA_VERSION) {
        this.cached = null;
        return {
          ok: false,
          error: "schema_version_invalid",
          message: `f1gstats.sqlite has meta.schema_version ${version}, but ${MIN_SCHEMA_VERSION} or newer is required. Re-run F1GStats.`,
          statusCode: 503,
        };
      }

      const state = loadSeason(this.dbPath);
      const schemaVersion = state.schemaVersion ?? version ?? MIN_SCHEMA_VERSION;
      const jsonString = JSON.stringify(state);
      const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;

      this.cached = {
        state,
        schemaVersion,
        etag,
        jsonString,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        // Filled in by compose(); the data file alone has no manual grid.
        grid: { round: null, effective: null, data: null, override: null, differs: false },
      };
      this.composed = null;

      return { ok: true, data: this.compose(this.cached) };
    } catch (err) {
      this.cached = null;
      if (err instanceof SchemaVersionError) {
        return {
          ok: false,
          error: "schema_version_invalid",
          message: `f1gstats.sqlite has meta.schema_version ${err.found}, but ${err.required} or newer is required. Re-run F1GStats.`,
          statusCode: 503,
        };
      }
      return {
        ok: false,
        error: "data_error",
        message: "Failed to load season data. Please check F1GStats database.",
        statusCode: 503,
      };
    }
  }

  public clearCache(): void {
    this.cached = null;
    this.composed = null;
  }
}
