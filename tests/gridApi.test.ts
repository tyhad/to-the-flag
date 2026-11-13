/**
 * Phase 8, Step 2: the manual starting grid in storage and over HTTP.
 * Default test season: rounds 1 and 2 done, DDD not racing, round 3 next. The data file has an OpenF1 grid for round 3.
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScenarioDatabase } from "../api/db";
import { createApp } from "../api/server";
import { buildDb, cleanupDbs, sessionRows, type Seed } from "./dbHelpers";

const BASE = "http://127.0.0.1:3100";
const JSON_HEADERS = { "content-type": "application/json" };
const OPEN_F1 = ["BBB", "AAA", "CCC"];

const gridRows = (round: number, order: string[], source: string | null) =>
  order.map((abbr, i) => ({ round, abbr, position: i + 1, source }));

/** A data file whose four rounds are all done, so no race is left. */
const finishedSeason = () =>
  buildDb((seed: Seed) => {
    const field: [string, string][] = [["AAA", "alpha"], ["BBB", "alpha"], ["CCC", "beta"]];
    seed.schedule = seed.schedule.map((r) => ({ ...r, status: "completed" }));
    seed.results = [...seed.results, ...sessionRows(3, "Race", field), ...sessionRows(4, "Sprint", field), ...sessionRows(4, "Race", field)];
  });

let DATA_DB = "";
let TTF_DIR = "";
let TTF_DB = "";
let count = 0;

beforeAll(() => {
  DATA_DB = buildDb((seed) => (seed.startingGrid = gridRows(3, OPEN_F1, "openf1")));
  TTF_DIR = mkdtempSync(join(tmpdir(), "ttf-grid-"));
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

function makeApp(opts: { dbPath?: string; ttfDbPath?: string; token?: string | null; ip?: string } = {}) {
  return createApp({
    dbPath: opts.dbPath ?? DATA_DB,
    ttfDbPath: opts.ttfDbPath ?? TTF_DB,
    token: opts.token ?? null,
    clientIp: () => opts.ip ?? "127.0.0.1",
    oddsParams: { nSims: 500 },
  });
}
type App = ReturnType<typeof makeApp>;

const get = (app: App, path: string, headers: Record<string, string> = {}) => app.handle(new Request(`${BASE}${path}`, { headers }));
const send = (app: App, method: "PUT" | "DELETE", body?: unknown, headers: Record<string, string> = {}) =>
  app.handle(
    new Request(`${BASE}/api/grid`, {
      method,
      headers: { ...JSON_HEADERS, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
const put = (app: App, order: unknown, pit?: unknown) => send(app, "PUT", pit === undefined ? { order } : { order, pit });

describe("GET /api/grid", () => {
  test("reports the data file's OpenF1 grid when there is no manual grid", async () => {
    const res = await get(makeApp(), "/api/grid");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      round: 3,
      effective: { order: OPEN_F1, pit: [], source: "openf1" },
      data: { source: "openf1", order: OPEN_F1 },
      override: null,
      differs: false,
    });
  });

  test("the qualifying fallback is reported as qualifying", async () => {
    const path = buildDb((seed) => (seed.startingGrid = gridRows(3, ["AAA", "BBB", "CCC"], "qualifying_fallback")));
    const json = (await (await get(makeApp({ dbPath: path }), "/api/grid")).json()) as any;
    expect(json.effective).toEqual({ order: ["AAA", "BBB", "CCC"], pit: [], source: "qualifying" });
    expect(json.data.source).toBe("qualifying");
  });

  test("no grid in the data file: nothing in use, but the round is still reported", async () => {
    const path = buildDb();
    expect(await (await get(makeApp({ dbPath: path }), "/api/grid")).json()).toEqual({
      round: 3,
      effective: null,
      data: null,
      override: null,
      differs: false,
    });
  });

  test("season over: no round and no grid", async () => {
    const res = await get(makeApp({ dbPath: finishedSeason() }), "/api/grid");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ round: null, effective: null, data: null, override: null, differs: false });
  });

  test("503 like the other routes when the data file is missing", async () => {
    const res = await get(makeApp({ dbPath: join(TTF_DIR, "nope.sqlite") }), "/api/grid");
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("data_file_missing");
  });
});

describe("PUT /api/grid", () => {
  test("saves the manual grid and answers with the grid now in use", async () => {
    const app = makeApp();
    const res = await put(app, ["AAA", "BBB", "CCC"]);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.round).toBe(3);
    expect(json.effective).toEqual({ order: ["AAA", "BBB", "CCC"], pit: [], source: "manual" });
    expect(json.data).toEqual({ source: "openf1", order: OPEN_F1 });
    expect(json.override.valid).toBe(true);
    expect(typeof json.override.updatedAt).toBe("string");
    expect(json.differs).toBe(true);
    expect(await (await get(app, "/api/grid")).json()).toEqual(json);
  });

  test("the pit-lane starters are saved apart and get the last places", async () => {
    const app = makeApp();
    const json = (await (await put(app, ["BBB", "AAA"], ["CCC"])).json()) as any;
    expect(json.effective).toEqual({ order: ["BBB", "AAA"], pit: ["CCC"], source: "manual" });
    expect(json.differs).toBe(false); // the same places as OpenF1's grid
    const season = (await (await get(app, "/api/season")).json()) as any;
    expect(season.upcomingGrid).toEqual({ round: 3, grid: { BBB: 1, AAA: 2, CCC: 3 }, source: "manual" });
  });

  test("a second PUT replaces the first", async () => {
    const app = makeApp();
    await put(app, ["AAA", "BBB", "CCC"]);
    const json = (await (await put(app, ["CCC", "BBB", "AAA"])).json()) as any;
    expect(json.effective.order).toEqual(["CCC", "BBB", "AAA"]);
  });

  test("works when the data file has no grid at all", async () => {
    const app = makeApp({ dbPath: buildDb() });
    const json = (await (await put(app, ["CCC", "AAA", "BBB"])).json()) as any;
    expect(json.effective.source).toBe("manual");
    expect(json.data).toBeNull();
    expect(json.differs).toBe(false);
  });

  const rejects = async (order: unknown, pit: unknown, errors: string[]) => {
    const app = makeApp();
    const res = await put(app, order, pit);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ errors });
    // nothing was saved
    expect(((await (await get(app, "/api/grid")).json()) as any).override).toBeNull();
  };

  test("422 names a missing driver", () => rejects(["AAA", "BBB"], undefined, ["Missing from the grid: CCC."]));
  test("422 names a repeated driver", () => rejects(["AAA", "BBB", "CCC", "AAA"], undefined, ["AAA is listed 2 times."]));
  test("422 names a repeat between the two lists", () => rejects(["AAA", "BBB", "CCC"], ["CCC"], ["CCC is listed 2 times."]));
  test("422 names an unknown code", () => rejects(["AAA", "BBB", "CCC", "ZZZ"], undefined, ["ZZZ is not a driver in this season."]));
  test("422 names a driver who is not racing", () =>
    rejects(["AAA", "BBB", "CCC", "DDD"], undefined, ["DDD is not racing, so it cannot be on the grid."]));
  test("422 for an order that is not a list of codes", () => rejects("AAA BBB CCC", undefined, ["order must be a list of driver codes."]));
  test("422 for an order with something other than text in it", () => rejects(["AAA", 2, "CCC"], undefined, ["order must be a list of driver codes."]));
  test("422 for a pit list that is not a list of codes", () => rejects(["AAA", "BBB", "CCC"], "CCC", ["pit must be a list of driver codes."]));

  test("422 for a body that is not an object", async () => {
    const app = makeApp();
    const res = await send(app, "PUT", ["AAA"]);
    expect(res.status).toBe(422);
  });

  test("409 when no race is left, and nothing is saved", async () => {
    const res = await put(makeApp({ dbPath: finishedSeason() }), ["AAA", "BBB", "CCC"]);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe("no_upcoming_round");
    expect(new ScenarioDatabase(TTF_DB).getGridOverride(2026, 4)).toBeNull();
  });
});

describe("DELETE /api/grid", () => {
  test("removes the manual grid: the data file's grid is back", async () => {
    const app = makeApp();
    await put(app, ["AAA", "BBB", "CCC"]);
    const res = await send(app, "DELETE");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.override).toBeNull();
    expect(json.effective).toEqual({ order: OPEN_F1, pit: [], source: "openf1" });
    expect(json.differs).toBe(false);
  });

  test("removing it twice, or when there never was one, is fine", async () => {
    const app = makeApp();
    expect((await send(app, "DELETE")).status).toBe(200);
    await put(app, ["AAA", "BBB", "CCC"]);
    expect((await send(app, "DELETE")).status).toBe(200);
    expect((await send(app, "DELETE")).status).toBe(200);
  });
});

describe("the season the app serves follows the manual grid", () => {
  test("/api/season has it, with source manual, and its ETag changes", async () => {
    const app = makeApp();
    const before = await get(app, "/api/season");
    const etagBefore = before.headers.get("etag")!;
    expect(((await before.json()) as any).upcomingGrid.source).toBe("openf1");

    await put(app, ["AAA", "BBB", "CCC"]);
    const after = await get(app, "/api/season");
    const etagAfter = after.headers.get("etag")!;
    expect(etagAfter).not.toBe(etagBefore);
    expect(etagAfter.startsWith('"') && etagAfter.endsWith('"')).toBe(true);
    expect(((await after.json()) as any).upcomingGrid).toEqual({ round: 3, grid: { AAA: 1, BBB: 2, CCC: 3 }, source: "manual" });

    // the new ETag is honoured, the old one is not
    expect((await get(app, "/api/season", { "if-none-match": etagAfter })).status).toBe(304);
    expect((await get(app, "/api/season", { "if-none-match": etagBefore })).status).toBe(200);
  });

  test("a different manual grid is a different ETag; the same data again is the same", async () => {
    const app = makeApp();
    await put(app, ["AAA", "BBB", "CCC"]);
    const first = (await get(app, "/api/season")).headers.get("etag");
    expect((await get(app, "/api/season")).headers.get("etag")).toBe(first);
    await put(app, ["CCC", "BBB", "AAA"]);
    expect((await get(app, "/api/season")).headers.get("etag")).not.toBe(first);
  });

  test("clearing the manual grid gives back the data file's ETag and grid", async () => {
    const app = makeApp();
    const original = (await get(app, "/api/season")).headers.get("etag");
    await put(app, ["AAA", "BBB", "CCC"]);
    await send(app, "DELETE");
    const res = await get(app, "/api/season");
    expect(res.headers.get("etag")).toBe(original);
    expect(((await res.json()) as any).upcomingGrid.source).toBe("openf1");
  });

  test("the odds feed is computed again after the grid changes", async () => {
    const app = makeApp();
    await get(app, "/api/feed/odds");
    expect((await get(app, "/api/feed/odds")).headers.get("x-odds-cache")).toBe("hit");
    await put(app, ["AAA", "BBB", "CCC"]);
    expect((await get(app, "/api/feed/odds")).headers.get("x-odds-cache")).toBe("miss");
  });
});

describe("the manual grid is kept and ignored when it no longer applies", () => {
  test("it survives a restart of the server", async () => {
    await put(makeApp(), ["AAA", "BBB", "CCC"]);
    const json = (await (await get(makeApp(), "/api/grid")).json()) as any;
    expect(json.effective).toEqual({ order: ["AAA", "BBB", "CCC"], pit: [], source: "manual" });
  });

  test("once the race has results the next race is round 4 and the old grid is not used, but stays stored", async () => {
    await put(makeApp(), ["AAA", "BBB", "CCC"]); // saved for round 3
    const next = buildDb((seed: Seed) => {
      seed.schedule = seed.schedule.map((r) => (r.round === 3 ? { ...r, status: "completed" } : r));
      seed.results = [
        ...seed.results,
        ...["AAA", "BBB", "CCC"].map((abbr, i) => ({
          round: 3,
          session: "Race" as const,
          abbr,
          name: `Driver ${abbr}`,
          teamName: "Alpha",
          constructorId: "alpha",
          position: i + 1,
          points: 10 - i,
        })),
      ];
      seed.startingGrid = gridRows(4, ["CCC", "BBB", "AAA"], "qualifying_fallback");
    });
    const app = makeApp({ dbPath: next });
    const json = (await (await get(app, "/api/grid")).json()) as any;
    expect(json.round).toBe(4);
    expect(json.override).toBeNull();
    expect(json.effective.source).toBe("qualifying");
    expect(((await (await get(app, "/api/season")).json()) as any).upcomingGrid.round).toBe(4);
    // still there, for the record
    const db = new ScenarioDatabase(TTF_DB);
    expect(db.getGridOverride(2026, 3)?.order).toEqual(["AAA", "BBB", "CCC"]);
    db.close();
  });

  test("a saved grid that no longer fits the drivers is reported as not valid and is not used", async () => {
    const db = new ScenarioDatabase(TTF_DB);
    db.setGridOverride(2026, 3, ["AAA", "BBB", "CCC", "DDD"], []); // DDD is not racing
    db.close();
    const app = makeApp();
    const json = (await (await get(app, "/api/grid")).json()) as any;
    expect(json.override.valid).toBe(false);
    expect(json.effective.source).toBe("openf1");
    const season = (await (await get(app, "/api/season")).json()) as any;
    expect(season.upcomingGrid.source).toBe("openf1");
  });
});

describe("who may write", () => {
  test("reading is open to everyone, even a remote client with a token configured", async () => {
    const res = await get(makeApp({ token: "a-very-long-secret-token-1234", ip: "192.168.1.50" }), "/api/grid");
    expect(res.status).toBe(200);
  });

  test("a remote client cannot save or remove it", async () => {
    const app = makeApp({ ip: "192.168.1.50" });
    expect((await put(app, ["AAA", "BBB", "CCC"])).status).toBe(403);
    expect((await send(app, "DELETE")).status).toBe(403);
  });

  test("with a token configured, writing needs it", async () => {
    const token = "a-very-long-secret-token-1234";
    const app = makeApp({ token });
    expect((await put(app, ["AAA", "BBB", "CCC"])).status).toBe(401);
    const ok = await send(app, "PUT", { order: ["AAA", "BBB", "CCC"] }, { authorization: `Bearer ${token}` });
    expect(ok.status).toBe(200);
    expect((await send(app, "DELETE", undefined, { authorization: `Bearer ${token}` })).status).toBe(200);
  });

  test("a cross-site request and a non-JSON body are refused", async () => {
    const app = makeApp();
    const cross = await app.handle(
      new Request(`${BASE}/api/grid`, {
        method: "PUT",
        headers: { ...JSON_HEADERS, origin: "http://evil.example" },
        body: JSON.stringify({ order: ["AAA", "BBB", "CCC"] }),
      }),
    );
    expect(cross.status).toBe(403);
    const text = await app.handle(
      new Request(`${BASE}/api/grid`, { method: "PUT", headers: { "content-type": "text/plain" }, body: "AAA BBB CCC" }),
    );
    expect(text.status).toBe(415);
  });
});

describe("storage (api/db.ts)", () => {
  test("a database from before Phase 8 gains the table and keeps its scenarios", () => {
    const old = new Database(TTF_DB, { create: true });
    old.run("CREATE TABLE scenarios (id TEXT PRIMARY KEY, name TEXT NOT NULL, season INTEGER NOT NULL, as_of_round INTEGER NOT NULL, locks_json TEXT NOT NULL, contenders_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    old.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)");
    old.run("INSERT INTO scenarios VALUES ('s1', 'Old one', 2026, 2, '{}', NULL, 'x', 'x')");
    old.run("PRAGMA user_version = 1");
    old.close();

    const db = new ScenarioDatabase(TTF_DB);
    expect(db.getGridOverride(2026, 3)).toBeNull();
    db.setGridOverride(2026, 3, ["AAA"], []);
    expect(db.getGridOverride(2026, 3)?.order).toEqual(["AAA"]);
    db.close();

    const check = new Database(TTF_DB);
    expect(check.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(check.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM scenarios").get()?.n).toBe(1);
    check.close();
  });

  test("one row per race: saving again replaces, clearing removes, other races are untouched", () => {
    const db = new ScenarioDatabase(TTF_DB);
    db.setGridOverride(2026, 3, ["AAA", "BBB"], ["CCC"]);
    db.setGridOverride(2026, 4, ["CCC"], []);
    const second = db.setGridOverride(2026, 3, ["BBB", "AAA"], []);
    expect(db.getGridOverride(2026, 3)).toEqual(second);
    expect(db.getGridOverride(2026, 3)?.pit).toEqual([]);
    expect(db.clearGridOverride(2026, 3)).toBe(true);
    expect(db.clearGridOverride(2026, 3)).toBe(false);
    expect(db.getGridOverride(2026, 3)).toBeNull();
    expect(db.getGridOverride(2026, 4)?.order).toEqual(["CCC"]);
    expect(db.getGridOverride(2025, 4)).toBeNull(); // another season
    db.close();
  });

  test("a row that cannot be read counts as no manual grid", () => {
    const db = new ScenarioDatabase(TTF_DB);
    db.close();
    const raw = new Database(TTF_DB);
    raw.run("INSERT INTO grid_overrides VALUES (2026, 3, 'not json', '[]', 'x')");
    raw.run("INSERT INTO grid_overrides VALUES (2026, 4, '[1, 2]', '[]', 'x')");
    raw.close();
    const again = new ScenarioDatabase(TTF_DB);
    expect(again.getGridOverride(2026, 3)).toBeNull();
    expect(again.getGridOverride(2026, 4)).toBeNull();
    again.close();
  });
});
