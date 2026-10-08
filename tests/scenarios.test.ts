/**
 * Tests for Scenario storage database & scenario API routes (Phase 2 Step 2).
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../api/server";
import { ScenarioDatabase } from "../api/db";
import { makeState } from "./helpers";
import type { Scenario } from "../engine/types";

const REAL_DB_PATH = join(import.meta.dir, "..", "..", "F1GStats", "f1gstats.sqlite");
const TEMP_TTF_DB = join(import.meta.dir, "temp-ttf.sqlite");

function cleanupTempDb() {
  if (existsSync(TEMP_TTF_DB)) {
    try {
      unlinkSync(TEMP_TTF_DB);
    } catch {
      // ignore
    }
  }
}

describe("Scenario Storage & API Routes (Step 2)", () => {
  beforeEach(() => {
    cleanupTempDb();
  });
  afterEach(() => {
    cleanupTempDb();
  });

  describe("ScenarioDatabase Direct Operations", () => {
    test("CRUD round trip on a temp database file", () => {
      cleanupTempDb();
      const state = makeState({
        rounds: 4,
        completed: 2,
        teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
        results: {
          "1:race": ["AAA", "BBB"],
          "2:race": ["BBB", "AAA"],
        },
      });

      const db = new ScenarioDatabase(TEMP_TTF_DB);

      // Initially empty
      expect(db.getScenarios(state)).toEqual([]);
      expect(db.getActiveScenarioId()).toBeNull();

      // Create scenario
      const scenarioLocks: Scenario["locks"] = {
        "3:race": { fixed: { AAA: 1, BBB: 2 } },
      };
      const created = db.createScenario(
        {
          name: "Test Scenario 1",
          locks: scenarioLocks,
          contenders: ["AAA", "BBB"],
        },
        state,
      );

      expect(created.id).toBeTruthy();
      expect(created.name).toBe("Test Scenario 1");
      expect(created.valid).toBe(true);
      expect(created.stale).toBe(false);
      expect(created.locks).toEqual(scenarioLocks);
      expect(created.contenders).toEqual(["AAA", "BBB"]);

      // Get scenarios list
      const list = db.getScenarios(state);
      expect(list.length).toBe(1);
      expect(list[0]!.id).toBe(created.id);

      // Get by ID
      const fetched = db.getScenarioById(created.id, state);
      expect(fetched).toEqual(created);

      // Update scenario
      const updatedLocks: Scenario["locks"] = {
        "3:race": { fixed: { AAA: 2, BBB: 1 } },
      };
      const updated = db.updateScenario(
        created.id,
        { name: "Updated Scenario 1", locks: updatedLocks },
        state,
      );
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Updated Scenario 1");
      expect(updated!.locks).toEqual(updatedLocks);

      // Set active scenario
      expect(db.setActiveScenarioId(created.id)).toBe(true);
      expect(db.getActiveScenarioId()).toBe(created.id);

      // Delete scenario clears active scenario
      expect(db.deleteScenario(created.id)).toBe(true);
      expect(db.getScenarios(state)).toEqual([]);
      expect(db.getActiveScenarioId()).toBeNull();

      db.close();
    });

    test("stale and invalid flags after state advances a round", () => {
      cleanupTempDb();
      // Round 2 completed, Round 3 and 4 remaining
      const stateRound2 = makeState({
        rounds: 4,
        completed: 2,
        teams: { red: ["AAA", "BBB"] },
        results: {
          "1:race": ["AAA", "BBB"],
          "2:race": ["BBB", "AAA"],
        },
      });

      const db = new ScenarioDatabase(TEMP_TTF_DB);

      // Save scenario at Round 2 locking Round 3:race
      const created = db.createScenario(
        {
          name: "Round 3 Lock",
          locks: { "3:race": { fixed: { AAA: 1 } } },
        },
        stateRound2,
      );

      expect(created.valid).toBe(true);
      expect(created.stale).toBe(false);

      // Now state advances to Round 3 (Round 3 race completed)
      const stateRound3 = makeState({
        rounds: 4,
        completed: 3,
        teams: { red: ["AAA", "BBB"] },
        results: {
          "1:race": ["AAA", "BBB"],
          "2:race": ["BBB", "AAA"],
          "3:race": ["AAA", "BBB"],
        },
      });

      // Reading scenario under Round 3 state:
      const fetchedRound3 = db.getScenarioById(created.id, stateRound3);
      expect(fetchedRound3).not.toBeNull();
      // Saved at as_of_round 2 < current asOfRound 3 => stale = true
      expect(fetchedRound3!.stale).toBe(true);
      // Locking 3:race which now has results => valid = false
      expect(fetchedRound3!.valid).toBe(false);

      // Scenario MUST NOT be deleted from DB even though invalid
      expect(db.getScenarios(stateRound3).length).toBe(1);

      db.close();
    });
  });

  describe("API Endpoints & 422 Error Validation", () => {
    test("POST /api/scenarios validates locks and rejects 422 cases", async () => {
      cleanupTempDb();
      const app = createApp({ dbPath: REAL_DB_PATH, ttfDbPath: TEMP_TTF_DB });

      // Missing name
      const res1 = await app.handle(
        new Request("http://127.0.0.1:3100/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locks: {} }),
        }),
      );
      expect(res1.status).toBe(422);

      // Unknown driver
      const res2 = await app.handle(
        new Request("http://127.0.0.1:3100/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Invalid Driver", locks: { "17:race": { fixed: { UNKNOWN: 1 } } } }),
        }),
      );
      expect(res2.status).toBe(422);
      const err2 = (await res2.json()) as any;
      expect(err2.errors).toBeArray();
      expect(err2.errors[0]).toContain("unknown driver UNKNOWN");

      // Position out of zone (e.g. 15 for a race, zone is 1-10)
      const res3 = await app.handle(
        new Request("http://127.0.0.1:3100/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Out of zone", locks: { "17:race": { fixed: { NOR: 15 } } } }),
        }),
      );
      expect(res3.status).toBe(422);

      // Duplicate position (e.g. NOR and VER both locked to position 1)
      const res4 = await app.handle(
        new Request("http://127.0.0.1:3100/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Duplicate P1", locks: { "17:race": { fixed: { NOR: 1, VER: 1 } } } }),
        }),
      );
      expect(res4.status).toBe(422);
      const err4 = (await res4.json()) as any;
      expect(err4.errors[0]).toContain("both locked to position 1");
    });

    test("Full Scenario API Roundtrip", async () => {
      cleanupTempDb();
      const app = createApp({ dbPath: REAL_DB_PATH, ttfDbPath: TEMP_TTF_DB });

      // GET /api/scenarios empty
      const resList1 = await app.handle(new Request("http://127.0.0.1:3100/api/scenarios"));
      expect(resList1.status).toBe(200);
      expect(await resList1.json()).toEqual([]);

      // POST /api/scenarios create valid scenario
      const createPayload = {
        name: "Norris Win Singapore",
        locks: { "17:race": { fixed: { NOR: 1, VER: 2 } } },
        contenders: ["NOR", "VER"],
      };
      const resPost = await app.handle(
        new Request("http://127.0.0.1:3100/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createPayload),
        }),
      );
      expect(resPost.status).toBe(201);
      const created = (await resPost.json()) as any;
      expect(created.id).toBeTruthy();
      expect(created.name).toBe("Norris Win Singapore");

      // GET /api/scenarios/:id
      const resGetId = await app.handle(new Request(`http://127.0.0.1:3100/api/scenarios/${created.id}`));
      expect(resGetId.status).toBe(200);
      expect((await resGetId.json()).name).toBe("Norris Win Singapore");

      // PUT /api/active-scenario
      const resPutActive = await app.handle(
        new Request("http://127.0.0.1:3100/api/active-scenario", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: created.id }),
        }),
      );
      expect(resPutActive.status).toBe(200);
      expect(await resPutActive.json()).toEqual({ id: created.id });

      // GET /api/active-scenario
      const resGetActive = await app.handle(new Request("http://127.0.0.1:3100/api/active-scenario"));
      expect(resGetActive.status).toBe(200);
      expect(await resGetActive.json()).toEqual({ id: created.id });

      // PUT /api/scenarios/:id update name
      const resPut = await app.handle(
        new Request(`http://127.0.0.1:3100/api/scenarios/${created.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Renamed Scenario" }),
        }),
      );
      expect(resPut.status).toBe(200);
      expect((await resPut.json()).name).toBe("Renamed Scenario");

      // DELETE /api/scenarios/:id
      const resDel = await app.handle(
        new Request(`http://127.0.0.1:3100/api/scenarios/${created.id}`, {
          method: "DELETE",
        }),
      );
      expect(resDel.status).toBe(200);
      expect(await resDel.json()).toEqual({ ok: true });

      // Active scenario cleared
      const resActiveAfterDel = await app.handle(new Request("http://127.0.0.1:3100/api/active-scenario"));
      expect(await resActiveAfterDel.json()).toEqual({ id: null });
    });
  });
});
