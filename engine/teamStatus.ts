/**
 * Title status per team: clinched | alive | eliminated, decided exactly (no model, no probabilities).
 * The constructors' twin of status.ts (Phase 5, Step 2).
 *
 * Both checks use one witness: "team T's active cars take P1 and P2 in every open session, everyone else
 * unspecified" (see teamWitnessScenario). A one-two is never worse for T than any other arrangement:
 * moving T's cars up only pushes other drivers down, and T's countback improves. So if T cannot rank
 * first in that witness, T cannot be champion. Witnesses go through computeConstructorStandings, so
 * ties follow the countback rules (both cars' finishes are summed). Pure.
 *
 * - eliminated: T does not rank first in its own witness. A team with no active car is always eliminated.
 * - clinched:   T can be champion and no other team can.
 * - alive:      otherwise.
 */
import { computeConstructorStandings } from "./standings";
import type { TitleStatus } from "./status";
import { teamCars, teamWitnessScenario } from "./teams";
import type { Scenario, SeasonState } from "./types";

export interface TeamStatusRow {
  team: string;
  status: TitleStatus;
  /** points including the scenario's locked sessions */
  points: number;
  /** points if the team's cars took P1 and P2 in every open session; equals points with no active car */
  maxPossible: number;
  /** leader's points minus this team's points (0 for the leader) */
  gapToLeader: number;
  /**
   * 0 when clinched, null when eliminated. Otherwise the points this team must hold to be safe against
   * every rival scoring the maximum from here: highest rival maxPossible - points + 1 (at least 1).
   * Conservative: it ignores that the team's own results take points away from rivals.
   */
  pointsToClinch: number | null;
}

/** One row per team, in projected table order. Throws InvalidScenarioError for a bad scenario. */
export function teamStatus(state: SeasonState, scenario?: Scenario): TeamStatusRow[] {
  const table = computeConstructorStandings(state, scenario); // validates the scenario
  const leaderPoints = table[0]?.points ?? 0;
  const cars = teamCars(state);

  const maxPossible = new Map<string, number>();
  const canBeChampion = new Map<string, boolean>();
  for (const row of table) {
    if ((cars.get(row.id)?.length ?? 0) === 0) {
      maxPossible.set(row.id, row.points);
      canBeChampion.set(row.id, false);
      continue;
    }
    const witness = computeConstructorStandings(state, teamWitnessScenario(state, scenario, row.id));
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
      team: row.id,
      status,
      points: row.points,
      maxPossible: maxPossible.get(row.id) ?? row.points,
      gapToLeader: leaderPoints - row.points,
      pointsToClinch,
    };
  });
}
