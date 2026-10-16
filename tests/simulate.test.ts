import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InvalidScenarioError } from "../engine/scenario";
import {
  defaultOddsParams,
  deriveSeed,
  simulateSeason,
  type OddsParams,
  type SimulationResult,
} from "../engine/simulate";
import { computeConstructorStandings, computeDriverStandings } from "../engine/standings";
import { driverStatus } from "../engine/status";
import type { Scenario, SeasonState, SessionKey } from "../engine/types";
import { makeState } from "./helpers";

// ---------- helpers ----------

const teams4 = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
const order4 = ["AAA", "BBB", "CCC", "DDD"];
const races = (rounds: number[], order: string[] = order4) =>
  Object.fromEntries(rounds.map((r) => [`${r}:race`, order])) as Record<SessionKey, string[]>;
/** Quick runs: no strength noise from retirements unless a test asks for it. */
const quick = (extra: Partial<OddsParams> = {}): Partial<OddsParams> => ({ nSims: 2000, seed: 1, includeDnf: false, ...extra });
const share = (res: SimulationResult, driver: string) => (res.driverWins[driver] ?? 0) / res.nSims;
const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);
const gain = (res: SimulationResult, driver: string, base: number) => (res.driverPointSums[driver] ?? 0) / res.nSims - base;

// ---------- basics ----------

describe("simulateSeason: basics", () => {
  const state = makeState({ rounds: 6, completed: 3, teams: teams4, results: races([1, 2, 3]) });

  test("the same seed gives identical results; another seed gives different ones", () => {
    const a = simulateSeason(state, undefined, quick({ seed: 7 }));
    const b = simulateSeason(state, undefined, quick({ seed: 7 }));
    const c = simulateSeason(state, undefined, quick({ seed: 8 }));
    expect(a).toEqual(b);
    expect(a.driverPointSums).not.toEqual(c.driverPointSums);
  });

  test("win counts sum to nSims for drivers and for teams", () => {
    const res = simulateSeason(state, undefined, quick({ nSims: 3000, includeDnf: true }));
    expect(sum(Object.values(res.driverWins))).toBe(3000);
    expect(sum(Object.values(res.teamWins))).toBe(3000);
    expect(Object.keys(res.driverWins).sort()).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    expect(Object.keys(res.teamWins).sort()).toEqual(["blue", "red"]);
  });

  test("the result reports the resolved parameters and seed", () => {
    const res = simulateSeason(state, undefined, { nSims: 50, seed: 99 });
    expect(res.nSims).toBe(50);
    expect(res.seed).toBe(99);
    expect(res.params).toEqual({ ...defaultOddsParams, nSims: 50, seed: 99 });
  });

  test("the default parameters are the documented ones", () => {
    expect(defaultOddsParams).toEqual({
      nSims: 10_000,
      formWeight: 1,
      recencyHalfLife: 8, // v2: hl=8 is best on training seasons with paceStages=5 (Step 6 D30 protocol)
      sprintWeight: 0.5,
      priorStrength: 1, // v2: weaker prior OK now that early-season D30 check passes with top-5 stages
      strengthSigma: 0.25,
      dnfPriorSessions: 4,
      sprintDnfFactor: 0.5,
      includeDnf: true,
      paceStages: 5, // v2: top-5 pace stages, the largest structural gain (Step 6)
      gridWeight: 1, // Step 7: adopted by the D30 protocol (0 ignores the grid, the v2 behavior)
      qualifyingNoise: 2, // Step 8: estimated on 2022-2024 (0 simulates no grid for later races)
    });
  });

  test("a state and scenario are not changed", () => {
    const scenario: Scenario = { locks: { "4:race": { fixed: { AAA: 1 } } } };
    const before = JSON.stringify([state, scenario]);
    simulateSeason(state, scenario, quick());
    expect(JSON.stringify([state, scenario])).toBe(before);
  });

  test("an invalid scenario is refused like everywhere else", () => {
    expect(() => simulateSeason(state, { locks: { "1:race": { fixed: { AAA: 1 } } } }, quick())).toThrow(InvalidScenarioError);
    expect(() => simulateSeason(state, { locks: { "4:race": { fixed: { ZZZ: 1 } } } }, quick())).toThrow(InvalidScenarioError);
  });

  test("nonsense parameters are refused", () => {
    for (const bad of [
      { nSims: 0 },
      { nSims: 1.5 },
      { formWeight: 1.5 },
      { formWeight: -0.1 },
      { strengthSigma: -1 },
      { sprintDnfFactor: -1 },
      { paceStages: -1 },
      { paceStages: 1.5 },
    ]) {
      expect(() => simulateSeason(state, undefined, bad)).toThrow(RangeError);
    }
  });
});

// ---------- the seed ----------

describe("deriveSeed", () => {
  const state = makeState({ rounds: 6, completed: 3, teams: teams4, results: races([1, 2, 3]) });
  const scenario: Scenario = { locks: { "4:race": { fixed: { AAA: 1, BBB: 2 } }, "5:race": { fixed: { CCC: 1 } } } };

  test("is stable for the same inputs and is a 32-bit unsigned integer", () => {
    const s = deriveSeed(state, scenario, defaultOddsParams);
    expect(deriveSeed(state, scenario, defaultOddsParams)).toBe(s);
    expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
  });

  test("does not depend on the order of keys inside the scenario", () => {
    const shuffled: Scenario = { locks: { "5:race": { fixed: { CCC: 1 } }, "4:race": { fixed: { BBB: 2, AAA: 1 } } } };
    expect(deriveSeed(state, shuffled, defaultOddsParams)).toBe(deriveSeed(state, scenario, defaultOddsParams));
  });

  test("no scenario and an empty scenario are the same", () => {
    expect(deriveSeed(state, undefined, defaultOddsParams)).toBe(deriveSeed(state, { locks: {} }, defaultOddsParams));
  });

  test("changes with the season, the round, the scenario and the model parameters", () => {
    const base = deriveSeed(state, scenario, defaultOddsParams);
    expect(deriveSeed({ ...state, season: 2027 }, scenario, defaultOddsParams)).not.toBe(base);
    expect(deriveSeed({ ...state, asOfRound: 4 }, scenario, defaultOddsParams)).not.toBe(base);
    expect(deriveSeed(state, undefined, defaultOddsParams)).not.toBe(base);
    expect(deriveSeed(state, scenario, { ...defaultOddsParams, formWeight: 0.5 })).not.toBe(base);
    expect(deriveSeed(state, scenario, { ...defaultOddsParams, nSims: 500 })).not.toBe(base);
  });

  test("an explicit seed in the parameters does not change the derived one, and simulateSeason uses it", () => {
    expect(deriveSeed(state, scenario, { ...defaultOddsParams, seed: 5 })).toBe(deriveSeed(state, scenario, defaultOddsParams));
    expect(simulateSeason(state, scenario, { nSims: 10 }).seed).toBe(deriveSeed(state, scenario, { ...defaultOddsParams, nSims: 10 }));
    expect(simulateSeason(state, scenario, { nSims: 10, seed: 5 }).seed).toBe(5);
  });

  test("paceStages: 0 gives the exact same seed as omitting it (legacy compatibility)", () => {
    // When paceStages is 0 it is stripped before hashing, so an old client that never sent paceStages
    // gets the same seed as a new client that explicitly sets it to 0.
    const paramsWithZero = { ...defaultOddsParams, paceStages: 0 };
    const { paceStages: _ignored, ...paramsWithout } = paramsWithZero;
    expect(deriveSeed(state, scenario, paramsWithZero)).toBe(
      deriveSeed(state, scenario, paramsWithout as OddsParams),
    );
    // The current default (paceStages=5) gives a different seed than paceStages=0
    expect(deriveSeed(state, scenario, defaultOddsParams)).not.toBe(
      deriveSeed(state, scenario, { ...defaultOddsParams, paceStages: 0 }),
    );
  });

  test("with paceStages: 0 simulation results are identical to omitting it", () => {
    const r1 = simulateSeason(state, scenario, { nSims: 100, seed: 999 });
    const r2 = simulateSeason(state, scenario, { nSims: 100, seed: 999, paceStages: 0 });
    expect(r2.driverWins).toEqual(r1.driverWins);
    expect(r2.teamWins).toEqual(r1.teamWins);
    expect(r2.driverPointSums).toEqual(r1.driverPointSums);
  });
});

// ---------- agreement with the exact engine ----------

describe("simulateSeason: agrees with the exact engine", () => {
  test("a driver the engine calls eliminated never wins; a clinched driver always wins", () => {
    const mixed = makeState({ rounds: 6, completed: 4, teams: teams4, results: races([1, 2, 3, 4]) });
    const clinched = makeState({ rounds: 6, completed: 5, teams: teams4, results: races([1, 2, 3, 4, 5]) });
    for (const [state, expectStatuses] of [
      [mixed, { AAA: "alive", BBB: "alive", CCC: "alive", DDD: "eliminated" }],
      [clinched, { AAA: "clinched", BBB: "eliminated", CCC: "eliminated", DDD: "eliminated" }],
    ] as const) {
      const res = simulateSeason(state, undefined, quick({ nSims: 3000, includeDnf: true }));
      for (const row of driverStatus(state)) {
        expect(row.status).toBe(expectStatuses[row.driver as keyof typeof expectStatuses]);
        if (row.status === "eliminated") expect(res.driverWins[row.driver]).toBe(0);
        if (row.status === "clinched") expect(res.driverWins[row.driver]).toBe(3000);
      }
    }
  });

  test("with nothing left to run the outcome is deterministic and equals the standings leader", () => {
    const state = makeState({
      rounds: 3, completed: 3, teams: teams4,
      results: { "1:race": ["BBB", "AAA", "CCC", "DDD"], "2:race": ["CCC", "BBB", "AAA", "DDD"], "3:race": ["BBB", "CCC", "AAA", "DDD"] },
    });
    const res = simulateSeason(state, undefined, quick({ nSims: 500, includeDnf: true }));
    const leader = computeDriverStandings(state)[0]!.id;
    expect(res.driverWins[leader]).toBe(500);
    expect(res.teamWins[computeConstructorStandings(state)[0]!.id]).toBe(500);
    // the final points are the points in the table, every time
    for (const row of computeDriverStandings(state)) expect(res.driverPointSums[row.id]).toBe(500 * row.points);
  });

  test("a tie at the top is settled by countback exactly as in the standings (all 576 ways to lock two sessions)", () => {
    // After rounds 1-2, AAA and BBB are level on points and on wins and seconds; qualifying separates some pairs.
    const state = makeState({
      rounds: 4, completed: 2,
      teams: { red: ["AAA", "CCC"], blue: ["BBB", "DDD"] },
      results: { "1:race": ["AAA", "BBB", "CCC", "DDD"], "2:race": ["BBB", "AAA", "DDD", "CCC"] },
      quali: { 1: ["BBB", "AAA", "CCC", "DDD"], 2: ["AAA", "BBB", "CCC", "DDD"] },
    });
    const perms = (xs: string[]): string[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    const all = perms(["AAA", "BBB", "CCC", "DDD"]);
    expect(all).toHaveLength(24);
    const lockOf = (p: string[]) => ({ fixed: Object.fromEntries(p.map((d, i) => [d, i + 1])) });
    let ties = 0;
    for (const p3 of all) {
      for (const p4 of all) {
        const scenario: Scenario = { locks: { "3:race": lockOf(p3), "4:race": lockOf(p4) } };
        const table = computeDriverStandings(state, scenario);
        if (table[0]!.points === table[1]!.points) ties++;
        const res = simulateSeason(state, scenario, { nSims: 2, seed: 3 });
        expect(res.driverWins[table[0]!.id]).toBe(2);
        expect(res.teamWins[computeConstructorStandings(state, scenario)[0]!.id]).toBe(2);
      }
    }
    expect(ties).toBeGreaterThan(20); // the property really exercises the tie-break
  });

  test("an inactive driver never wins and keeps his points", () => {
    const state = makeState({
      rounds: 3, completed: 2, teams: teams4,
      results: { "1:race": order4, "2:race": ["AAA", "BBB", "CCC"] }, // DDD is not in the latest round: inactive
    });
    const res = simulateSeason(state, undefined, quick({ nSims: 400 }));
    expect(state.drivers.find((d) => d.code === "DDD")!.active).toBe(false);
    expect(res.driverWins.DDD).toBe(0);
    expect(res.driverPointSums.DDD).toBe(400 * 12);
    // the three who race share 25 + 18 + 15 in the last race, every time
    const gains = ["AAA", "BBB", "CCC"].map((d) => (res.driverPointSums[d] ?? 0) - 400 * computeDriverStandings(state).find((r) => r.id === d)!.points);
    expect(sum(gains)).toBe(400 * 58);
  });
});

// ---------- the model ----------

describe("simulateSeason: the model", () => {
  test("two identical drivers get equal chances (within 3 standard errors)", () => {
    const state = makeState({
      rounds: 5, completed: 2, teams: { red: ["AAA"], blue: ["BBB"] },
      results: { "1:race": ["AAA", "BBB"], "2:race": ["BBB", "AAA"] },
    });
    const n = 10_000;
    const res = simulateSeason(state, undefined, quick({ nSims: n, recencyHalfLife: Infinity }));
    const se = Math.sqrt(0.25 / n);
    expect(Math.abs(share(res, "AAA") - 0.5)).toBeLessThan(3 * se);
    expect(Math.abs((res.teamWins.red ?? 0) / n - 0.5)).toBeLessThan(3 * se);
  });

  describe("form", () => {
    // Level on points, but BBB won the last two rounds and AAA the first two: BBB is in much better form.
    const state = makeState({
      rounds: 9, completed: 4, teams: { red: ["AAA"], blue: ["BBB"] },
      results: { "1:race": ["AAA", "BBB"], "2:race": ["AAA", "BBB"], "3:race": ["BBB", "AAA"], "4:race": ["BBB", "AAA"] },
    });
    const form = { nSims: 10_000, recencyHalfLife: 0.5, priorStrength: 0.01 };

    test("a much faster driver wins almost always", () => {
      expect(share(simulateSeason(state, undefined, quick(form)), "BBB")).toBeGreaterThan(0.95);
    });

    test("formWeight 0 makes the drivers equal", () => {
      const res = simulateSeason(state, undefined, quick({ ...form, formWeight: 0 }));
      expect(Math.abs(share(res, "BBB") - 0.5)).toBeLessThan(3 * Math.sqrt(0.25 / 10_000));
    });

    test("formWeight in between gives something in between", () => {
      const p = (formWeight: number) => share(simulateSeason(state, undefined, quick({ ...form, formWeight })), "BBB");
      expect(p(0)).toBeLessThan(p(0.5));
      expect(p(0.5)).toBeLessThan(p(1));
    });
  });

  describe("retirements", () => {
    // BBB won every race and AAA retired every time: AAA has the worse record but equal pace data (none).
    const state = makeState({
      rounds: 5, completed: 3, teams: { red: ["AAA"], blue: ["BBB"] },
      results: Object.fromEntries([1, 2, 3].map((r) => [`${r}:race`, { order: ["BBB", "AAA"], dnf: ["AAA"] }])),
    });
    const base = (d: string) => computeDriverStandings(state).find((r) => r.id === d)!.points;

    test("a driver with a record of retirements scores less when retirements are on", () => {
      const on = simulateSeason(state, undefined, { nSims: 10_000, seed: 1, includeDnf: true });
      expect(gain(on, "BBB", base("BBB"))).toBeGreaterThan(gain(on, "AAA", base("AAA")) + 5);
    });

    test("includeDnf false gives equal pace-equal drivers equal points", () => {
      const off = simulateSeason(state, undefined, { nSims: 10_000, seed: 1, includeDnf: false });
      expect(Math.abs(gain(off, "BBB", base("BBB")) - gain(off, "AAA", base("AAA")))).toBeLessThan(0.4);
    });

    test("retirees score nothing: with retirements on the two drivers share less than the 86 points of two races", () => {
      const off = simulateSeason(state, undefined, { nSims: 2000, seed: 1, includeDnf: false });
      const on = simulateSeason(state, undefined, { nSims: 2000, seed: 1, includeDnf: true });
      const total = (r: SimulationResult) => gain(r, "AAA", base("AAA")) + gain(r, "BBB", base("BBB"));
      expect(total(off)).toBe(2 * 43); // both always finish: 25 + 18 in each of the two races
      expect(total(on)).toBeLessThan(2 * 43 - 5);
    });

    test("in a locked session the drivers left free can still retire, and then score nothing", () => {
      const scenario: Scenario = { locks: { "4:race": { fixed: { AAA: 1 } }, "5:race": { fixed: { AAA: 1 } } } };
      const run = (includeDnf: boolean) => simulateSeason(state, scenario, { nSims: 4000, seed: 1, includeDnf });
      // BBB is free in both races: P2 (18 points) unless he retires
      expect(gain(run(false), "BBB", base("BBB"))).toBe(2 * 18);
      expect(gain(run(true), "BBB", base("BBB"))).toBeLessThan(2 * 18 - 5);
      // the fixed driver never retires
      expect(gain(run(true), "AAA", base("AAA"))).toBe(2 * 25);
    });

    test("a sprint is retired from less often (sprintDnfFactor)", () => {
      // Two sprint-free races locked, so only the sprint of round 4 is open.
      const withSprint = makeState({
        rounds: 5, sprints: [4], completed: 3, teams: { red: ["AAA"], blue: ["BBB"] },
        results: Object.fromEntries([1, 2, 3].map((r) => [`${r}:race`, { order: ["BBB", "AAA"], dnf: ["AAA"] }])),
      });
      const scenario: Scenario = {
        locks: { "4:race": { fixed: { AAA: 1, BBB: 2 } }, "5:race": { fixed: { AAA: 1, BBB: 2 } } },
      };
      const b = (d: string) => computeDriverStandings(withSprint, scenario).find((r) => r.id === d)!.points;
      const gap = (sprintDnfFactor: number) => {
        const r = simulateSeason(withSprint, scenario, { nSims: 10_000, seed: 2, includeDnf: true, sprintDnfFactor });
        return gain(r, "BBB", b("BBB")) - gain(r, "AAA", b("AAA"));
      };
      expect(Math.abs(gap(0))).toBeLessThan(0.5);
      expect(gap(0.5)).toBeGreaterThan(gap(0) + 1);
      expect(gap(1)).toBeGreaterThan(gap(0.5) + 1);
    });
  });
});

// ---------- locks ----------

describe("simulateSeason: locks", () => {
  describe("a lock changes the odds", () => {
    // Three drivers, each has finished first, second and third once: level on points, equal pace.
    const state = makeState({
      rounds: 6, completed: 3, teams: { red: ["AAA"], blue: ["BBB"], green: ["CCC"] },
      results: { "1:race": ["AAA", "BBB", "CCC"], "2:race": ["BBB", "CCC", "AAA"], "3:race": ["CCC", "AAA", "BBB"] },
    });
    const keys = ["4:race", "5:race", "6:race"] as const;
    const lockAll = (fixed: Record<string, number | "out">): Scenario => ({
      locks: Object.fromEntries(keys.map((k) => [k, { fixed }])),
    });
    const opts = quick({ nSims: 4000, recencyHalfLife: Infinity });

    test("locking X on P1 in every remaining session raises X's chance", () => {
      const baseline = share(simulateSeason(state, undefined, opts), "CCC");
      const locked = share(simulateSeason(state, lockAll({ CCC: 1 }), opts), "CCC");
      expect(baseline).toBeGreaterThan(0.2);
      expect(baseline).toBeLessThan(0.5);
      expect(locked).toBeGreaterThan(baseline);
      expect(locked).toBe(1);
    });

    test("marking X out lowers X's chance", () => {
      const baseline = share(simulateSeason(state, undefined, opts), "CCC");
      const out = share(simulateSeason(state, lockAll({ CCC: "out" }), opts), "CCC");
      expect(out).toBeLessThan(baseline);
    });
  });

  describe("a fixed position appears in every simulation (summed points make it visible)", () => {
    const state = makeState({ rounds: 3, completed: 2, teams: teams4, results: races([1, 2]) });
    const base = Object.fromEntries(computeDriverStandings(state).map((r) => [r.id, r.points]));
    const n = 300;

    test("fixed positions score their points every time; the others fill the free places in order", () => {
      const scenario: Scenario = { locks: { "3:race": { fixed: { BBB: 1, CCC: 2 } } } };
      const res = simulateSeason(state, scenario, quick({ nSims: n }));
      expect(res.driverPointSums.BBB).toBe(n * (base.BBB! + 25));
      expect(res.driverPointSums.CCC).toBe(n * (base.CCC! + 18));
      // AAA and DDD take P3 and P4 between them: 15 + 12
      expect((res.driverPointSums.AAA ?? 0) + (res.driverPointSums.DDD ?? 0)).toBe(n * (base.AAA! + base.DDD! + 27));
    });

    test("a position that is not P1 does not move points around", () => {
      const scenario: Scenario = { locks: { "3:race": { fixed: { DDD: 3 } } } };
      const res = simulateSeason(state, scenario, quick({ nSims: n }));
      expect(res.driverPointSums.DDD).toBe(n * (base.DDD! + 15));
      const others = ["AAA", "BBB", "CCC"].reduce((s, d) => s + (res.driverPointSums[d] ?? 0) - n * base[d]!, 0);
      expect(others).toBe(n * (25 + 18 + 12));
    });

    test("out means no points", () => {
      const scenario: Scenario = { locks: { "3:race": { fixed: { AAA: "out", BBB: 1, CCC: 2, DDD: 3 } } } };
      const res = simulateSeason(state, scenario, quick({ nSims: n }));
      expect(res.driverPointSums.AAA).toBe(n * base.AAA!);
      expect(res.driverPointSums.BBB).toBe(n * (base.BBB! + 25));
    });

    test("a lock's tier applies to a locked race", () => {
      const scenario: Scenario = { locks: { "3:race": { fixed: { AAA: 1, BBB: 2, CCC: 3, DDD: 4 }, tier: "ge50" } } };
      const res = simulateSeason(state, scenario, quick({ nSims: n }));
      expect(res.driverPointSums.AAA).toBe(n * (base.AAA! + 19));
      expect(res.driverPointSums.BBB).toBe(n * (base.BBB! + 14));
      expect(res.driverPointSums.CCC).toBe(n * (base.CCC! + 12));
      expect(res.driverPointSums.DDD).toBe(n * (base.DDD! + 10));
    });

    test("sprints use the sprint table", () => {
      const sprintState = makeState({ rounds: 3, sprints: [3], completed: 2, teams: teams4, results: races([1, 2]) });
      const scenario: Scenario = {
        locks: {
          "3:sprint": { fixed: { AAA: 1, BBB: 2, CCC: 3, DDD: 4 } },
          "3:race": { fixed: { DDD: 1, CCC: 2, BBB: 3, AAA: 4 } },
        },
      };
      const res = simulateSeason(sprintState, scenario, quick({ nSims: n }));
      const b = Object.fromEntries(computeDriverStandings(sprintState).map((r) => [r.id, r.points]));
      expect(res.driverPointSums.AAA).toBe(n * (b.AAA! + 8 + 12));
      expect(res.driverPointSums.DDD).toBe(n * (b.DDD! + 5 + 25));
      // and it matches what the exact engine projects
      for (const row of computeDriverStandings(sprintState, scenario)) expect(res.driverPointSums[row.id]).toBe(n * row.points);
    });
  });

  test("constructor points go to each driver's latest team", () => {
    const state = makeState({
      rounds: 3, completed: 2, teams: teams4,
      teamChanges: [{ driver: "DDD", team: "red", fromRound: 2 }],
      results: races([1, 2]),
    });
    const scenario: Scenario = { locks: { "3:race": { fixed: { DDD: 1, AAA: 2, BBB: 3, CCC: 4 } } } };
    const n = 100;
    const res = simulateSeason(state, scenario, quick({ nSims: n }));
    const projected = Object.fromEntries(computeConstructorStandings(state, scenario).map((r) => [r.id, r.points]));
    expect(res.teamPointSums.red).toBe(n * projected.red!);
    expect(res.teamPointSums.blue).toBe(n * projected.blue!);
    // red picked up DDD's 25 as well as AAA's 18 and BBB's 15
    expect(projected.red! - computeConstructorStandings(state).find((r) => r.id === "red")!.points).toBe(58);
  });
});

// ---------- the real fixture ----------

describe("simulateSeason: the Round 16 fixture", () => {
  const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;

  test("10,000 simulations of the 8 sessions left take under 3 seconds", () => {
    const t0 = performance.now();
    const res = simulateSeason(state, undefined, { nSims: 10_000, seed: 1 });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(3000);
    expect(sum(Object.values(res.driverWins))).toBe(10_000);
    expect(sum(Object.values(res.teamWins))).toBe(10_000);
  });

  test("the leader is almost certain to win, and eliminated drivers never do", () => {
    const res = simulateSeason(state, undefined, { nSims: 10_000, seed: 2 });
    const leader = driverStatus(state)[0]!;
    expect(share(res, leader.driver)).toBeGreaterThan(0.95);
    for (const row of driverStatus(state)) if (row.status === "eliminated") expect(res.driverWins[row.driver]).toBe(0);
    expect(res.driverWins.TSU).toBe(0);
  });
});
