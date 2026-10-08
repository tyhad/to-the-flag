/**
 * FIA 2026 Sporting Regulations A2.1.4.c countback, for drivers and teams alike.
 * Equal points: most first places in a race, then most seconds, thirds, and so on (every position,
 * also outside the points zone); still equal: the same on the season's qualifying positions.
 * "In a race" means Grand Prix races, so sprint results are left out unless includeSprint is set.
 * Pure. No I/O.
 */

export interface CountbackOptions {
  /** Count sprint finishes as race finishes. FIA: false. */
  includeSprint: boolean;
}

export const DEFAULT_COUNTBACK: Readonly<CountbackOptions> = { includeSprint: false };

/** Index i holds how many times the entity finished (or qualified) in position i + 1. */
export interface PositionCounts {
  race: number[];
  quali: number[];
}

export function emptyCounts(): PositionCounts {
  return { race: [], quali: [] };
}

export function addPosition(counts: number[], position: number): void {
  if (!Number.isInteger(position) || position < 1) {
    throw new RangeError(`position must be an integer >= 1, got ${position}`);
  }
  while (counts.length < position) counts.push(0);
  counts[position - 1] = (counts[position - 1] ?? 0) + 1;
}

/** Negative when `a` has more at the first differing position, i.e. `a` ranks ahead. */
function compareLevels(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface Rankable {
  points: number;
  counts: PositionCounts;
}

/**
 * Sort comparator: negative when `a` ranks ahead of `b`, positive when behind, 0 when still equal
 * after qualifying counts (the caller then falls back to a stable order such as the id).
 */
export function compareStanding(a: Rankable, b: Rankable): number {
  if (a.points !== b.points) return b.points - a.points;
  return compareLevels(a.counts.race, b.counts.race) || compareLevels(a.counts.quali, b.counts.quali);
}
