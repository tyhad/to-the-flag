import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DataInconsistentError,
  SchemaVersionError,
  loadSeason,
} from "../data/loadSeason";
import { remainingSessions } from "../engine/sessions";
import { buildDb, cleanupDbs, sessionRows } from "./dbHelpers";

afterAll(cleanupDbs);

describe("loadSeason: happy path", () => {
  const state = loadSeason(buildDb());

  test("season, as-of round and calendar", () => {
    expect(state.season).toBe(2026);
    expect(state.asOfRound).toBe(2);
    expect(state.rounds).toEqual([
      { round: 1, name: "GP One", hasSprint: false, status: "completed" },
      { round: 2, name: "GP Two", hasSprint: true, status: "completed" },
      { round: 3, name: "GP Three", hasSprint: false, status: "scheduled" },
      { round: 4, name: "GP Four", hasSprint: true, status: "scheduled" },
    ]);
  });

  test("results use driver_abbr and constructor_id", () => {
    expect(state.results).toHaveLength(10);
    expect(state.results[0]).toEqual({
      round: 1, kind: "race", driver: "AAA", team: "alpha", position: 1, grid: 1, points: 25, classified: true,
    });
    expect(state.results.filter((r) => r.kind === "sprint")).toHaveLength(3);
    expect(state.results.reduce((a, r) => a + r.points, 0)).toBe(149);
  });

  test("pit-lane start (grid 0 in DB) maps to the session field size", () => {
    const path = buildDb((seed) => {
      const aaa = seed.results.find((r) => r.round === 1 && r.session === "Race" && r.abbr === "AAA");
      if (aaa) aaa.grid = 0;
    });
    const loaded = loadSeason(path);
    const aaa = loaded.results.find((r) => r.round === 1 && r.kind === "race" && r.driver === "AAA");
    expect(aaa?.grid).toBe(4);
  });

  test("every result is classified unless the database says otherwise", () => {
    expect(state.results.every((r) => r.classified)).toBe(true);
  });

  test("qualifying skips rows without a position", () => {
    expect(state.qualifying).toHaveLength(6);
    expect(state.qualifying.some((q) => q.round === 2 && q.driver === "CCC")).toBe(false);
  });

  test("drivers: active = in the latest completed round (decision a)", () => {
    expect(state.drivers).toEqual([
      { code: "AAA", name: "Driver AAA", active: true },
      { code: "BBB", name: "Driver BBB", active: true },
      { code: "CCC", name: "Driver CCC", active: true },
      { code: "DDD", name: "Driver DDD", active: false },
    ]);
  });

  test("teams come from constructor_id", () => {
    expect(state.teams).toEqual([
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "Beta" },
    ]);
  });

  test("health is the latest data_health row", () => {
    expect(state.health).toEqual({ status: "ok", checkedAt: "2026-03-08T10:00:00Z" });
  });

  test("remaining sessions (decision e)", () => {
    expect(remainingSessions(state)).toEqual(["3:race", "4:sprint", "4:race"]);
  });

  test("never writes to the database file", () => {
    const path = buildDb();
    const before = readFileSync(path);
    loadSeason(path);
    expect(Buffer.compare(before, readFileSync(path))).toBe(0);
  });
});

describe("loadSeason: decisions", () => {
  test("weekend in progress: a sprint result in a scheduled round is not remaining", () => {
    const path = buildDb((seed) => {
      const r3 = seed.schedule.find((s) => s.round === 3);
      if (r3) r3.hasSprint = true;
      seed.results.push(...sessionRows(3, "Sprint", [["AAA", "alpha"], ["BBB", "alpha"]]));
    });
    const state = loadSeason(path);
    expect(state.asOfRound).toBe(2);
    expect(remainingSessions(state)).toEqual(["3:race", "4:sprint", "4:race"]);
  });

  test("a mid-season team change follows constructor_id (decision d)", () => {
    const path = buildDb((seed) => {
      for (const r of seed.results) {
        if (r.abbr === "CCC" && r.round === 2) {
          r.constructorId = "alpha";
          r.teamName = "Alpha";
        }
      }
    });
    const state = loadSeason(path);
    const teamsOfCcc = state.results.filter((r) => r.driver === "CCC").map((r) => `${r.round}:${r.team}`);
    expect(teamsOfCcc).toEqual(["1:beta", "2:alpha", "2:alpha"]);
  });

  test("is_classified = 0 becomes classified = false, only on that row", () => {
    const path = buildDb((seed) => {
      // R1 race, driver DDD (P4) retired; it scored 0 either way
      const ddd = seed.results.find((r) => r.round === 1 && r.session === "Race" && r.abbr === "DDD");
      if (ddd) ddd.classified = false;
    });
    const state = loadSeason(path);
    const dnfs = state.results.filter((r) => !r.classified);
    expect(dnfs).toHaveLength(1);
    expect(dnfs[0]).toMatchObject({ round: 1, kind: "race", driver: "DDD", classified: false });
    expect(state.results).toHaveLength(10);
  });

  test("a missing qualifying table means no qualifying rows", () => {
    const state = loadSeason(buildDb((seed) => (seed.qualifying = null)));
    expect(state.qualifying).toEqual([]);
  });

  test("half points are accepted", () => {
    const path = buildDb((seed) => {
      const r = seed.results[0];
      if (r) r.points = 12.5;
      const second = seed.results[1];
      if (second) second.points = 12.5;
    });
    expect(() => loadSeason(path)).not.toThrow();
  });
});

describe("loadSeason: refuses bad input", () => {
  test("schema_version 1 -> SchemaVersionError", () => {
    expect(() => loadSeason(buildDb((s) => (s.schemaVersion = 1)))).toThrow(SchemaVersionError);
  });

  test("no schema_version key -> SchemaVersionError", () => {
    expect(() => loadSeason(buildDb((s) => (s.schemaVersion = null)))).toThrow(SchemaVersionError);
  });

  test("schema_version 3 is accepted (>= 2)", () => {
    expect(() => loadSeason(buildDb((s) => (s.schemaVersion = 3)))).not.toThrow();
  });

  test("missing file gives a helpful error", () => {
    expect(() => loadSeason("/nonexistent/f1gstats.sqlite")).toThrow(/not found/);
  });

  test("standings differ from race_results -> DataInconsistentError (decision c)", () => {
    const path = buildDb((seed) => {
      seed.standings = [
        { abbr: "AAA", name: "Driver AAA", points: 58 },
        { abbr: "BBB", name: "Driver BBB", points: 41 },
        { abbr: "CCC", name: "Driver CCC", points: 39 },
        { abbr: "DDD", name: "Driver DDD", points: 12 },
      ];
    });
    expect(() => loadSeason(path)).toThrow(DataInconsistentError);
    expect(() => loadSeason(path)).toThrow(/AAA/);
  });

  test("a driver in results but not in standings with points -> DataInconsistentError", () => {
    const path = buildDb((seed) => {
      seed.standings = [
        { abbr: "AAA", name: "Driver AAA", points: 57 },
        { abbr: "BBB", name: "Driver BBB", points: 41 },
        { abbr: "CCC", name: "Driver CCC", points: 39 },
      ];
    });
    expect(() => loadSeason(path)).toThrow(DataInconsistentError);
  });

  test("completed round without a sprint result -> DataInconsistentError (decision e)", () => {
    const path = buildDb((seed) => {
      seed.results = seed.results.filter((r) => !(r.round === 2 && r.session === "Sprint"));
    });
    expect(() => loadSeason(path)).toThrow(DataInconsistentError);
    expect(() => loadSeason(path)).toThrow(/2:sprint/);
  });

  test("completed round without a race result -> DataInconsistentError", () => {
    const path = buildDb((seed) => {
      seed.results = seed.results.filter((r) => !(r.round === 1 && r.session === "Race"));
    });
    expect(() => loadSeason(path)).toThrow(DataInconsistentError);
    expect(() => loadSeason(path)).toThrow(/1:race/);
  });

  test("result row with null position -> DataInconsistentError", () => {
    const path = buildDb((seed) => {
      const r = seed.results[0];
      if (r) r.position = null;
    });
    expect(() => loadSeason(path)).toThrow(DataInconsistentError);
  });

  test("result row with null constructor_id -> DataInconsistentError", () => {
    const path = buildDb((seed) => {
      const r = seed.results[0];
      if (r) r.constructorId = null;
    });
    expect(() => loadSeason(path)).toThrow(DataInconsistentError);
  });

  test("result row with null grid -> DataInconsistentError", () => {
    const path = buildDb((seed) => {
      const r = seed.results[0];
      if (r) r.grid = null;
    });
    expect(() => loadSeason(path)).toThrow(DataInconsistentError);
    expect(() => loadSeason(path)).toThrow(/grid is null/);
  });

  test("results for a round that is not in the schedule -> DataInconsistentError", () => {
    const path = buildDb((seed) => {
      seed.results.push(...sessionRows(9, "Race", [["AAA", "alpha"]]));
    });
    expect(() => loadSeason(path)).toThrow(DataInconsistentError);
  });

  test("no data_health row -> DataInconsistentError", () => {
    expect(() => loadSeason(buildDb((s) => (s.health = [])))).toThrow(DataInconsistentError);
  });

  test("error classes carry their names", () => {
    expect(new SchemaVersionError(1).name).toBe("SchemaVersionError");
    expect(new DataInconsistentError("x").name).toBe("DataInconsistentError");
  });
});

// ---------- the grid of the next race (Phase 4, Step 8) ----------

describe("loadSeason: upcomingGrid", () => {
  const grid = (round: number, order: string[], source: string | null = "qualifying") =>
    order.map((abbr, i) => ({ round, abbr, position: i + 1, source }));

  test("no starting_grid table: no upcomingGrid", () => {
    expect(loadSeason(buildDb()).upcomingGrid).toBeUndefined();
  });

  test("the grid of the next scheduled round is read with its source", () => {
    const state = loadSeason(buildDb((seed) => (seed.startingGrid = grid(3, ["CCC", "AAA", "BBB"]))));
    expect(state.upcomingGrid).toEqual({ round: 3, grid: { CCC: 1, AAA: 2, BBB: 3 }, source: "qualifying" });
  });

  test("rows of other rounds are ignored, whatever their round_relation says", () => {
    const state = loadSeason(
      buildDb((seed) => {
        seed.startingGrid = [
          ...grid(2, ["AAA", "BBB", "CCC"]).map((g) => ({ ...g, relation: "previous" })),
          ...grid(3, ["BBB", "CCC", "AAA"]).map((g) => ({ ...g, relation: "now" })),
          ...grid(4, ["AAA", "CCC", "BBB"]),
        ];
      }),
    );
    expect(state.upcomingGrid?.round).toBe(3);
    expect(state.upcomingGrid?.grid).toEqual({ BBB: 1, CCC: 2, AAA: 3 });
  });

  test("only rows for rounds that are not the next one: no upcomingGrid", () => {
    const state = loadSeason(buildDb((seed) => (seed.startingGrid = [...grid(2, ["AAA", "BBB"]), ...grid(4, ["AAA", "BBB"])])));
    expect(state.upcomingGrid).toBeUndefined();
  });

  test("a finished season (nothing scheduled): no upcomingGrid", () => {
    const state = loadSeason(
      buildDb((seed) => {
        seed.schedule = seed.schedule.map((r) => ({ ...r, status: "completed" }));
        seed.results.push(...sessionRows(3, "Race", [["AAA", "alpha"], ["BBB", "alpha"], ["CCC", "beta"]]));
        seed.results.push(...sessionRows(4, "Sprint", [["AAA", "alpha"], ["BBB", "alpha"], ["CCC", "beta"]]));
        seed.results.push(...sessionRows(4, "Race", [["AAA", "alpha"], ["BBB", "alpha"], ["CCC", "beta"]]));
        seed.startingGrid = grid(4, ["AAA", "BBB", "CCC"]);
      }),
    );
    expect(state.upcomingGrid).toBeUndefined();
  });

  test("a pit-lane start (position 0) maps to the field size; rows with no position are dropped", () => {
    const state = loadSeason(
      buildDb((seed) => {
        seed.startingGrid = [
          { round: 3, abbr: "AAA", position: 1, source: "qualifying" },
          { round: 3, abbr: "BBB", position: 0, source: "qualifying" },
          { round: 3, abbr: "CCC", position: 2, source: "qualifying" },
          { round: 3, abbr: "DDD", position: null, source: "qualifying" },
        ];
      }),
    );
    expect(state.upcomingGrid?.grid).toEqual({ AAA: 1, BBB: 3, CCC: 2 });
  });

  test("a missing source is 'unknown'; several sources are listed once each, sorted", () => {
    const missing = loadSeason(buildDb((seed) => (seed.startingGrid = grid(3, ["AAA", "BBB"], null))));
    expect(missing.upcomingGrid?.source).toBe("unknown");
    const mixed = loadSeason(
      buildDb((seed) => {
        seed.startingGrid = [
          { round: 3, abbr: "AAA", position: 1, source: "qualifying" },
          { round: 3, abbr: "BBB", position: 2, source: "projected" },
          { round: 3, abbr: "CCC", position: 3, source: "qualifying" },
        ];
      }),
    );
    expect(mixed.upcomingGrid?.source).toBe("projected, qualifying");
  });

  test("a grid that cannot be trusted is left out instead of breaking the season: one driver, or the same driver twice", () => {
    expect(loadSeason(buildDb((seed) => (seed.startingGrid = grid(3, ["AAA"])))).upcomingGrid).toBeUndefined();
    const twice = loadSeason(
      buildDb((seed) => {
        seed.startingGrid = [...grid(3, ["AAA", "BBB"]), { round: 3, abbr: "AAA", position: 3, source: "qualifying" }];
      }),
    );
    expect(twice.upcomingGrid).toBeUndefined();
  });

  test("the rest of the season is the same with or without the grid", () => {
    const withGrid = loadSeason(buildDb((seed) => (seed.startingGrid = grid(3, ["AAA", "BBB", "CCC"]))));
    const { upcomingGrid: _ignored, ...rest } = withGrid;
    const { upcomingGrid: _none, ...plain } = loadSeason(buildDb());
    expect(rest).toEqual(plain);
  });
});
