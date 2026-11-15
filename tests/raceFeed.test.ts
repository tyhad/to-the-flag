/**
 * Phase 8, Step 6: the overlay feed for the race weekend.
 *
 *   GET /api/feed/grid            the effective starting grid of the next race
 *   GET /api/feed/race-forecast   the model's race forecast, from that grid
 *
 * Default test season: rounds 1 and 2 done, DDD not racing, round 3 next. The data file has an OpenF1 grid for round 3.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../api/server";
import { loadSeason } from "../data/loadSeason";
import { activeDrivers, forecastRace, formatProbability, teamCars, type SeasonState } from "../engine";
import { buildDb, cleanupDbs } from "./dbHelpers";

const BASE = "http://127.0.0.1:3100";
const JSON_HEADERS = { "content-type": "application/json" };
const FAST = { nSims: 500 };
const OPEN_F1 = ["BBB", "AAA", "CCC"];

const gridRows = (round: number, order: string[], source: string | null) =>
  order.map((abbr, i) => ({ round, abbr, position: i + 1, source }));

let DATA_DB = "";
let TTF_DIR = "";
let TTF_DB = "";
let count = 0;

beforeAll(() => {
  DATA_DB = buildDb((seed) => (seed.startingGrid = gridRows(3, OPEN_F1, "openf1")));
  TTF_DIR = mkdtempSync(join(tmpdir(), "ttf-race-feed-"));
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
  TTF_DB = join(TTF_DIR, `ttf-${++count}.sqlite`);
});

function makeApp(opts: { dbPath?: string } = {}) {
  return createApp({
    dbPath: opts.dbPath ?? DATA_DB,
    ttfDbPath: TTF_DB,
    clientIp: () => "127.0.0.1",
    oddsParams: FAST,
  });
}
type App = ReturnType<typeof makeApp>;

const get = (app: App, path: string) => app.handle(new Request(`${BASE}${path}`));
const putGrid = (app: App, order: string[], pit?: string[]) =>
  app.handle(
    new Request(`${BASE}/api/grid`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(pit === undefined ? { order } : { order, pit }),
    }),
  );

/** The forecast the route should build: the same model, field and grid. */
function expectedForecast(dbPath = DATA_DB) {
  const state: SeasonState = loadSeason(dbPath);
  const field = activeDrivers(state);
  const grid = state.upcomingGrid!.grid;
  return { state, field, grid, forecast: forecastRace(state, FAST, field, grid) };
}

const fieldOf = (state: SeasonState) => new Map(state.drivers.map((d) => [d.code, d.name]));
const teamOf = (state: SeasonState) => {
  const map = new Map<string, string>();
  for (const [team, codes] of teamCars(state)) for (const code of codes) map.set(code, team);
  return map;
};

describe("GET /api/feed/grid", () => {
  test("shape: headers, metadata, rows and the p1..p22 fields", async () => {
    const app = makeApp();
    const res = await get(app, "/api/feed/grid");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBeTruthy();

    const json = (await res.json()) as any;
    expect(typeof json.updated_at).toBe("string");
    expect(json.as_of_round).toBe(2);
    expect(json.data_status).toBe("ok");
    expect(json.season).toBe(2026);
    expect(json.available).toBe(true);
    expect(json.round).toBe(3);
    expect(json.source).toBe("openf1");

    expect(json.rows).toHaveLength(3);
    expect(Object.keys(json.rows[0])).toEqual(["position", "driver", "name", "team", "pit", "source"]);
    expect(json.rows).toEqual([
      { position: 1, driver: "BBB", name: "Driver BBB", team: "alpha", pit: false, source: "openf1" },
      { position: 2, driver: "AAA", name: "Driver AAA", team: "alpha", pit: false, source: "openf1" },
      { position: 3, driver: "CCC", name: "Driver CCC", team: "beta", pit: false, source: "openf1" },
    ]);

    // p1_* .. p22_*, one key per row field, always present
    for (const field of ["position", "driver", "name", "team", "pit", "source"]) {
      for (let i = 1; i <= 22; i++) expect(`p${i}_${field}` in json).toBe(true);
    }
    for (let i = 1; i <= 3; i++) {
      for (const [key, value] of Object.entries(json.rows[i - 1])) expect(json[`p${i}_${key}`]).toBe(value);
    }
    // a place with no driver is empty rather than missing
    expect(json.p4_position).toBe(4);
    expect(json.p4_driver).toBe("");
    expect(json.p4_name).toBe("");
    expect(json.p4_team).toBe("");
    expect(json.p4_pit).toBe(false);
    expect(json.p4_source).toBe("");
    expect(json.p22_position).toBe(22);
    expect("p23_driver" in json).toBe(false);
  });

  test("the data file's qualifying fallback is reported as qualifying", async () => {
    const path = buildDb((seed) => (seed.startingGrid = gridRows(3, ["AAA", "BBB", "CCC"], "qualifying_fallback")));
    const json = (await (await get(makeApp({ dbPath: path }), "/api/feed/grid")).json()) as any;
    expect(json.source).toBe("qualifying");
    expect(json.rows.map((r: any) => r.driver)).toEqual(["AAA", "BBB", "CCC"]);
    expect(json.rows.every((r: any) => r.source === "qualifying")).toBe(true);
  });

  test("a manual grid changes the rows, the source and the ETag", async () => {
    const app = makeApp();
    const before = await get(app, "/api/feed/grid");
    expect(((await before.json()) as any).source).toBe("openf1");

    expect((await putGrid(app, ["CCC", "BBB"], ["AAA"])).status).toBe(200);
    const after = await get(app, "/api/feed/grid");
    const json = (await after.json()) as any;
    expect(json.source).toBe("manual");
    expect(json.round).toBe(3);
    expect(json.rows).toEqual([
      { position: 1, driver: "CCC", name: "Driver CCC", team: "beta", pit: false, source: "manual" },
      { position: 2, driver: "BBB", name: "Driver BBB", team: "alpha", pit: false, source: "manual" },
      { position: 3, driver: "AAA", name: "Driver AAA", team: "alpha", pit: true, source: "manual" },
    ]);
    expect(json.p3_pit).toBe(true);
    expect("top1_driver" in json).toBe(false); // the grid feed has p*_ fields only
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
  });

  test("available: false when no grid is known", async () => {
    const app = makeApp({ dbPath: buildDb() });
    const res = await get(app, "/api/feed/grid");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json).toMatchObject({ available: false, as_of_round: 2, data_status: "ok", season: 2026 });
    expect(typeof json.updated_at).toBe("string");
    expect("rows" in json).toBe(false);
    expect("source" in json).toBe(false);
    expect("p1_driver" in json).toBe(false);
  });

  test("503 when the data file is missing", async () => {
    const app = makeApp({ dbPath: join(import.meta.dir, "no-such-file.sqlite") });
    const res = await get(app, "/api/feed/grid");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("data_file_missing");
  });

  test("503 when the schema version is too old", async () => {
    const old = buildDb((seed) => {
      seed.schemaVersion = 1;
    });
    const res = await get(makeApp({ dbPath: old }), "/api/feed/grid");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("schema_version_invalid");
  });
});

describe("GET /api/feed/race-forecast", () => {
  test("shape: metadata, labels, rows and the top1..top10 fields", async () => {
    const app = makeApp();
    const res = await get(app, "/api/feed/race-forecast");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBeTruthy();

    const json = (await res.json()) as any;
    expect(typeof json.updated_at).toBe("string");
    expect(json.as_of_round).toBe(2);
    expect(json.data_status).toBe("ok");
    expect(json.season).toBe(2026);
    expect(json.available).toBe(true);
    expect(json.model).toBe("estimate");
    expect(json.label).toBe("Model estimate");
    expect(json.round).toBe(3);
    expect(json.source).toBe("openf1");
    expect(json.n_sims).toBe(FAST.nSims);

    expect(json.rows).toHaveLength(3); // DDD is not racing
    expect(Object.keys(json.rows[0])).toEqual([
      "rank", "driver", "name", "team", "grid", "win_display", "podium_display", "points_display", "mean_position", "source",
    ]);

    // the numbers are the model's, worded like the rest of the app, and the grid places are the grid's
    const { state, forecast } = expectedForecast();
    const names = fieldOf(state);
    const teams = teamOf(state);
    const places = state.upcomingGrid!.grid;
    for (const row of json.rows) {
      expect(row.name).toBe(names.get(row.driver));
      expect(row.team).toBe(teams.get(row.driver));
      expect(row.grid).toBe(places[row.driver]);
      expect(row.win_display).toBe(formatProbability(forecast.win[row.driver]!));
      expect(row.podium_display).toBe(formatProbability(forecast.podium[row.driver]!));
      expect(row.points_display).toBe(formatProbability(forecast.top10[row.driver]!));
      expect(row.mean_position).toBe(Math.round(forecast.meanPosition[row.driver]! * 100) / 100);
      expect(row.source).toBe("openf1");
      expect(row.win_display).not.toBe("0%");
      expect(row.win_display).not.toBe("100%");
    }
    // sorted by the chance to win, best first
    const wins = json.rows.map((r: any) => forecast.win[r.driver]);
    for (let i = 1; i < wins.length; i++) expect(wins[i - 1]).toBeGreaterThanOrEqual(wins[i]);
    expect(json.rows.map((r: any) => r.rank)).toEqual([1, 2, 3]);

    // top1_* .. top10_*, one key per row field, always present
    for (const field of ["rank", "driver", "name", "team", "grid", "win_display", "podium_display", "points_display", "mean_position", "source"]) {
      for (let i = 1; i <= 10; i++) expect(`top${i}_${field}` in json).toBe(true);
    }
    for (let i = 1; i <= 3; i++) {
      for (const [key, value] of Object.entries(json.rows[i - 1])) expect(json[`top${i}_${key}`]).toBe(value);
    }
    // a place with no row is empty rather than missing
    expect(json.top4_rank).toBe(4);
    expect(json.top4_driver).toBe("");
    expect(json.top4_name).toBe("");
    expect(json.top4_team).toBe("");
    expect(json.top4_grid).toBe(0);
    expect(json.top4_win_display).toBe("");
    expect(json.top4_podium_display).toBe("");
    expect(json.top4_points_display).toBe("");
    expect(json.top4_mean_position).toBe(0);
    expect(json.top4_source).toBe("");
    expect("top11_driver" in json).toBe(false);
  });

  test("a manual grid changes the places, the source and the ETag", async () => {
    const app = makeApp();
    const before = await get(app, "/api/feed/race-forecast");
    const beforeText = await before.text();
    const beforeJson = JSON.parse(beforeText);
    expect(beforeJson.source).toBe("openf1");
    expect(beforeJson.rows.find((r: any) => r.driver === "AAA").grid).toBe(2);

    expect((await putGrid(app, ["AAA", "BBB", "CCC"])).status).toBe(200);
    const after = await get(app, "/api/feed/race-forecast");
    const afterText = await after.text();
    const json = JSON.parse(afterText);
    expect(json.source).toBe("manual");
    expect(json.rows.find((r: any) => r.driver === "AAA").grid).toBe(1);
    expect(json.rows.find((r: any) => r.driver === "BBB").grid).toBe(2);
    expect(json.rows.every((r: any) => r.source === "manual")).toBe(true);
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
    expect(afterText).not.toBe(beforeText);
  });

  test("the same request twice gives the same body and is cached", async () => {
    const app = makeApp();
    const first = await get(app, "/api/feed/race-forecast");
    const second = await get(app, "/api/feed/race-forecast");
    expect(first.headers.get("x-forecast-cache")).toBe("miss");
    expect(second.headers.get("x-forecast-cache")).toBe("hit");
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(await second.text()).toBe(await first.text());
  });

  test("available: false when no grid is known", async () => {
    const app = makeApp({ dbPath: buildDb() });
    const res = await get(app, "/api/feed/race-forecast");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json).toMatchObject({ available: false, as_of_round: 2, data_status: "ok", season: 2026 });
    expect(typeof json.updated_at).toBe("string");
    expect("rows" in json).toBe(false);
    expect("label" in json).toBe(false);
    expect("top1_driver" in json).toBe(false);
  });

  test("503 when the data file is missing", async () => {
    const app = makeApp({ dbPath: join(import.meta.dir, "no-such-file.sqlite") });
    const res = await get(app, "/api/feed/race-forecast");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("data_file_missing");
  });

  test("503 when the schema version is too old", async () => {
    const old = buildDb((seed) => {
      seed.schemaVersion = 1;
    });
    const res = await get(makeApp({ dbPath: old }), "/api/feed/race-forecast");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("schema_version_invalid");
  });
});
