/**
 * Scenario storage database for to-the-flag.sqlite.
 * Manages saved scenarios and app state (such as active_scenario_id).
 */
import { Database } from "bun:sqlite";
import { validateScenario } from "../engine/scenario";
import type { Scenario, SessionLock, SessionKey, SeasonState } from "../engine/types";

export interface ScenarioRow {
  id: string;
  name: string;
  season: number;
  as_of_round: number;
  locks_json: string;
  contenders_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredScenario {
  id: string;
  name: string;
  season: number;
  asOfRound: number;
  locks: Record<SessionKey, SessionLock>;
  contenders?: string[];
  valid: boolean;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScenarioInput {
  id?: string;
  name: string;
  season?: number;
  asOfRound?: number;
  locks: Record<SessionKey, SessionLock>;
  contenders?: string[];
}

export interface UpdateScenarioInput {
  name?: string;
  locks?: Record<SessionKey, SessionLock>;
  contenders?: string[];
}

/** A manual starting grid for one race (Phase 8). One row per season and round. */
export interface GridOverrideRow {
  season: number;
  round: number;
  order: string[];
  pit: string[];
  updatedAt: string;
}

interface GridOverrideDbRow {
  season: number;
  round: number;
  order_json: string;
  pit_json: string;
  updated_at: string;
}

export class ScenarioDatabase {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get();
    const version = row?.user_version ?? 0;
    if (version < 1) {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS scenarios (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          season INTEGER NOT NULL,
          as_of_round INTEGER NOT NULL,
          locks_json TEXT NOT NULL,
          contenders_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      this.db.run(`
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);
      this.db.run("PRAGMA user_version = 1;");
    }
    if (version < 2) {
      // Phase 8: the starting grid typed by the owner, one row per race. Older databases only gain this table.
      this.db.run(`
        CREATE TABLE IF NOT EXISTS grid_overrides (
          season INTEGER NOT NULL,
          round INTEGER NOT NULL,
          order_json TEXT NOT NULL,
          pit_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (season, round)
        );
      `);
      this.db.run("PRAGMA user_version = 2;");
    }
  }

  private rowToStored(row: ScenarioRow, state: SeasonState): StoredScenario {
    let valid = true;
    let locks: Record<SessionKey, SessionLock> = {};
    try {
      locks = JSON.parse(row.locks_json);
      validateScenario(state, { locks });
    } catch {
      valid = false;
    }
    const contenders = row.contenders_json ? JSON.parse(row.contenders_json) : undefined;
    return {
      id: row.id,
      name: row.name,
      season: row.season,
      asOfRound: row.as_of_round,
      locks,
      contenders,
      valid,
      stale: row.as_of_round < state.asOfRound,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public getScenarios(state: SeasonState): StoredScenario[] {
    const rows = this.db.query<ScenarioRow, []>("SELECT * FROM scenarios ORDER BY created_at ASC").all();
    return rows.map((r) => this.rowToStored(r, state));
  }

  public getScenarioById(id: string, state: SeasonState): StoredScenario | null {
    const row = this.db.query<ScenarioRow, [string]>("SELECT * FROM scenarios WHERE id = ?").get(id);
    if (!row) return null;
    return this.rowToStored(row, state);
  }

  public createScenario(input: CreateScenarioInput, state: SeasonState): StoredScenario {
    validateScenario(state, { locks: input.locks });

    const id = input.id && input.id.trim() !== "" ? input.id.trim() : crypto.randomUUID();
    const season = input.season ?? state.season;
    const asOfRound = input.asOfRound ?? state.asOfRound;
    const now = new Date().toISOString();
    const locksJson = JSON.stringify(input.locks);
    const contendersJson = input.contenders ? JSON.stringify(input.contenders) : null;

    this.db
      .query(
        `INSERT INTO scenarios (id, name, season, as_of_round, locks_json, contenders_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, season, asOfRound, locksJson, contendersJson, now, now);

    return {
      id,
      name: input.name,
      season,
      asOfRound,
      locks: input.locks,
      contenders: input.contenders,
      valid: true,
      stale: asOfRound < state.asOfRound,
      createdAt: now,
      updatedAt: now,
    };
  }

  public updateScenario(id: string, input: UpdateScenarioInput, state: SeasonState): StoredScenario | null {
    const existing = this.db.query<ScenarioRow, [string]>("SELECT * FROM scenarios WHERE id = ?").get(id);
    if (!existing) return null;

    const locks = input.locks ?? JSON.parse(existing.locks_json);
    validateScenario(state, { locks });

    const name = input.name !== undefined ? input.name : existing.name;
    const locksJson = JSON.stringify(locks);
    const contendersJson =
      input.contenders !== undefined
        ? input.contenders
          ? JSON.stringify(input.contenders)
          : null
        : existing.contenders_json;
    // Decision D18: saving locks or contenders makes the scenario current; a rename alone keeps its round.
    const contentChanged = input.locks !== undefined || input.contenders !== undefined;
    const asOfRound = contentChanged ? state.asOfRound : existing.as_of_round;
    const now = new Date().toISOString();

    this.db
      .query(
        "UPDATE scenarios SET name = ?, locks_json = ?, contenders_json = ?, as_of_round = ?, updated_at = ? WHERE id = ?",
      )
      .run(name, locksJson, contendersJson, asOfRound, now, id);

    const updated = this.db.query<ScenarioRow, [string]>("SELECT * FROM scenarios WHERE id = ?").get(id)!;
    return this.rowToStored(updated, state);
  }

  public deleteScenario(id: string): boolean {
    const existing = this.db.query<ScenarioRow, [string]>("SELECT id FROM scenarios WHERE id = ?").get(id);
    if (!existing) return false;

    this.db.query("DELETE FROM scenarios WHERE id = ?").run(id);

    const activeRow = this.db.query<{ value: string | null }, []>("SELECT value FROM app_state WHERE key = 'active_scenario_id'").get();
    if (activeRow?.value === id) {
      this.db.query("DELETE FROM app_state WHERE key = 'active_scenario_id'").run();
    }
    return true;
  }

  public getActiveScenarioId(state?: SeasonState): string | null {
    const activeRow = this.db.query<{ value: string | null }, []>("SELECT value FROM app_state WHERE key = 'active_scenario_id'").get();
    if (!activeRow?.value) return null;

    const exists = this.db.query<{ id: string }, [string]>("SELECT id FROM scenarios WHERE id = ?").get(activeRow.value);
    if (!exists) return null;

    return activeRow.value;
  }

  public setActiveScenarioId(id: string | null): boolean {
    if (id === null) {
      this.db.query("DELETE FROM app_state WHERE key = 'active_scenario_id'").run();
      return true;
    }

    const exists = this.db.query<{ id: string }, [string]>("SELECT id FROM scenarios WHERE id = ?").get(id);
    if (!exists) return false;

    this.db
      .query(
        "INSERT INTO app_state (key, value) VALUES ('active_scenario_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(id);
    return true;
  }

  /** The manual grid saved for this race, or null. A row that cannot be read counts as none. */
  public getGridOverride(season: number, round: number): GridOverrideRow | null {
    const row = this.db
      .query<GridOverrideDbRow, [number, number]>("SELECT * FROM grid_overrides WHERE season = ? AND round = ?")
      .get(season, round);
    if (!row) return null;
    try {
      const order = JSON.parse(row.order_json);
      const pit = JSON.parse(row.pit_json);
      const isCodes = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
      if (!isCodes(order) || !isCodes(pit)) return null;
      return { season: row.season, round: row.round, order, pit, updatedAt: row.updated_at };
    } catch {
      return null;
    }
  }

  /** Saves (or replaces) the manual grid of a race. The caller has already checked it with `validateGrid`. */
  public setGridOverride(season: number, round: number, order: readonly string[], pit: readonly string[]): GridOverrideRow {
    const updatedAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO grid_overrides (season, round, order_json, pit_json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(season, round) DO UPDATE SET order_json = excluded.order_json, pit_json = excluded.pit_json, updated_at = excluded.updated_at`,
      )
      .run(season, round, JSON.stringify(order), JSON.stringify(pit), updatedAt);
    return { season, round, order: [...order], pit: [...pit], updatedAt };
  }

  /** Removes the manual grid of a race. Returns false when there was none. */
  public clearGridOverride(season: number, round: number): boolean {
    const exists = this.db.query("SELECT 1 FROM grid_overrides WHERE season = ? AND round = ?").get(season, round);
    if (!exists) return false;
    this.db.query("DELETE FROM grid_overrides WHERE season = ? AND round = ?").run(season, round);
    return true;
  }

  public close(): void {
    this.db.close();
  }
}
