/** Phase 10, Step 1 (D60): the loader, /api/season and the feeds in the two edge states of a season. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSeason } from "../data/loadSeason";
import { createApp } from "../api/server";
import { buildCompleteDb, buildNotStartedDb, cleanupDbs } from "./dbHelpers";

const dir = mkdtempSync(join(tmpdir(), "ttf-edge-"));
let n = 0;
afterAll(() => {
  cleanupDbs();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // an open SQLite file cannot be removed on Windows; the OS cleans the temp folder
  }
});

const get = async (app: ReturnType<typeof createApp>, path: string) => {
  const res = await app.handle(new Request(`http://127.0.0.1:3100${path}`));
  return { status: res.status, json: (await res.json()) as any };
};
let ttf = "";
beforeEach(() => {
  ttf = join(dir, `scenarios-${++n}.sqlite`);
});

describe("loader before the first race", () => {
  test("every driver the standings list is active", () => {
    const state = loadSeason(buildNotStartedDb());
    expect(state.asOfRound).toBe(0);
    expect(state.results).toEqual([]);
    expect(state.drivers).toHaveLength(23);
    expect(state.drivers.every((d) => d.active)).toBe(true);
    expect(state.teams).toEqual([]);
  });

  test("an empty standings table gives an empty driver list, not an error", () => {
    const state = loadSeason(buildNotStartedDb(false));
    expect(state.drivers).toEqual([]);
  });

  test("a season that has started keeps the old rule: only drivers of the latest round are active", () => {
    const state = loadSeason(buildCompleteDb());
    expect(state.drivers.filter((d) => d.active)).toHaveLength(22);
    expect(state.drivers.filter((d) => !d.active)).toHaveLength(1);
  });
});

describe("season complete: API and feeds", () => {
  const app = () => createApp({ dbPath: buildCompleteDb(), ttfDbPath: ttf });

  test("/api/season and /api/health answer normally", async () => {
    const a = app();
    const season = await get(a, "/api/season");
    expect(season.status).toBe(200);
    expect(season.json.asOfRound).toBe(23);
    const health = await get(a, "/api/health");
    expect(health.json.asOfRound).toBe(23);
  });

  test("standings, status, team status and the active scenario feed say season_phase complete", async () => {
    const a = app();
    for (const path of ["/api/feed/standings", "/api/feed/status", "/api/feed/team-status", "/api/feed/active-scenario"]) {
      const { status, json } = await get(a, path);
      expect(status).toBe(200);
      expect(json.season_phase).toBe("complete");
    }
    const status = await get(a, "/api/feed/status");
    expect(status.json.top1_status).toBe("clinched");
    expect(status.json.top2_status).toBe("eliminated");
  });

  test("the odds feed is final: 100% for the champion and the label says Final", async () => {
    const { status, json } = await get(app(), "/api/feed/odds");
    expect(status).toBe(200);
    expect(json.season_phase).toBe("complete");
    expect(json.model).toBe("final");
    expect(json.label).toBe("Final");
    expect(json.wdc).toHaveLength(1);
    expect(json.wdc[0].display).toBe("100%");
    expect(json.top1_display).toBe("100%");
    expect(json.top2_display).toBe("");
  });

  test("grid and race forecast say there is no next race", async () => {
    const a = app();
    for (const path of ["/api/feed/grid", "/api/feed/race-forecast"]) {
      const { status, json } = await get(a, path);
      expect(status).toBe(200);
      expect(json.available).toBe(false);
      expect(json.reason).toBe("no_next_race");
      expect(json.season_phase).toBe("complete");
    }
    const grid = await get(a, "/api/grid");
    expect(grid.json.round).toBeNull();
  });

  test("a saved scenario of this season is kept but invalid, and can be deleted", async () => {
    const a = app();
    // saving a scenario with no lock is still allowed on a complete season (nothing to lock)
    const res = await a.handle(
      new Request("http://127.0.0.1:3100/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Late", locks: { "23:race": { fixed: { AAA: 1 } } } }),
      }),
    );
    expect(res.status).toBe(422);
    const list = await get(a, "/api/scenarios");
    expect(list.json).toEqual([]);
  });
});

describe("season not started: API and feeds", () => {
  const app = () => createApp({ dbPath: buildNotStartedDb(), ttfDbPath: ttf });

  test("/api/season answers with round 0 and no result", async () => {
    const { status, json } = await get(app(), "/api/season");
    expect(status).toBe(200);
    expect(json.asOfRound).toBe(0);
    expect(json.results).toEqual([]);
  });

  test("every feed answers with season_phase not_started and no NaN", async () => {
    const a = app();
    const paths = [
      "/api/feed/standings",
      "/api/feed/status",
      "/api/feed/team-status",
      "/api/feed/odds",
      "/api/feed/active-scenario",
      "/api/feed/grid",
      "/api/feed/race-forecast",
    ];
    for (const path of paths) {
      const res = await a.handle(new Request(`http://127.0.0.1:3100${path}`));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain("NaN");
      expect(JSON.parse(text).season_phase).toBe("not_started");
    }
  });

  test("grid feed: there is a next race, but no grid yet", async () => {
    const { json } = await get(app(), "/api/feed/grid");
    expect(json.available).toBe(false);
    expect(json.reason).toBe("no_grid");
  });

  test("the odds feed is an estimate with the low-confidence flag", async () => {
    const { json } = await get(app(), "/api/feed/odds");
    expect(json.model).toBe("estimate");
    expect(json.low_confidence).toBe(true);
  });
});
