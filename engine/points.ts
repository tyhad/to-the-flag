/**
 * FIA 2026 points tables (Sporting Regulations, Section A, Issue 02, Art. A2.1 and A2.2).
 * Pure data and functions. No I/O.
 */

export type SessionKind = "race" | "sprint";

/**
 * Share of the scheduled GP distance completed by the leader.
 * lt25 = at least 2 laps but under 25%, ge25 = 25% or more, ge50 = 50% or more, full = 75% or more.
 */
export type DistanceTier = "lt25" | "ge25" | "ge50" | "full";

/** Points for P1..P10, per distance tier. Index 0 is P1. */
export const GP_POINTS: Readonly<Record<DistanceTier, readonly number[]>> = {
  lt25: [6, 4, 3, 2, 1, 0, 0, 0, 0, 0],
  ge25: [13, 10, 8, 6, 5, 4, 3, 2, 1, 0],
  ge50: [19, 14, 12, 10, 8, 6, 4, 3, 2, 1],
  full: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
};

/** Sprint points for P1..P8. Only one scale exists (leader completed at least 50%); otherwise 0. */
export const SPRINT_POINTS: readonly number[] = [8, 7, 6, 5, 4, 3, 2, 1];

function assertPosition(position: number): void {
  if (!Number.isInteger(position) || position < 1) {
    throw new RangeError(`position must be an integer >= 1, got ${position}`);
  }
}

/** Points for a finishing position in a Grand Prix. Positions beyond P10 score 0. */
export function gpPoints(position: number, tier: DistanceTier = "full"): number {
  assertPosition(position);
  const column = GP_POINTS[tier];
  if (column === undefined) {
    throw new RangeError(`unknown distance tier: ${String(tier)}`);
  }
  return column[position - 1] ?? 0;
}

/** Points for a finishing position in a Sprint. Positions beyond P8 score 0. */
export function sprintPoints(position: number): number {
  assertPosition(position);
  return SPRINT_POINTS[position - 1] ?? 0;
}

/** Most points one driver can score in one session: race 25, sprint 8. */
export function sessionMaxPoints(kind: SessionKind): number {
  return kind === "race" ? gpPoints(1) : sprintPoints(1);
}

/** Most points one team can score in one session (P1 + P2): race 43, sprint 15. */
export function teamSessionMaxPoints(kind: SessionKind): number {
  return kind === "race" ? gpPoints(1) + gpPoints(2) : sprintPoints(1) + sprintPoints(2);
}

/** Number of scoring positions: race 10, sprint 8. */
export function zoneSize(kind: SessionKind): number {
  return kind === "race" ? GP_POINTS.full.length : SPRINT_POINTS.length;
}
