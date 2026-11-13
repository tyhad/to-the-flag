/**
 * Phase 7, Step 6: `best_position` in GET /api/feed/status and GET /api/feed/team-status, and the flattened
 * `top{n}_best` fields. The numbers must be the engine's; the Round 16 ones are listed in docs/PHASE_7.md.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../api/server";
import { bestPositions, driverPositionEntries, teamPositionEntries } from "../engine/positions";
import { driverStatus } from "../engine/status";
import { teamCars } from "../engine/teams";
import { teamStatus } from "../engine/teamStatus";
import type { Scenario, SeasonState } from "../engine/types";
import { buildDb, buildFixtureDb, cleanupDbs } from "./dbHelpers";

const BASE = "http://127.0.0.1:3100";
const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;

let DB_PATH = "";
let TTF_DIR = "";
let TTF_DB = "";
let count = 0;
beforeAll(() => {
  DB_PATH = buildFixtureDb();
  TTF_DIR = mkdtempSync(join(tmpdir(), "ttf-best-feed-"));
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
  TTF_DB = join(TTF_DIR, `scenarios-${++count}.sqlite`);
});

type App = ReturnType<typeof createApp>;
const get = (app: App, path: string) => app.handle(new Request(`${BASE}${path}`));
const send = (app: App, method: string, path: string, body?: unknown) =>
  app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
async function createAndActivate(app: App, name: string, locks: Scenario["locks"]) {
  const created = (await (await send(app, "POST", "/api/scenarios", { name, locks })).json()) as any;
  expect((await send(app, "PUT", "/api/active-scenario", { id: created.id })).status).toBe(200);
}

describe("GET /api/feed/status: best_position", () => {
  const load = async (app: App) => (await (await get(app, "/api/feed/status")).json()) as any;

  test("every row has best_position, a whole number, added after the existing fields", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    expect(Object.keys(json.rows[0])).toEqual([
      "driver", "name", "status", "points", "maxPossible", "gapToLeader", "pointsToClinch", "best_position",
    ]);
    for (const row of json.rows) expect(Number.isInteger(row.best_position)).toBe(true);
  });

  test("the numbers listed in docs/PHASE_7.md (Round 16)", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    const best = Object.fromEntries(json.rows.map((r: any) => [r.driver, r.best_position]));
    const want: Record<string, string[]> = {
      "1": ["ANT", "RUS", "HAM", "LEC", "NOR", "VER"],
      "2": ["PIA", "HAD", "LAW"],
      "3": ["GAS", "LIN"],
      "4": ["COL", "BEA", "BOR"],
      "5": ["HUL", "OCO", "ALO", "SAI", "ALB"],
      "7": ["STR", "BOT", "PER"],
      "20": ["TSU"],
    };
    const expected: Record<string, number> = {};
    for (const [place, codes] of Object.entries(want)) for (const c of codes) expected[c] = Number(place);
    expect(best).toEqual(expected);
  });

  test("the numbers equal the engine's", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    const engine = bestPositions(driverPositionEntries(driverStatus(fixture)));
    for (const row of json.rows) expect(row.best_position).toBe(engine.get(row.driver)!);
  });

  test("best_position is 1 exactly when the status is not eliminated (racing drivers)", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    for (const row of json.rows) if (row.driver !== "TSU") expect(row.best_position === 1).toBe(row.status !== "eliminated");
  });

  test("the flattened top{n}_best fields agree with the rows, for places 1 to 10", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    for (let i = 1; i <= 10; i++) {
      expect(json[`top${i}_best`]).toBe(json.rows[i - 1].best_position);
      expect(json[`top${i}_best_position`]).toBe(json.rows[i - 1].best_position);
    }
    expect("top11_best" in json).toBe(false);
  });

  test("the existing keys keep their names and values (existing overlay bindings keep working)", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    expect(json.top1_driver).toBe(json.rows[0].driver);
    expect(json.top1_status).toBe(json.rows[0].status);
    expect(json.top1_maxPossible).toBe(json.rows[0].maxPossible);
    expect(json.rows[0]).toMatchObject({ driver: "ANT", status: "alive", points: 320, maxPossible: 503 });
  });

  test("a place with no driver is empty rather than missing: top{n}_best is 0", async () => {
    const json = await load(createApp({ dbPath: buildDb(), ttfDbPath: TTF_DB })); // four drivers only
    expect(json.rows).toHaveLength(4);
    expect(json.top5_best).toBe(0);
    expect(json.top10_best).toBe(0);
    expect(json.top5_best_position).toBe(0);
    expect(json.top4_best).toBe(json.rows[3].best_position);
  });
});

describe("GET /api/feed/team-status: best_position", () => {
  const load = async (app: App) => (await (await get(app, "/api/feed/team-status")).json()) as any;

  test("every row has best_position, added after the existing fields", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    expect(Object.keys(json.rows[0])).toEqual([
      "rank", "team", "name", "points", "status", "max_possible", "gap_to_leader", "points_to_clinch", "best_position",
    ]);
  });

  test("the numbers listed in docs/PHASE_7.md (Round 16)", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    const best = Object.fromEntries(json.rows.map((r: any) => [r.team, r.best_position]));
    expect(best).toEqual({
      mercedes: 1, ferrari: 1, mclaren: 1, red_bull: 1,
      rb: 2,
      alpine: 3, haas: 3, audi: 3, williams: 3, aston_martin: 3, cadillac: 3,
    });
  });

  test("the numbers equal the engine's", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    const engine = bestPositions(teamPositionEntries(teamStatus(fixture)));
    for (const row of json.rows) expect(row.best_position).toBe(engine.get(row.team)!);
  });

  test("the flattened top{n}_best fields agree with the rows", async () => {
    const json = await load(createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }));
    for (let i = 1; i <= 10; i++) {
      expect(json[`top${i}_best`]).toBe(json.rows[i - 1].best_position);
      // every row field is also flattened under its own name, as before
      expect(json[`top${i}_best_position`]).toBe(json.rows[i - 1].best_position);
    }
    expect(json.top5_team).toBe("rb");
    expect(json.top5_best).toBe(2);
  });

  test("a place with no team is empty rather than missing: top{n}_best is 0", async () => {
    const json = await load(createApp({ dbPath: buildDb(), ttfDbPath: TTF_DB })); // two teams only
    expect(json.rows).toHaveLength(2);
    expect(json.top3_best).toBe(0);
    expect(json.top3_best_position).toBe(0);
    expect(json.top2_best).toBe(json.rows[1].best_position);
  });

  test("follows the active scenario: a Ferrari one-two in Round 17 pushes RB from P2 to P3", async () => {
    // RB can reach 90 + 273 = 363 once 17:race is locked (273 = 316 - 43). Mercedes 556 and Ferrari 405 + 43 = 448
    // are above that; Red Bull has 298 and McLaren 316 are not. Two teams above -> P3.
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB });
    expect((await load(app)).rows.find((r: any) => r.team === "rb").best_position).toBe(2);

    const [car1, car2] = teamCars(fixture).get("ferrari") as [string, string];
    const locks: Scenario["locks"] = { "17:race": { fixed: { [car1]: 1, [car2]: 2 } } };
    await createAndActivate(app, "Ferrari one-two", locks);
    const json = await load(app);
    expect(json.rows.find((r: any) => r.team === "rb").best_position).toBe(3);

    const engine = bestPositions(teamPositionEntries(teamStatus(fixture, { locks })));
    for (const row of json.rows) expect(row.best_position).toBe(engine.get(row.team)!);
    for (let i = 1; i <= 10; i++) expect(json[`top${i}_best`]).toBe(json.rows[i - 1].best_position);
  });
});
