import { describe, expect, test } from "bun:test";
import * as engine from "../engine";

describe("engine public API (engine/index.ts)", () => {
  test("exports the functions Phase 2 will call", () => {
    for (const name of [
      "gpPoints", "sprintPoints", "sessionMaxPoints", "teamSessionMaxPoints", "zoneSize",
      "compareStanding", "addPosition", "emptyCounts",
      "validateScenario", "InvalidScenarioError",
      "sessionKey", "parseSessionKey", "remainingSessions", "activeDrivers",
      "computeDriverStandings", "computeConstructorStandings",
      "driverStatus", "witnessScenario",
      "solveWdc", "paceLimit",
    ] as const) {
      expect(typeof engine[name]).toBe("function");
    }
  });

  test("exports the data tables", () => {
    expect(engine.GP_POINTS.full[0]).toBe(25);
    expect(engine.SPRINT_POINTS[0]).toBe(8);
    expect(engine.DEFAULT_COUNTBACK.includeSprint).toBe(false);
  });

  test("the exported pieces work together from one import", () => {
    const state: engine.SeasonState = {
      season: 2026, asOfRound: 1,
      rounds: [
        { round: 1, name: "One", hasSprint: false, status: "completed" },
        { round: 2, name: "Two", hasSprint: false, status: "scheduled" },
      ],
      results: [
        { round: 1, kind: "race", driver: "AAA", team: "t", position: 1, points: 25 },
        { round: 1, kind: "race", driver: "BBB", team: "t", position: 2, points: 18 },
      ],
      qualifying: [],
      drivers: [{ code: "AAA", name: "A", active: true }, { code: "BBB", name: "B", active: true }],
      teams: [{ id: "t", name: "T" }],
      health: { status: "ok", checkedAt: "x" },
    };
    expect(engine.remainingSessions(state)).toEqual(["2:race"]);
    expect(engine.computeDriverStandings(state).map((r) => r.id)).toEqual(["AAA", "BBB"]);
    expect(engine.driverStatus(state).map((r) => r.status)).toEqual(["alive", "alive"]);
    expect(engine.solveWdc(state, "BBB").verdict).toBe("alive");
  });
});
