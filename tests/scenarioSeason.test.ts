/**
 * Phase 10, Step 6 (D60): a scenario belongs to the season it was saved in. Its session keys are only round numbers,
 * so one saved in 2026 used to pass the checks of a 2027 calendar and could be loaded as if it were new.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../api/server";
import { buildChips, type SavedScenario } from "../web/viewModel/scenarios";
import { buildDb, cleanupDbs, fixtureSeed } from "./dbHelpers";

const dir = mkdtempSync(join(tmpdir(), "ttf-season-"));
afterAll(() => {
  cleanupDbs();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows file handle cleanup
  }
});

const BASE = "http://127.0.0.1:3100";
const send = async (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => {
  const res = await app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: res.status, body: (await res.json()) as any };
};
const appFor = (season: number, ttfDbPath: string) =>
  createApp({ dbPath: buildDb((s) => Object.assign(s, { ...fixtureSeed(), season })), ttfDbPath, token: null });

describe("a scenario of last season, in the new season", () => {
  const ttf = join(dir, "carry.sqlite");
  const old = appFor(2026, ttf);
  const next = appFor(2027, ttf);
  let id = "";

  test("in its own season it is valid", async () => {
    const created = await send(old, "POST", "/api/scenarios", { name: "Old", locks: { "17:race": { fixed: { NOR: 1 } } }, contenders: ["NOR"] });
    expect(created.status).toBe(201);
    id = created.body.id;
    const list = await send(old, "GET", "/api/scenarios");
    expect(list.body[0]).toMatchObject({ name: "Old", season: 2026, valid: true, stale: false });
  });

  test("in the next season it is kept but not valid (though 17:race exists in both calendars)", async () => {
    const list = await send(next, "GET", "/api/scenarios");
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id, name: "Old", season: 2026, valid: false, stale: true });
    const one = await send(next, "GET", `/api/scenarios/${id}`);
    expect(one.body.valid).toBe(false);
  });

  test("it cannot be shown on the overlay, and a saved overlay choice falls back to the real standings", async () => {
    const put = await send(next, "PUT", "/api/active-scenario", { id });
    // the route accepts only a scenario that exists; the feed must still not use an invalid one
    const feed = await send(next, "GET", "/api/feed/standings");
    expect(feed.status).toBe(200);
    expect(feed.body.scenario ?? null).toBeNull();
    expect([200, 404]).toContain(put.status);
  });

  test("it can be renamed and deleted", async () => {
    const renamed = await send(next, "PUT", `/api/scenarios/${id}`, { name: "Old (2026)" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Old (2026)");
    const del = await send(next, "DELETE", `/api/scenarios/${id}`);
    expect(del.status).toBe(200);
    expect((await send(next, "GET", "/api/scenarios")).body).toEqual([]);
  });

  test("the export of the new season leaves it out", async () => {
    await send(old, "POST", "/api/scenarios", { name: "Again", locks: { "17:race": { fixed: { NOR: 1 } } } });
    const exported = await send(next, "GET", "/api/scenarios/export");
    expect(exported.body.scenarios).toEqual([]);
  });

  test("importing it into the new season is skipped with the season as the reason", async () => {
    const file = {
      format: "to-the-flag-scenarios",
      version: 1,
      scenarios: [{ name: "From 2026", season: 2026, asOfRound: 16, locks: { "17:race": { fixed: { NOR: 1 } } } }],
    };
    const res = await send(next, "POST", "/api/scenarios/import", file);
    expect(res.body.imported).toBe(0);
    expect(res.body.skippedItems[0].reason).toContain("season 2026");
  });
});

describe("the chip says why", () => {
  const saved = {
    id: "a",
    name: "Old",
    season: 2026,
    asOfRound: 16,
    locks: {},
    valid: false,
    stale: true,
    createdAt: "",
    updatedAt: "",
  } as unknown as SavedScenario;

  test("another season: names both seasons and says it can be renamed or deleted", () => {
    const chip = buildChips(3, [saved], null, null, false, 2027)[1]!;
    expect(chip.valid).toBe(false);
    expect(chip.note).toContain("season 2026");
    expect(chip.note).toContain("season 2027");
    expect(chip.note).toContain("rename or delete");
  });

  test("the same season keeps the older notes", () => {
    const chip = buildChips(16, [{ ...saved, season: 2027 }], null, null, false, 2027)[1]!;
    expect(chip.note).toContain("no longer fits the current data");
  });
});
