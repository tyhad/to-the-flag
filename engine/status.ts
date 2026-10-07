/**
 * Title status per driver: clinched | alive | eliminated, decided exactly (no model, no probabilities).
 *
 * Both checks use one witness: "driver D wins every remaining session, everyone else unspecified".
 * Winning everything is never worse for D (swap D into P1: the displaced driver loses points and
 * countback only improves for D), so if D cannot rank first in that witness, D cannot be champion.
 * Witnesses go through computeDriverStandings, so ties follow the countback rules. Pure.
 *
 * - eliminated: D does not rank first in D's own witness. Inactive drivers are always eliminated.
 * - clinched:   D can be champion and no other driver can (every rival fails its own witness).
 * - alive:      otherwise.
 */
import { remainingSessions, activeDrivers } from "./sessions";
import { computeDriverStandings } from "./standings";
import type { Scenario } from "./types";
import type { SeasonState } from "./types";

export type TitleStatus = "clinched" | "alive" | "eliminated";

export interface DriverStatusRow {
  driver: string;
  status: TitleStatus;
  /** points including the scenario's locked sessions */
  points: number;
  /** points if the driver won every remaining unlocked session; equals points for inactive drivers */
  maxPossible: number;
  /** leader's points minus this driver's points (0 for the leader) */
  gapToLeader: number;
  /**
   * 0 when clinched, null when eliminated. Otherwise the points this driver must hold to be safe
   * against every rival scoring the maximum from here: highest rival maxPossible - points + 1 (at least 1).
   * Conservative: it ignores that the driver's own results take points away from rivals.
   */
  pointsToClinch: number | null;
}

/**
 * The scenario plus: `driver` wins every remaining session that is not already locked.
 * Sessions the scenario locks keep their lock. Does not modify its inputs.
 */
export function witnessScenario(state: SeasonState, scenario: Scenario | undefined, driver: string): Scenario {
  const locks: Scenario["locks"] = { ...(scenario?.locks ?? {}) };
  for (const key of remainingSessions(state)) {
    if (!(key in locks)) locks[key] = { fixed: { [driver]: 1 } };
  }
  return { locks };
}

/** One row per driver, in projected table order. Throws InvalidScenarioError for a bad scenario. */
export function driverStatus(state: SeasonState, scenario?: Scenario): DriverStatusRow[] {
  const table = computeDriverStandings(state, scenario); // validates the scenario
  const leaderPoints = table[0]?.points ?? 0;
  const active = new Set(activeDrivers(state));

  const maxPossible = new Map<string, number>();
  const canBeChampion = new Map<string, boolean>();
  for (const row of table) {
    if (!active.has(row.id)) {
      maxPossible.set(row.id, row.points);
      canBeChampion.set(row.id, false);
      continue;
    }
    const witness = computeDriverStandings(state, witnessScenario(state, scenario, row.id));
    maxPossible.set(row.id, witness.find((r) => r.id === row.id)?.points ?? row.points);
    canBeChampion.set(row.id, witness[0]?.id === row.id);
  }
  const contenders = table.filter((r) => canBeChampion.get(r.id) === true).length;

  return table.map((row) => {
    const can = canBeChampion.get(row.id) === true;
    const status: TitleStatus = !can ? "eliminated" : contenders === 1 ? "clinched" : "alive";
    let pointsToClinch: number | null;
    if (status === "eliminated") pointsToClinch = null;
    else if (status === "clinched") pointsToClinch = 0;
    else {
      const rivalCeiling = Math.max(
        ...table.filter((r) => r.id !== row.id).map((r) => maxPossible.get(r.id) ?? r.points),
      );
      pointsToClinch = Math.max(1, rivalCeiling - row.points + 1);
    }
    return {
      driver: row.id,
      status,
      points: row.points,
      maxPossible: maxPossible.get(row.id) ?? row.points,
      gapToLeader: leaderPoints - row.points,
      pointsToClinch,
    };
  });
}
