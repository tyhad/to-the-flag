/**
 * Overlay feed: GET /api/feed/team-status and GET /api/feed/team-path/:team (Phase 5 Step 5).
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../api/server";
import { remainingSessions } from "../engine/sessions";
import { teamCars } from "../engine/teams";
import { solveWcc } from "../engine/teamSolver";
import type { Scenario, SeasonState } from "../engine/types";
import { buildDb, buildFixtureDb, cleanupDbs } from "./dbHelpers";

const BASE = "http://127.0.0.1:3100";
const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;

let DB_PATH = "";
// Every test gets its own scenario database file (an open SQLite file cannot be deleted on Windows).
let TTF_DIR = "";
let TTF_DB = "";
let ttfCount = 0;
beforeAll(() => {
  DB_PATH = buildFixtureDb();
  TTF_DIR = mkdtempSync(join(tmpdir(), "ttf-team-feed-"));
});
afterAll(() => {
  cleanupDbs();
  try {
    rmSync(TTF_DIR, { recursive: true, force: true });
  } catch {
    // files may still be open on Windows; the OS temp folder is cleaned up later
  }
});
beforeEach(() => {
  TTF_DB = join(TTF_DIR, `scenarios-${++ttfCount}.sqlite`);
});

type App = ReturnType<typeof createApp>;
const get = (app: App, path: string) => app.handle(new Request(`${BASE}${path}`));
async function send(app: App, method: string, path: string, body?: unknown) {
  return app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
async function createAndActivate(app: App, name: string, locks: Scenario["locks"]) {
  const created = (await (await send(app, "POST", "/api/scenarios", { name, locks })).json()) as any;
  expect((await send(app, "PUT", "/api/active-scenario", { id: created.id })).status).toBe(200);
  return created.id as string;
}

/** Ferrari's two cars finish 1-2 in Round 17: worth 43 points to the team. */
const [car1, car2] = teamCars(fixture).get("ferrari") as [string, string];
const ferrariOneTwo: Scenario = { locks: { "17:race": { fixed: { [car1]: 1, [car2]: 2 } } } };

describe("GET /api/feed/team-status", () => {
  test("shape: headers, metadata, rows", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const res = await get(app, "/api/feed/team-status");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBeTruthy();

    const json = (await res.json()) as any;
    expect(typeof json.updated_at).toBe("string");
    expect(json.as_of_round).toBe(16);
    expect(json.data_status).toBe("ok");
    expect(json.season).toBe(2026);
    expect(json.scenario).toBeNull();
    expect(json.rows).toHaveLength(11);
    expect(Object.keys(json.rows[0])).toEqual([
      "rank", "team", "name", "points", "status", "max_possible", "gap_to_leader", "points_to_clinch",
    ]);
  });

  test("the rows are the team statuses in table order", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const json = (await (await get(app, "/api/feed/team-status")).json()) as any;
    expect(json.rows[0]).toEqual({
      rank: 1, team: "mercedes", name: "Mercedes", points: 556, status: "alive",
      max_possible: 872, gap_to_leader: 0, points_to_clinch: 166,
    });
    expect(json.rows[1]).toMatchObject({ rank: 2, team: "ferrari", points: 405, gap_to_leader: 151 });
    expect(json.rows.filter((r: any) => r.status === "alive")).toHaveLength(4);
    const out = json.rows.find((r: any) => r.team === "rb");
    expect(out).toMatchObject({ status: "eliminated", points_to_clinch: null });
  });

  test("the flattened top1..top10 fields agree with the rows", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const json = (await (await get(app, "/api/feed/team-status")).json()) as any;
    for (let i = 1; i <= 10; i++) {
      const row = json.rows[i - 1];
      for (const [key, value] of Object.entries(row)) expect(json[`top${i}_${key}`]).toBe(value);
    }
    expect("top11_team" in json).toBe(false);
  });

  test("a place with no team is empty rather than missing", async () => {
    const app = createApp({ dbPath: buildDb(), ttfDbPath: TTF_DB }); // two teams only
    const json = (await (await get(app, "/api/feed/team-status")).json()) as any;
    expect(json.rows).toHaveLength(2);
    expect(json.top3_team).toBe("");
    expect(json.top3_name).toBe("");
    expect(json.top3_status).toBe("");
    expect(json.top3_points).toBe(0);
    expect(json.top3_rank).toBe(3);
    expect(json.top3_max_possible).toBe(0);
    expect(json.top3_gap_to_leader).toBe(0);
    expect(json.top3_points_to_clinch).toBeNull();
    expect("top10_team" in json).toBe(true);
  });

  test("the output changes after activating a scenario, and back after switching it off", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const before = await get(app, "/api/feed/team-status");
    const beforeJson = (await before.json()) as any;
    expect(beforeJson.rows[1]).toMatchObject({ team: "ferrari", points: 405 });

    const id = await createAndActivate(app, "Ferrari one-two", ferrariOneTwo.locks);
    const after = await get(app, "/api/feed/team-status");
    const afterJson = (await after.json()) as any;
    expect(afterJson.scenario).toEqual({ id, name: "Ferrari one-two" });
    expect(afterJson.rows.find((r: any) => r.team === "ferrari")).toMatchObject({ points: 405 + 43 });
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));

    expect((await send(app, "PUT", "/api/active-scenario", { id: null })).status).toBe(200);
    const off = (await (await get(app, "/api/feed/team-status")).json()) as any;
    expect(off.scenario).toBeNull();
    expect(off.rows).toEqual(beforeJson.rows);
  });

  test("a scenario can change a status", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    // Mercedes take a one-two in every remaining session: 556 + 316 = 872, more than Ferrari's best (721)
    const [m1, m2] = teamCars(fixture).get("mercedes") as [string, string];
    const locks = Object.fromEntries(
      remainingSessions(fixture).map((k) => [k, { fixed: { [m1]: 1, [m2]: 2 } }]),
    ) as Scenario["locks"];
    await createAndActivate(app, "Mercedes sweep", locks);
    const json = (await (await get(app, "/api/feed/team-status")).json()) as any;
    expect(json.rows[0]).toMatchObject({ team: "mercedes", status: "clinched", points: 872, points_to_clinch: 0 });
    expect(json.rows[1]).toMatchObject({ team: "ferrari", status: "eliminated", points_to_clinch: null });
    expect(json.rows.filter((r: any) => r.status !== "eliminated")).toHaveLength(1);
  });

  test("the flattened fields follow the scenario too", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    await createAndActivate(app, "Ferrari one-two", ferrariOneTwo.locks);
    const json = (await (await get(app, "/api/feed/team-status")).json()) as any;
    expect(json.top2_team).toBe("ferrari");
    expect(json.top2_points).toBe(448);
    expect(json.top2_gap_to_leader).toBe(556 - 448);
  });

  test("an active scenario that no longer fits the season is ignored", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }); // creates the tables
    const raw = new Database(TTF_DB);
    raw
      .query(
        "INSERT INTO scenarios (id, name, season, as_of_round, locks_json, contenders_json, created_at, updated_at) VALUES ('bad', 'Old', 2026, 12, ?, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
      )
      .run(JSON.stringify({ "1:race": { fixed: { NOR: 1 } } })); // round 1 already has results
    raw.query("INSERT OR REPLACE INTO app_state (key, value) VALUES ('active_scenario_id', 'bad')").run();
    raw.close();

    const res = await get(app, "/api/feed/team-status");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.scenario).toBeNull();
    expect(json.rows[0]).toMatchObject({ team: "mercedes", points: 556 });
    const path = (await (await get(app, "/api/feed/team-path/ferrari")).json()) as any;
    expect(path.scenario).toBeNull();
    expect(path.pointsNeeded).toBe(152);
  });

  test("503 when the data file is missing", async () => {
    const app = createApp({ dbPath: join(import.meta.dir, "no-such-file.sqlite"), ttfDbPath: TTF_DB });
    const res = await get(app, "/api/feed/team-status");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("data_file_missing");
  });

  test("503 when the schema version is too old", async () => {
    const old = buildDb((seed) => {
      seed.schemaVersion = 1;
    });
    const res = await get(createApp({ dbPath: old, ttfDbPath: TTF_DB }), "/api/feed/team-status");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("schema_version_invalid");
  });
});

describe("GET /api/feed/team-path/:team", () => {
  test("returns the TeamPathResult with the usual metadata", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const res = await get(app, "/api/feed/team-path/ferrari");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBeTruthy();

    const json = (await res.json()) as any;
    expect(typeof json.updated_at).toBe("string");
    expect(json.as_of_round).toBe(16);
    expect(json.data_status).toBe("ok");
    expect(json.season).toBe(2026);
    expect(json.scenario).toBeNull();

    const { updated_at, as_of_round, data_status, season, scenario, ...result } = json;
    expect(result).toEqual(JSON.parse(JSON.stringify(solveWcc(fixture, "ferrari"))));
    expect(json.team).toBe("ferrari");
    expect(json.verdict).toBe("alive");
    expect(json.pointsNeeded).toBe(152);
    expect(json.minOneTwos).toEqual({ total: 0, races: 0, sprints: 0 });
    expect(json.exact).toBe(true);
    expect(json.rivalBudgets.map((b: any) => b.team)).toEqual(["mercedes", "mclaren", "red_bull"]);
    expect(Object.keys(json.easiest.locks).length).toBe(8);
  });

  test("the team id is case-insensitive", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const res = await get(app, "/api/feed/team-path/Red_Bull");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.team).toBe("red_bull");
    expect(json.minOneTwos).toEqual({ total: 2, races: 2, sprints: 0 });
  });

  test("404 for an unknown team id", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const res = await get(app, "/api/feed/team-path/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe("not_found");
  });

  test("an eliminated team is a normal answer with null path fields", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const res = await get(app, "/api/feed/team-path/rb");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json).toMatchObject({ verdict: "eliminated", pointsNeeded: null, minOneTwos: null, easiest: null });
    expect(json.rivalBudgets).toEqual([]);
  });

  test("the output changes after activating a scenario", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const before = await get(app, "/api/feed/team-path/ferrari");
    const id = await createAndActivate(app, "Ferrari one-two", ferrariOneTwo.locks);
    const after = await get(app, "/api/feed/team-path/ferrari");
    const json = (await after.json()) as any;
    expect(json.scenario).toEqual({ id, name: "Ferrari one-two" });
    expect(json.points).toBe(405 + 43);
    expect(json.pointsNeeded).toBe(556 - 448 + 1);
    expect(json.easiest.locks["17:race"]).toEqual(ferrariOneTwo.locks["17:race"]);
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
    const { updated_at, as_of_round, data_status, season, scenario, ...result } = json;
    expect(result).toEqual(JSON.parse(JSON.stringify(solveWcc(fixture, "ferrari", ferrariOneTwo))));
  });

  test("503 when the data file is missing", async () => {
    const app = createApp({ dbPath: join(import.meta.dir, "no-such-file.sqlite"), ttfDbPath: TTF_DB });
    const res = await get(app, "/api/feed/team-path/ferrari");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("data_file_missing");
  });

  test("503 when the schema version is too old", async () => {
    const old = buildDb((seed) => {
      seed.schemaVersion = 1;
    });
    const res = await get(createApp({ dbPath: old, ttfDbPath: TTF_DB }), "/api/feed/team-path/ferrari");
    expect(res.status).toBe(503);
  });
});

describe("the existing routes", () => {
  test("do not change", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    const status = (await (await get(app, "/api/feed/status")).json()) as any;
    expect(status.rows[0]).toEqual({
      driver: "ANT", name: "Andrea Kimi Antonelli", status: "alive", points: 320, maxPossible: 503, gapToLeader: 0, pointsToClinch: 100,
    });
    expect("scenario" in status).toBe(false);
    const path = (await (await get(app, "/api/feed/path/NOR")).json()) as any;
    expect("scenario" in path).toBe(false);
    expect(path.driver).toBe("NOR");
  });
});
