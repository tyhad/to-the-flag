/**
 * API Skeleton tests (Phase 2 Step 1).
 * Tests GET /api/health, GET /api/season, ETag 304, 503 errors on missing or invalid DB.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../api/server";
import { SeasonLoader } from "../api/seasonLoader";
import type { SeasonState } from "../engine/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "season-2026-r16.json");
const REAL_DB_PATH = join(import.meta.dir, "..", "..", "F1GStats", "f1gstats.sqlite");
const TEMP_DB_V1 = join(import.meta.dir, "temp-v1.sqlite");

describe("API Skeleton (Step 1)", () => {
  afterAll(() => {
    if (existsSync(TEMP_DB_V1)) {
      try {
        unlinkSync(TEMP_DB_V1);
      } catch {
        // ignore cleanup error
      }
    }
  });

  describe("GET /api/health", () => {
    test("returns correct health shape on valid database", async () => {
      const app = createApp({ dbPath: REAL_DB_PATH });
      const res = await app.handle(new Request("http://127.0.0.1:3100/api/health"));
      expect(res.status).toBe(200);

      const json = (await res.json()) as any;
      expect(json.ok).toBe(true);
      expect(typeof json.season).toBe("number");
      expect(typeof json.asOfRound).toBe("number");
      expect(["ok", "warn", "fail"]).toContain(json.dataStatus);
      expect(typeof json.checkedAt).toBe("string");
      expect(json.schemaVersion).toBeGreaterThanOrEqual(2);
    });

    test("returns HTTP 503 on missing database file", async () => {
      const app = createApp({ dbPath: "./non-existent-db.sqlite" });
      const res = await app.handle(new Request("http://127.0.0.1:3100/api/health"));
      expect(res.status).toBe(503);

      const json = (await res.json()) as any;
      expect(json.error).toBe("data_file_missing");
      expect(typeof json.message).toBe("string");
      expect(json.message).not.toContain("non-existent-db.sqlite");
    });

    test("returns HTTP 503 on schema version 1 database", async () => {
      if (existsSync(TEMP_DB_V1)) unlinkSync(TEMP_DB_V1);
      const db = new Database(TEMP_DB_V1);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);");
      db.run("INSERT INTO meta VALUES ('schema_version', '1');");
      db.close();

      const app = createApp({ dbPath: TEMP_DB_V1 });
      const res = await app.handle(new Request("http://127.0.0.1:3100/api/health"));
      expect(res.status).toBe(503);

      const json = (await res.json()) as any;
      expect(json.error).toBe("schema_version_invalid");
      expect(typeof json.message).toBe("string");
      expect(json.message).not.toContain(TEMP_DB_V1);
    });
  });

  describe("GET /api/season", () => {
    test("season payload equals fixture / SeasonState and includes ETag", async () => {
      const app = createApp({ dbPath: REAL_DB_PATH });
      const res = await app.handle(new Request("http://127.0.0.1:3100/api/season"));
      expect(res.status).toBe(200);

      const etag = res.headers.get("etag");
      expect(etag).toBeTruthy();

      const body = (await res.json()) as SeasonState;
      if (existsSync(FIXTURE_PATH)) {
        const fixtureData = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeasonState;
        expect(body.season).toBe(fixtureData.season);
        expect(body.asOfRound).toBe(fixtureData.asOfRound);
        expect(body.rounds).toEqual(fixtureData.rounds);
        expect(body.drivers).toEqual(fixtureData.drivers);
      }
    });

    test("returns 304 on matching ETag", async () => {
      const app = createApp({ dbPath: REAL_DB_PATH });
      const res1 = await app.handle(new Request("http://127.0.0.1:3100/api/season"));
      expect(res1.status).toBe(200);
      const etag = res1.headers.get("etag")!;
      expect(etag).toBeTruthy();

      const res2 = await app.handle(
        new Request("http://127.0.0.1:3100/api/season", {
          headers: { "If-None-Match": etag },
        }),
      );
      expect(res2.status).toBe(304);
      expect(res2.headers.get("etag")).toBe(etag);
    });

    test("returns HTTP 503 on missing file and schema version 1", async () => {
      const appMissing = createApp({ dbPath: "./missing.sqlite" });
      const resMissing = await appMissing.handle(new Request("http://127.0.0.1:3100/api/season"));
      expect(resMissing.status).toBe(503);
      const jsonMissing = (await resMissing.json()) as any;
      expect(jsonMissing.error).toBe("data_file_missing");

      const appV1 = createApp({ dbPath: TEMP_DB_V1 });
      const resV1 = await appV1.handle(new Request("http://127.0.0.1:3100/api/season"));
      expect(resV1.status).toBe(503);
      const jsonV1 = (await resV1.json()) as any;
      expect(jsonV1.error).toBe("schema_version_invalid");
    });
  });

  describe("SeasonLoader Caching", () => {
    test("reloads state when file mtime changes", async () => {
      const loader = new SeasonLoader(REAL_DB_PATH);
      const r1 = loader.getSeason();
      expect(r1.ok).toBe(true);

      const r2 = loader.getSeason();
      expect(r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r1.data).toBe(r2.data);
      }
    });
  });
});
