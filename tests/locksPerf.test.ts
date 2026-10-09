/** Phase 2 Step 6: the table must react at once. Loose bound (100 ms) so a slow CI machine does not flake. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeConstructorStandings,
  computeDriverStandings,
  driverStatus,
  remainingSessions,
  type Scenario,
  type SeasonState,
} from "../engine";
import { applyLockAction } from "../web/viewModel/locks";
import { buildTowerRows } from "../web/viewModel/tower";

const REAL = join(import.meta.dir, "fixtures", "season-2026-r16.json");
const BOUND_MS = 100;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function timeMs(fn: () => void, runs = 9): number {
  fn(); // warm up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return median(times);
}

describe.skipIf(!existsSync(REAL))("performance with every remaining session locked (real Round 16 snapshot)", () => {
  const state = JSON.parse(readFileSync(REAL, "utf8")) as SeasonState;
  const keys = remainingSessions(state);
  const podium = ["ANT", "RUS", "HAM", "LEC", "NOR", "VER", "PIA", "HAD", "LAW", "GAS"];

  /** Lock all sessions through the same action code the UI uses, filling every points slot. */
  function lockEverything(): Scenario {
    let scenario: Scenario = { locks: {} };
    for (const key of keys) {
      scenario = applyLockAction(state, scenario, { type: "lock", key }, { assignable: null }).scenario;
      const slots = key.endsWith("sprint") ? 8 : 10;
      for (let i = 0; i < slots; i++) {
        const driver = podium[(i + keys.indexOf(key)) % podium.length]!;
        const r = applyLockAction(state, scenario, { type: "assign", key, driver, position: i + 1 }, { assignable: null });
        expect(r.error).toBeNull();
        scenario = r.scenario;
      }
    }
    return scenario;
  }

  test("there are eight sessions to lock", () => {
    expect(keys).toHaveLength(8);
  });

  test("standings plus status for every driver finish in under 100 ms", () => {
    const scenario = lockEverything();
    expect(Object.keys(scenario.locks)).toHaveLength(8);
    const ms = timeMs(() => {
      computeDriverStandings(state, scenario);
      driverStatus(state, scenario);
    });
    expect(ms).toBeLessThan(BOUND_MS);
  });

  test("the full tower rows, drivers and constructors, finish in under 100 ms", () => {
    const scenario = lockEverything();
    const ms = timeMs(() => {
      buildTowerRows(state, scenario, "wdc");
      buildTowerRows(state, scenario, "wcc");
    });
    expect(ms).toBeLessThan(BOUND_MS);
    // computeConstructorStandings is part of the WCC rows above; make sure it still works on its own.
    expect(computeConstructorStandings(state, scenario).length).toBeGreaterThan(0);
  });
});
