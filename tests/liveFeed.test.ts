import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../api/server";
import { buildDb, cleanupDbs } from "./dbHelpers";

describe("api/routes/live (Live As It Stands WDC/WCC)", () => {
  const ttfDir = mkdtempSync(join(tmpdir(), "ttf-live-test-"));
  let seq = 0;

  afterAll(() => {
    cleanupDbs();
    try {
      rmSync(ttfDir, { recursive: true, force: true });
    } catch {
      // Windows may keep SQLite handle open until process exit
    }
  });

  function setup(token?: string) {
    const dbPath = buildDb();
    const ttfDbPath = join(ttfDir, `ttf-live-${++seq}.sqlite`);
    const app = createApp({ dbPath, ttfDbPath, token: token ?? null });
    return { app };
  }

  test("computes baseline when fixed is empty and applies full Race + shortened tier + Sprint live locks", async () => {
    const { app } = setup();

    // Baseline (no fixed positions)
    const baseRes = await app.handle(
      new Request("http://127.0.0.1:3100/api/live/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "race", fixed: {} }),
      }),
    );
    expect(baseRes.status).toBe(200);
    const base = await baseRes.json();
    expect(base.liveApplied).toBe(false);
    expect(base.wdc[0].driver).toBe("AAA");
    expect(base.wdc[0].points).toBe(57);
    expect(base.wdc[0].deltaPoints).toBe(0);

    // Live Race R3: BBB P1 (+25 -> 66), CCC P2 (+18 -> 57), AAA out (+0 -> 57)
    const liveRes = await app.handle(
      new Request("http://127.0.0.1:3100/api/live/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "race",
          tier: "full",
          lap: 35,
          totalLaps: 57,
          sessionName: "GP Three",
          fixed: { BBB: 1, CCC: 2, AAA: "out", UNKNOWN_DRV: 3 },
        }),
      }),
    );
    expect(liveRes.status).toBe(200);
    const live = await liveRes.json();
    expect(live.liveApplied).toBe(true);
    expect(live.sessionKey).toBe("3:race");
    expect(live.wdc[0].driver).toBe("BBB");
    expect(live.wdc[0].points).toBe(66);
    expect(live.wdc[0].deltaPoints).toBe(25);
    expect(live.wdc[0].deltaRank).toBe(1);
    expect(live.titleSummary.leader).toBe("BBB");
    expect(live.titleSummary.gap).toBe(9);

    // Shortened race tier (lt25: P1 = +6)
    const shortRes = await app.handle(
      new Request("http://127.0.0.1:3100/api/live/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "race", tier: "lt25", fixed: { BBB: 1 } }),
      }),
    );
    const shortData = await shortRes.json();
    const bbbShort = shortData.wdc.find((r: any) => r.driver === "BBB");
    expect(bbbShort.deltaPoints).toBe(6);

    // Sprint (R4 has sprint: P1 = +8)
    const sprintRes = await app.handle(
      new Request("http://127.0.0.1:3100/api/live/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "sprint", fixed: { CCC: 1 } }),
      }),
    );
    const sprintData = await sprintRes.json();
    expect(sprintData.sessionKey).toBe("4:sprint");
    expect(sprintData.wdc.find((r: any) => r.driver === "CCC").deltaPoints).toBe(8);
  });

  test("manages in-memory /api/live/state lifecycle without writing scenarios to SQLite and obeys writeGuard", async () => {
    const token = "ttf-live-secret-token-2026";
    const { app } = setup(token);

    // GET /api/live/state is open and initially inactive
    const initGet = await app.handle(new Request("http://127.0.0.1:3100/api/live/state"));
    expect(initGet.status).toBe(200);
    expect((await initGet.json()).active).toBe(false);

    // POST without token is rejected
    const unauth = await app.handle(
      new Request("http://127.0.0.1:3100/api/live/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "race", fixed: { BBB: 1 } }),
      }),
    );
    expect(unauth.status).toBe(401);

    // POST with Bearer token updates in-memory state
    const postOk = await app.handle(
      new Request("http://127.0.0.1:3100/api/live/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ kind: "race", lap: 20, totalLaps: 57, fixed: { BBB: 1, AAA: 2 } }),
      }),
    );
    expect(postOk.status).toBe(200);

    const activeGet = await app.handle(new Request("http://127.0.0.1:3100/api/live/state"));
    const activeData = await activeGet.json();
    expect(activeData.active).toBe(true);
    expect(activeData.snapshot.lap).toBe(20);
    expect(activeData.snapshot.scenario.locks["3:race"].fixed.BBB).toBe(1);

    // Saved scenarios in SQLite remain completely untouched (0 scenarios)
    const scenariosRes = await app.handle(new Request("http://127.0.0.1:3100/api/scenarios"));
    expect(await scenariosRes.json()).toEqual([]);

    // DELETE clears live state
    const delRes = await app.handle(
      new Request("http://127.0.0.1:3100/api/live/state", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(delRes.status).toBe(200);
    const afterDel = await (await app.handle(new Request("http://127.0.0.1:3100/api/live/state"))).json();
    expect(afterDel.active).toBe(false);
    expect(afterDel.snapshot).toBeNull();
  });
});
