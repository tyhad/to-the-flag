/**
 * Tests for overlay feed endpoints (/api/feed/*) (Phase 2 Step 3).
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../api/server";

const REAL_DB_PATH = join(import.meta.dir, "..", "..", "F1GStats", "f1gstats.sqlite");
const TEMP_TTF_DB = join(import.meta.dir, "temp-feed-ttf.sqlite");

function cleanupTempDb() {
  if (existsSync(TEMP_TTF_DB)) {
    try {
      unlinkSync(TEMP_TTF_DB);
    } catch {
      // ignore
    }
  }
}

describe("Overlay Feed Routes (Step 3)", () => {
  beforeEach(() => {
    cleanupTempDb();
  });
  afterEach(() => {
    cleanupTempDb();
  });

  test("GET /api/feed/standings returns standings rows, flattened top fields, and headers", async () => {
    const app = createApp({ dbPath: REAL_DB_PATH, ttfDbPath: TEMP_TTF_DB });
    const res = await app.handle(new Request("http://127.0.0.1:3100/api/feed/standings"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBeTruthy();

    const json = (await res.json()) as any;
    expect(typeof json.updated_at).toBe("string");
    expect(typeof json.as_of_round).toBe("number");
    expect(json.data_status).toBe("ok");
    expect(json.season).toBe(2026);
    expect(json.rows).toBeArray();
    expect(json.rows.length).toBeGreaterThan(0);

    // Flattened fields check
    const p1 = json.rows[0];
    expect(json.top1_driver).toBe(p1.driver);
    expect(json.top1_name).toBe(p1.name);
    expect(json.top1_points).toBe(p1.points);
  });

  test("GET /api/feed/status returns status rows and flattened top fields", async () => {
    const app = createApp({ dbPath: REAL_DB_PATH, ttfDbPath: TEMP_TTF_DB });
    const res = await app.handle(new Request("http://127.0.0.1:3100/api/feed/status"));
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.rows).toBeArray();
    expect(json.rows.length).toBeGreaterThan(0);

    const p1 = json.rows[0];
    expect(json.top1_driver).toBe(p1.driver);
    expect(json.top1_status).toBe(p1.status);
    expect(json.top1_maxPossible).toBe(p1.maxPossible);
  });

  test("GET /api/feed/path/:driver returns PathResult for active driver and 404 for unknown/inactive driver", async () => {
    const app = createApp({ dbPath: REAL_DB_PATH, ttfDbPath: TEMP_TTF_DB });

    // Active driver NOR
    const resNor = await app.handle(new Request("http://127.0.0.1:3100/api/feed/path/NOR"));
    expect(resNor.status).toBe(200);
    const jsonNor = (await resNor.json()) as any;
    expect(jsonNor.driver).toBe("NOR");
    expect(jsonNor.verdict).toBeTruthy();
    expect(typeof jsonNor.pointsNeeded).toBe("number");

    // Case insensitive driver code (nor)
    const resNorLower = await app.handle(new Request("http://127.0.0.1:3100/api/feed/path/nor"));
    expect(resNorLower.status).toBe(200);

    // Unknown driver XYZ => 404
    const resXyz = await app.handle(new Request("http://127.0.0.1:3100/api/feed/path/XYZ"));
    expect(resXyz.status).toBe(404);

    // Inactive driver TSU => 404
    const resTsu = await app.handle(new Request("http://127.0.0.1:3100/api/feed/path/TSU"));
    expect(resTsu.status).toBe(404);
  });

  test("GET /api/feed/odds returns available: false", async () => {
    const app = createApp({ dbPath: REAL_DB_PATH, ttfDbPath: TEMP_TTF_DB });
    const res = await app.handle(new Request("http://127.0.0.1:3100/api/feed/odds"));
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.available).toBe(false);
  });

  test("GET /api/feed/active-scenario reflects active scenario changes", async () => {
    cleanupTempDb();
    const app = createApp({ dbPath: REAL_DB_PATH, ttfDbPath: TEMP_TTF_DB });

    // Base active scenario (none set)
    const resBase = await app.handle(new Request("http://127.0.0.1:3100/api/feed/active-scenario"));
    expect(resBase.status).toBe(200);
    const jsonBase = (await resBase.json()) as any;
    expect(jsonBase.scenario).toBeNull();
    expect(jsonBase.wdc).toBeArray();
    expect(jsonBase.wcc).toBeArray();

    // Create a scenario locking 17:race with NOR winning P1
    const resPost = await app.handle(
      new Request("http://127.0.0.1:3100/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Norris Win",
          locks: { "17:race": { fixed: { NOR: 1 } } },
        }),
      }),
    );
    expect(resPost.status).toBe(201);
    const scenario = (await resPost.json()) as any;

    // Set active scenario
    await app.handle(
      new Request("http://127.0.0.1:3100/api/active-scenario", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: scenario.id }),
      }),
    );

    // GET /api/feed/active-scenario now shows scenario
    const resActive = await app.handle(new Request("http://127.0.0.1:3100/api/feed/active-scenario"));
    expect(resActive.status).toBe(200);
    const jsonActive = (await resActive.json()) as any;
    expect(jsonActive.scenario).toEqual({ id: scenario.id, name: "Norris Win" });

    // NOR points in projected table increased by 25
    const norRow = jsonActive.wdc.find((r: any) => r.driver === "NOR");
    expect(norRow).toBeTruthy();
    expect(norRow.deltaPoints).toBe(25);
  });
});
