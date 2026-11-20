/** Phase 11, Step 1 (D62): the previous season as a prior for the strength fit. */
import { describe, expect, test } from "bun:test";
import { computeOdds } from "../engine/odds";
import { forecastRace } from "../engine/simulate";
import { fitStrengths } from "../engine/strength";
import type { SeasonState, SessionKey } from "../engine/types";
import { makeState } from "./helpers";

const teams = { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] };
const order = ["AAA", "BBB", "CCC", "DDD"];

/** A 2026 state with `completed` rounds done, each finishing in `finishOrder`. */
function season2026(completed: number, finishOrder: string[] = order, teams2026: Record<string, string[]> = teams): SeasonState {
  const results = Object.fromEntries(
    Array.from({ length: completed }, (_, i) => [`${i + 1}:race`, finishOrder]),
  ) as Record<SessionKey, string[]>;
  return makeState({ season: 2026, rounds: 6, completed, teams: teams2026, results });
}

/** 2025 (the previous season): `rounds` races, each finishing in `finishOrder`; optional sprints. */
function season2025(finishOrder: string[] = order, rounds = 5): SeasonState {
  const results = Object.fromEntries(
    Array.from({ length: rounds }, (_, i) => [`${i + 1}:race`, finishOrder]),
  ) as Record<SessionKey, string[]>;
  return makeState({ season: 2025, rounds, completed: rounds, teams, results });
}

/** 2026 before its first race: everyone is on the grid, as the loader has it (D60). */
function beforeFirstRace(teams2026: Record<string, string[]> = teams): SeasonState {
  const state = makeState({ season: 2026, rounds: 6, teams: teams2026 });
  return { ...state, drivers: state.drivers.map((d) => ({ ...d, active: true })) };
}

const withPrior = (state: SeasonState, prior: SeasonState): SeasonState => ({ ...state, prior });

describe("carryover", () => {
  test("carryover 0, or no previous season, leaves every number and seed as it was", () => {
    const base = season2026(3);
    const prior = season2025(["DDD", "CCC", "BBB", "AAA"]);
    const carried = withPrior(base, prior);

    expect(fitStrengths(carried)).toEqual(fitStrengths(base));
    expect(computeOdds(carried, undefined, { nSims: 300 })).toEqual(computeOdds(base, undefined, { nSims: 300 }));
    expect(forecastRace(carried, { nSims: 300 })).toEqual(forecastRace(base, { nSims: 300 }));
  });

  test("a carried session weighs priorCarryover times the decay at priorSeasonGap", () => {
    // 5 carried races, aged as if 8 rounds before round 1, half-life 8: 5 * 0.5 * 0.5 ** (8 / 8)
    const fit = fitStrengths(withPrior(beforeFirstRace(), season2025()), { priorCarryover: 0.5 });
    expect(fit.effectiveRaces.AAA).toBeCloseTo(5 * 0.5 * 0.5, 12);
  });

  test("a dominant previous season gives that driver the best win odds before round 1", () => {
    const prior = season2025(order);
    const odds = computeOdds(withPrior(beforeFirstRace(), prior), undefined, { nSims: 2000, priorCarryover: 0.5 });
    expect(odds.wdc[0]?.id).toBe("AAA");

    // without the carryover every driver is equal before round 1
    const flat = computeOdds(beforeFirstRace(), undefined, { nSims: 2000 });
    const p = (r: typeof odds, code: string) => r.wdc.find((x) => x.id === code)?.probability ?? 0;
    expect(p(odds, "AAA")).toBeGreaterThan(p(flat, "AAA"));
  });

  test("the effect fades as the new season's results come in", () => {
    const prior = season2025(order);
    const behind = ["DDD", "CCC", "BBB", "AAA"];
    const theta = [0, 2, 4].map((rounds) => fitStrengths(withPrior(season2026(rounds, behind), prior), { priorCarryover: 0.5 }).theta.AAA!);
    expect(theta[0]).toBeGreaterThan(0);
    expect(theta[1]).toBeLessThan(theta[0]!);
    expect(theta[2]).toBeLessThan(theta[1]!);
  });

  test("a driver with no previous results is unaffected", () => {
    const teamsWithRookie = { ...teams, green: ["NEW"] };
    const fit = fitStrengths(withPrior(beforeFirstRace(teamsWithRookie), season2025()), { priorCarryover: 0.5 });
    expect(fit.theta.NEW).toBe(0);
    expect(fit.effectiveRaces.NEW).toBe(0);
  });

  test("same team only: a driver who changed constructor keeps none of the carried results", () => {
    const prior = season2025(["BBB", "AAA", "CCC", "DDD"]);
    const state = makeState({
      season: 2026, rounds: 6, completed: 1, teams,
      teamChanges: [{ driver: "BBB", team: "blue", fromRound: 1 }],
      results: { "1:race": order },
    });
    const priorWithoutBBB: SeasonState = { ...prior, results: prior.results.filter((r) => r.driver !== "BBB") };
    const sameTeam = fitStrengths(withPrior(state, prior), { priorCarryover: 0.5, priorSameTeamOnly: true });
    const dropped = fitStrengths(withPrior(state, priorWithoutBBB), { priorCarryover: 0.5 });
    expect(sameTeam).toEqual(dropped);
    // with the "all" rule the same results do count
    const all = fitStrengths(withPrior(state, prior), { priorCarryover: 0.5 });
    expect(all.theta.BBB!).toBeGreaterThan(sameTeam.theta.BBB!);
  });

  test("carried sprints count at sprintWeight", () => {
    const prior = season2025();
    const withSprint: SeasonState = {
      ...prior,
      results: [
        ...prior.results,
        // AAA last in the sprint, so a heavier sprint lowers AAA
        { round: 5, kind: "sprint", driver: "BBB", team: "red", position: 1, grid: 1, points: 8, classified: true },
        { round: 5, kind: "sprint", driver: "CCC", team: "blue", position: 2, grid: 2, points: 7, classified: true },
        { round: 5, kind: "sprint", driver: "DDD", team: "blue", position: 3, grid: 3, points: 6, classified: true },
        { round: 5, kind: "sprint", driver: "AAA", team: "red", position: 4, grid: 4, points: 5, classified: true },
      ],
    };
    const gap = (sprintWeight: number) =>
      fitStrengths(withPrior(beforeFirstRace(), withSprint), { priorCarryover: 0.5, sprintWeight }).theta.AAA!;
    expect(gap(0.5)).toBeLessThan(gap(0));
    expect(gap(1)).toBeLessThan(gap(0.5));
  });

  test("a previous season that is not exactly one season earlier is refused", () => {
    const state = season2026(1);
    for (const season of [2024, 2027]) {
      expect(() => fitStrengths(withPrior(state, { ...season2025(), season }), { priorCarryover: 0.5 })).toThrow(RangeError);
    }
  });

  test("the same seed gives the same result", () => {
    const state = withPrior(season2026(2), season2025());
    expect(computeOdds(state, undefined, { nSims: 500, seed: 9 })).toEqual(computeOdds(state, undefined, { nSims: 500, seed: 9 }));
  });

  test("nonsense parameters are refused", () => {
    const state = withPrior(season2026(1), season2025());
    expect(() => fitStrengths(state, { priorCarryover: 1.5 })).toThrow(RangeError);
    expect(() => fitStrengths(state, { priorCarryover: -0.1 })).toThrow(RangeError);
    expect(() => fitStrengths(state, { priorCarryover: Number.NaN })).toThrow(RangeError);
    expect(() => fitStrengths(state, { priorSeasonGap: -1 })).toThrow(RangeError);
    expect(() => fitStrengths(state, { priorSeasonGap: Number.NaN })).toThrow(RangeError);
  });
});
