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
    const now = new Date().toISOString();

    this.db
      .query("UPDATE scenarios SET name = ?, locks_json = ?, contenders_json = ?, updated_at = ? WHERE id = ?")
      .run(name, locksJson, contendersJson, now, id);

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

  public close(): void {
    this.db.close();
  }
}
