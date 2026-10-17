/**
 * Building blocks for the constructors' title (Phase 5, Step 1): a team's cars, the most it can score in
 * one session, and the witness scenario "this team's cars take the top places". Pure.
 */
import { gpPoints, sprintPoints, zoneSize } from "./points";
import { parseSessionKey, remainingSessions } from "./sessions";
import type { Scenario, SeasonState, SessionKind } from "./types";

/**
 * Team id -> its active cars (drivers present in the latest completed round, by their latest team),
 * best driver first: current driver points (real results only), then driver code.
 * Every team of the season has an entry; a team with no active driver has an empty list.
 */
export function teamCars(state: SeasonState): Map<string, string[]> {
  // latest team per driver: the result row of the highest round
  const latest = new Map<string, { round: number; team: string }>();
  const points = new Map<string, number>();
  for (const r of state.results) {
    points.set(r.driver, (points.get(r.driver) ?? 0) + r.points);
    const seen = latest.get(r.driver);
    if (!seen || r.round >= seen.round) latest.set(r.driver, { round: r.round, team: r.team });
  }

  const cars = new Map<string, string[]>(state.teams.map((t) => [t.id, []]));
  for (const d of state.drivers) {
    if (!d.active) continue;
    const team = latest.get(d.code)?.team;
    if (team === undefined) continue;
    const list = cars.get(team) ?? [];
    list.push(d.code);
    cars.set(team, list);
  }
  for (const list of cars.values()) {
    list.sort((a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  }
  return cars;
}

/** Points of the top `cars` places in one session: race 25 + 18 = 43, sprint 8 + 7 = 15 for two cars. */
export function teamSessionMax(cars: number, kind: SessionKind): number {
  let total = 0;
  for (let place = 1; place <= Math.min(cars, zoneSize(kind)); place++) {
    total += kind === "race" ? gpPoints(place) : sprintPoints(place);
  }
  return total;
}

/**
 * The scenario plus: the team's cars take P(1 + offset), P(2 + offset), ... in every remaining session the
 * scenario does not lock. Existing locks stay. A place beyond the points zone is stored as "out".
 * A team with no active car adds nothing. Throws RangeError for an unknown team. Does not modify its inputs.
 */
export function teamWitnessScenario(
  state: SeasonState,
  scenario: Scenario | undefined,
  team: string,
  offset = 0,
): Scenario {
  const cars = teamCars(state).get(team);
  if (cars === undefined) throw new RangeError(`unknown team: ${team}`);
  const locks: Scenario["locks"] = { ...(scenario?.locks ?? {}) };
  if (cars.length === 0) return { locks };
  for (const key of remainingSessions(state)) {
    if (key in locks) continue;
    const zone = zoneSize(parseSessionKey(key).kind);
    const fixed: Record<string, number | "out"> = {};
    cars.forEach((car, i) => {
      const place = 1 + offset + i;
      fixed[car] = place <= zone ? place : "out";
    });
    locks[key] = { fixed };
  }
  return { locks };
}
