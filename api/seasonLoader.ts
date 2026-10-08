/**
 * SeasonState loader and in-memory cache for API endpoints.
 * Reloads state automatically when database file's mtime or size changes.
 * Never leaks local file paths in error responses.
 */
import { existsSync, statSync } from "node:fs";
import { Database } from "bun:sqlite";
import { loadSeason, MIN_SCHEMA_VERSION, SchemaVersionError } from "../data/loadSeason";
import type { SeasonState } from "../engine/types";

export interface LoadedSeasonData {
  state: SeasonState;
  schemaVersion: number;
  etag: string;
  jsonString: string;
  mtimeMs: number;
  size: number;
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
  private cached: LoadedSeasonData | null = null;

  constructor(private readonly dbPath: string) {}

  public getSeason(): SeasonLoaderResult {
    if (!existsSync(this.dbPath)) {
      this.cached = null;
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
        return { ok: true, data: this.cached };
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
      };

      return { ok: true, data: this.cached };
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
  }
}
