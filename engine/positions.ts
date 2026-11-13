/**
 * The highest place an entry can still reach on points alone (Phase 7, decision D43). Pure.
 *
 *   best = 1 + the number of OTHER entries whose points are strictly greater than this entry's ceiling
 *
 * The ceiling is the entry's projected points plus the most it can still score in the sessions that are
 * open in the scenario (for a driver or team that is not racing, the ceiling is simply its points).
 * It is the same rule for drivers and for teams, so the table, the feed and the CLI share one function.
 *
 * It is a FLOOR on the place: an entry whose points already exceed this ceiling is above it in every
 * scenario, so the entry cannot finish higher than `best`. Reaching `best` is possible on points alone,
 * but the rule does not check that all rivals can be held back at the same time, and a tie on points is
 * not "strictly greater" (the countback is not applied). There is deliberately no worst place: with a
 * points-only bound it would be far too loose (see docs/PHASE_7.md).
 */
import type { DriverStatusRow } from "./status";
import type { TeamStatusRow } from "./teamStatus";

export interface PositionEntry {
  /** driver code, or constructor id */
  id: string;
  /** projected points, locks included */
  points: number;
  /** the most points the entry can still reach: points plus what it can score in the open sessions */
  ceiling: number;
}

/**
 * Entry id -> best place (1-based). Does not modify its input and never throws; an empty list gives an
 * empty map. The order of the input does not matter. An entry never counts itself.
 */
export function bestPositions(entries: readonly PositionEntry[]): Map<string, number> {
  const best = new Map<string, number>();
  entries.forEach((entry, i) => {
    let above = 0;
    entries.forEach((other, j) => {
      if (j !== i && other.points > entry.ceiling) above++;
    });
    best.set(entry.id, 1 + above);
  });
  return best;
}

/** Entries for `bestPositions` from `driverStatus` rows: the ceiling is `maxPossible`. */
export function driverPositionEntries(rows: readonly DriverStatusRow[]): PositionEntry[] {
  return rows.map((r) => ({ id: r.driver, points: r.points, ceiling: r.maxPossible }));
}

/** Entries for `bestPositions` from `teamStatus` rows: the ceiling is `maxPossible`. */
export function teamPositionEntries(rows: readonly TeamStatusRow[]): PositionEntry[] {
  return rows.map((r) => ({ id: r.team, points: r.points, ceiling: r.maxPossible }));
}
