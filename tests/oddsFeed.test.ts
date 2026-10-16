/**
 * Overlay feed: GET /api/feed/odds (Phase 3 Step 7), and the pieces it is built from.
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OddsCache, buildOddsPayload, oddsCacheKey } from "../api/oddsFeed";
import { createApp } from "../api/server";
import { computeOdds } from "../engine/odds";
import { remainingSessions } from "../engine/sessions";
import type { Scenario, SeasonState } from "../engine/types";
import { buildDb, buildFixtureDb, cleanupDbs } from "./dbHelpers";

const BASE = "http://127.0.0.1:3100";
const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const FAST = { nSims: 1500 };

let DB_PATH = "";
// Every test gets its own scenario database. On Windows an open SQLite file cannot be deleted, so reusing one file
// would let one test's active scenario leak into the next.
let TTF_DIR = "";
let TTF_DB = "";
let ttfCount = 0;
beforeAll(() => {
  DB_PATH = buildFixtureDb();
  TTF_DIR = mkdtempSync(join(tmpdir(), "ttf-odds-feed-"));
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

const get = (app: ReturnType<typeof createApp>, path = "/api/feed/odds") => app.handle(new Request(`${BASE}${path}`));
async function send(app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) {
  return app.handle(
    new Request(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
}
/** A scenario that keeps ANT out of every remaining session, so the title race really changes. */
const antOut: Scenario = { locks: Object.fromEntries(remainingSessions(fixture).map((k) => [k, { fixed: { ANT: "out" as const } }])) };

async function createAndActivate(app: ReturnType<typeof createApp>, name: string, locks: Scenario["locks"]) {
  const created = (await (await send(app, "POST", "/api/scenarios", { name, locks })).json()) as any;
  expect((await send(app, "PUT", "/api/active-scenario", { id: created.id })).status).toBe(200);
  return created.id as string;
}

// ---------- the route ----------

describe("GET /api/feed/odds", () => {
  test("shape: metadata, the two tables, and the flattened top-10 fields", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB }); // default parameters: 10,000 simulations
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBeTruthy();
    const json = (await res.json()) as any;

    expect(json).toMatchObject({
      available: true,
      model: "estimate",
      label: "Model estimate",
      as_of_round: 16,
      data_status: "ok",
      season: 2026,
      low_confidence: false,
      model_version: "v2",
      grid_known_round: null,
      n_sims: 10_000,
      scenario: null,
    });
    expect(typeof json.updated_at).toBe("string");

    for (const rows of [json.wdc, json.wcc]) {
      expect(rows).toBeArray();
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((r: any, i: number) => {
        expect(r.rank).toBe(i + 1);
        expect(typeof r.id).toBe("string");
        expect(typeof r.name).toBe("string");
        expect(r.win_pct).toBeGreaterThanOrEqual(0);
        expect(r.win_pct).toBeLessThanOrEqual(100);
        expect(typeof r.display).toBe("string");
        expect("base_display" in r).toBe(false); // no scenario is active
      });
    }
    expect(json.wdc[0]).toMatchObject({ rank: 1, id: "ANT", name: fixture.drivers.find((d) => d.code === "ANT")!.name, display: ">99%" });
    expect(json.wcc[0]).toMatchObject({ rank: 1, id: "mercedes", display: ">99%" });
    // sorted by probability
    for (let i = 1; i < json.wdc.length; i++) expect(json.wdc[i - 1].win_pct).toBeGreaterThanOrEqual(json.wdc[i].win_pct);

    // flattened: the drivers' table directly, and with wdc_ / wcc_ prefixes, for ranks 1 to 10
    expect(json.top1_id).toBe("ANT");
    expect(json.top1_display).toBe(json.wdc[0].display);
    expect(json.top1_win_pct).toBe(json.wdc[0].win_pct);
    expect(json.top2_id).toBe(json.wdc[1].id);
    expect(json.top1_wdc_id).toBe("ANT");
    expect(json.top1_wcc_id).toBe("mercedes");
    expect(json.top1_base_display).toBe(""); // the key exists, empty without a scenario
    for (let i = 1; i <= 10; i++) {
      for (const prefix of ["", "wdc_", "wcc_"]) {
        for (const field of ["rank", "id", "name", "win_pct", "display", "base_display"]) {
          expect(`top${i}_${prefix}${field}` in json).toBe(true);
        }
      }
    }
    // a place with no row is empty rather than missing
    const emptyTeamSlots = Object.keys(json).filter((k) => /^top\d+_wcc_id$/.test(k) && json[k] === "");
    expect(emptyTeamSlots.length).toBe(10 - json.wcc.length);
    expect(json.top10_wcc_rank).toBe(10);
  });

  test("two calls return an identical body, and the second does not simulate again", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB, oddsParams: FAST });
    const first = await get(app);
    const second = await get(app);
    expect(first.headers.get("x-odds-cache")).toBe("miss");
    expect(second.headers.get("x-odds-cache")).toBe("hit");
    expect(await second.text()).toBe(await first.text());
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
  });

  test("the cache is shared by repeated polling and does not mix up apps with other parameters", async () => {
    const a = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB, oddsParams: { nSims: 1000 } });
    const b = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB, oddsParams: { nSims: 2000 } });
    expect(((await (await get(a)).json()) as any).n_sims).toBe(1000);
    expect(((await (await get(b)).json()) as any).n_sims).toBe(2000);
  });

  test("the body changes after activating a scenario, and base_display shows the odds without it", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB, oddsParams: FAST });
    const before = (await (await get(app)).json()) as any;
    expect(before.scenario).toBeNull();

    const id = await createAndActivate(app, "No ANT", antOut.locks);
    const res = await get(app);
    expect(res.headers.get("x-odds-cache")).toBe("miss");
    const after = (await res.json()) as any;

    expect(after.scenario).toEqual({ id, name: "No ANT" });
    expect(after.wdc).not.toEqual(before.wdc);
    // ANT sits out every session: still ahead by 84 points, but no longer certain. HAM goes from <1% to a real chance.
    const ant = after.wdc.find((r: any) => r.id === "ANT");
    expect(ant.base_display).toBe(">99%");
    expect(ant.display).not.toBe(">99%");
    expect(ant.win_pct).toBeLessThan(before.wdc.find((r: any) => r.id === "ANT").win_pct);
    const ham = after.wdc.find((r: any) => r.id === "HAM");
    expect(ham.base_display).toBe("<1%");
    expect(ham.display).not.toBe("<1%");
    for (const r of after.wdc) expect(typeof r.base_display).toBe("string");
    for (const r of after.wcc) expect(typeof r.base_display).toBe("string");
    expect(after.top1_base_display).toBe(after.wdc[0].base_display);

    // switching the scenario off gives the original body back, without simulating again
    expect((await send(app, "PUT", "/api/active-scenario", { id: null })).status).toBe(200);
    const off = await get(app);
    expect(off.headers.get("x-odds-cache")).toBe("hit");
    expect(await off.text()).toBe(JSON.stringify(before));
  });

  test("editing the active scenario's locks is a new version: it is simulated again", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB, oddsParams: FAST });
    const id = await createAndActivate(app, "Draft", { "17:race": { fixed: { NOR: 1 } } });
    const one = await get(app);
    expect(one.headers.get("x-odds-cache")).toBe("miss");
    expect((await get(app)).headers.get("x-odds-cache")).toBe("hit");

    await new Promise((r) => setTimeout(r, 5)); // updated_at has millisecond resolution
    expect((await send(app, "PUT", `/api/scenarios/${id}`, { locks: antOut.locks })).status).toBe(200);
    const two = await get(app);
    expect(two.headers.get("x-odds-cache")).toBe("miss");
    expect(await two.text()).not.toBe(await one.text());

    // a rename keeps the odds, but the scenario name in the body follows
    await new Promise((r) => setTimeout(r, 5));
    await send(app, "PUT", `/api/scenarios/${id}`, { name: "Renamed" });
    const three = (await (await get(app)).json()) as any;
    expect(three.scenario).toEqual({ id, name: "Renamed" });
  });

  test("an active scenario that is no longer valid falls back to the base odds", async () => {
    const app = createApp({ dbPath: DB_PATH, ttfDbPath: TTF_DB, oddsParams: FAST }); // creates the tables
    const raw = new Database(TTF_DB);
    raw
      .query(
        "INSERT INTO scenarios (id, name, season, as_of_round, locks_json, contenders_json, created_at, updated_at) VALUES ('bad', 'Old', 2026, 12, ?, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
      )
      .run(JSON.stringify({ "1:race": { fixed: { NOR: 1 } } })); // round 1 already has results
    raw.query("INSERT OR REPLACE INTO app_state (key, value) VALUES ('active_scenario_id', 'bad')").run();
    raw.close();

    const res = await get(app);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.scenario).toBeNull();
    expect(json.wdc[0].id).toBe("ANT");
    expect("base_display" in json.wdc[0]).toBe(false);
  });

  test("503 when the data file is missing", async () => {
    const app = createApp({ dbPath: join(import.meta.dir, "no-such-file.sqlite"), ttfDbPath: TTF_DB });
    const res = await get(app);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("data_file_missing");
  });

  test("503 when the schema version is too old", async () => {
    const old = buildDb((seed) => {
      seed.schemaVersion = 1;
    });
    const res = await get(createApp({ dbPath: old, ttfDbPath: TTF_DB }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("schema_version_invalid");
  });
});

// ---------- the pieces ----------

describe("oddsCacheKey", () => {
  const scenario = { id: "s1", version: "2026-01-01T00:00:00.000Z" };

  test("is the same for the same inputs, whatever the order of the parameters", () => {
    expect(oddsCacheKey('"a-1"', scenario, { nSims: 100, formWeight: 0.5 })).toBe(oddsCacheKey('"a-1"', scenario, { formWeight: 0.5, nSims: 100 }));
  });

  test("changes with the season data, the scenario id, the scenario version and the parameters", () => {
    const k = oddsCacheKey('"a-1"', scenario, {});
    expect(oddsCacheKey('"a-2"', scenario, {})).not.toBe(k);
    expect(oddsCacheKey('"a-1"', { ...scenario, id: "s2" }, {})).not.toBe(k);
    expect(oddsCacheKey('"a-1"', { ...scenario, version: "later" }, {})).not.toBe(k);
    expect(oddsCacheKey('"a-1"', null, {})).not.toBe(k);
    expect(oddsCacheKey('"a-1"', scenario, { nSims: 5 })).not.toBe(k);
  });
});

describe("OddsCache", () => {
  test("computes once per key and says whether it was a hit", () => {
    const cache = new OddsCache<number>(4);
    let calls = 0;
    const compute = () => ++calls;
    expect(cache.getOrCompute("a", compute)).toEqual({ value: 1, hit: false });
    expect(cache.getOrCompute("a", compute)).toEqual({ value: 1, hit: true });
    expect(cache.getOrCompute("b", compute)).toEqual({ value: 2, hit: false });
    expect(calls).toBe(2);
  });

  test("keeps at most `max` entries and drops the least recently used", () => {
    const cache = new OddsCache<string>(2);
    cache.getOrCompute("a", () => "A");
    cache.getOrCompute("b", () => "B");
    cache.getOrCompute("a", () => "A2"); // touch a: b is now the oldest
    cache.getOrCompute("c", () => "C"); // evicts b
    expect(cache.size).toBe(2);
    expect(cache.getOrCompute("a", () => "new").hit).toBe(true);
    expect(cache.getOrCompute("b", () => "B2")).toEqual({ value: "B2", hit: false });
  });

  test("a compute that throws is not cached", () => {
    const cache = new OddsCache<number>();
    expect(() =>
      cache.getOrCompute("x", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(cache.getOrCompute("x", () => 7)).toEqual({ value: 7, hit: false });
  });
});

describe("buildOddsPayload", () => {
  const base = computeOdds(fixture, undefined, FAST);
  const scen = computeOdds(fixture, antOut, FAST);

  test("without a scenario: no base_display on the rows", () => {
    const p = buildOddsPayload(fixture, base, null, null);
    expect(p.scenario).toBeNull();
    expect(p.wdc.every((r) => !("base_display" in r))).toBe(true);
    expect(p.n_sims).toBe(1500);
  });

  test("with a scenario: every row has base_display, <1% when the driver was not in the base table", () => {
    const p = buildOddsPayload(fixture, scen, { id: "s", name: "No ANT" }, base);
    expect(p.scenario).toEqual({ id: "s", name: "No ANT" });
    const inBase = new Set(base.wdc.map((r) => r.id));
    for (const r of p.wdc) {
      expect(typeof r.base_display).toBe("string");
      if (!inBase.has(r.id)) expect(r.base_display).toBe("<1%");
    }
  });

  test("model_version says which model made the numbers", () => {
    expect(buildOddsPayload(fixture, base, null, null).model_version).toBe("v2");
  });

  test("grid_known_round says which round's real grid the model used, or null", () => {
    expect(buildOddsPayload(fixture, base, null, null).grid_known_round).toBeNull();
    expect(buildOddsPayload(fixture, { ...base, gridKnownRound: 17 }, null, null).grid_known_round).toBe(17);
  });

  test("win_pct is the probability in percent with two decimals", () => {
    const p = buildOddsPayload(fixture, base, null, null);
    p.wdc.forEach((r, i) => expect(r.win_pct).toBe(Math.round(base.wdc[i]!.probability * 10_000) / 100));
  });
});
