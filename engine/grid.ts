/**
 * Starting grid rules (Phase 8, Step 1, decision D48). Pure: no DOM, no files, no database.
 *
 * The grid editor, the API and the model all need the same operations on a starting grid, so they live here and are
 * tested before any screen exists.
 *
 *  - A grid is two lists of driver codes: `order` (the start order, pole first) and `pit` (the pit-lane starters).
 *  - `gridFromOrder` turns them into the `Record<code, place>` the model reads (`SeasonState.upcomingGrid.grid`,
 *    `forecastRace`): places 1..N, and pit-lane starters get the places after everyone else, in the order given.
 *  - Every active driver (`activeDrivers`) must appear exactly once, in `order` or in `pit`.
 *  - Nothing is guessed: what cannot be read or is wrong is named in plain words.
 *  - No function modifies its input.
 */
import { activeDrivers } from "./sessions";
import type { SeasonState } from "./types";

/** A grid that cannot be used. `problems` has one plain-words sentence per problem. */
export class InvalidGridError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join(" "));
    this.name = "InvalidGridError";
    this.problems = problems;
  }
}

/** What `parseGridText` read. When `errors` is not empty, `order` and `pit` must not be used or saved. */
export interface ParsedGrid {
  order: string[];
  pit: string[];
  errors: string[];
}

/**
 * The problems with a grid, as plain sentences (an empty list means the grid is fine).
 * Checked in this order: codes that are not drivers, drivers who are not racing, codes listed twice,
 * and active drivers who are missing. The same list in a different order of codes gives the same sentences.
 */
export function gridProblems(state: SeasonState, order: readonly string[], pit: readonly string[] = []): string[] {
  const known = new Set(state.drivers.map((d) => d.code));
  const active = activeDrivers(state);
  const activeSet = new Set(active);
  const all = [...order, ...pit];

  const counts = new Map<string, number>();
  for (const code of all) counts.set(code, (counts.get(code) ?? 0) + 1);
  const listed = [...counts.keys()]; // first-appearance order, so the messages are stable

  const problems: string[] = [];
  for (const code of listed) {
    if (!known.has(code)) problems.push(`${code} is not a driver in this season.`);
  }
  for (const code of listed) {
    if (known.has(code) && !activeSet.has(code)) problems.push(`${code} is not racing, so it cannot be on the grid.`);
  }
  for (const code of listed) {
    const n = counts.get(code)!;
    if (n > 1) problems.push(`${code} is listed ${n} times.`);
  }
  const missing = active.filter((code) => !counts.has(code));
  if (missing.length > 0) problems.push(`Missing from the grid: ${missing.join(", ")}.`);
  return problems;
}

/** Throws `InvalidGridError` (with every problem named) unless every active driver appears exactly once. */
export function validateGrid(state: SeasonState, order: readonly string[], pit: readonly string[] = []): void {
  const problems = gridProblems(state, order, pit);
  if (problems.length > 0) throw new InvalidGridError(problems);
}

/**
 * The grid the model uses: driver code -> starting place, 1..N. The pit-lane starters get the places after everyone
 * else, in the order given (the same convention as the data file, where a pit-lane start counts as last).
 * Throws RangeError when a code is listed twice. It does not check who is racing: use `validateGrid` for that.
 */
export function gridFromOrder(order: readonly string[], pit: readonly string[] = []): Record<string, number> {
  const grid: Record<string, number> = {};
  [...order, ...pit].forEach((code, i) => {
    if (code in grid) throw new RangeError(`${code} is listed twice.`);
    grid[code] = i + 1;
  });
  return grid;
}

function indexOfDriver(order: readonly string[], driver: string): number {
  const i = order.indexOf(driver);
  if (i < 0) throw new RangeError(`${driver} is not in the grid order.`);
  return i;
}

function moved(order: readonly string[], from: number, to: number): string[] {
  const next = [...order];
  const [driver] = next.splice(from, 1);
  next.splice(to, 0, driver!);
  return next;
}

/**
 * "Drop N places": the driver moves N places back, and the drivers they pass each move up one place.
 * At most N: a drop past the end stops at the back of the grid. N is a whole number of 0 or more (RangeError otherwise).
 */
export function dropPlaces(order: readonly string[], driver: string, n: number): string[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`Places to drop must be a whole number of 0 or more, got ${n}.`);
  const from = indexOfDriver(order, driver);
  return moved(order, from, Math.min(order.length - 1, from + n));
}

/** The driver goes to the last place; everyone behind them moves up one place. */
export function backOfGrid(order: readonly string[], driver: string): string[] {
  const from = indexOfDriver(order, driver);
  return moved(order, from, order.length - 1);
}

/** The driver goes to `place` (1 is pole); the drivers in between each move one place. RangeError unless 1 <= place <= N. */
export function moveTo(order: readonly string[], driver: string, place: number): string[] {
  if (!Number.isInteger(place) || place < 1 || place > order.length) {
    throw new RangeError(`Place must be a whole number from 1 to ${order.length}, got ${place}.`);
  }
  return moved(order, indexOfDriver(order, driver), place - 1);
}

/** The pit-lane marker in pasted text: `PIT:`, `pit lane:`, `Pit-lane:` (the colon is required). */
const PIT_MARKER = /pit[\s_-]*(?:lane)?[\s_-]*:/gi;

/**
 * Reads a pasted starting grid: driver codes separated by spaces, commas, semicolons or lines (any case), each with an
 * optional place number in front ("1 ANT", "1. ANT", "1) ANT", "1.ANT"). The codes after a pit-lane marker
 * (`PIT:`) are the pit-lane starters.
 *
 * Nothing is guessed. A token that is not a driver code of this season, a number with no code after it, a number that
 * does not match the place of its entry, and a second pit-lane marker are all reported in `errors`. Who is missing or
 * listed twice is not checked here: that is `validateGrid`.
 */
export function parseGridText(text: string, state: SeasonState): ParsedGrid {
  const byUpper = new Map(state.drivers.map((d) => [d.code.toUpperCase(), d.code]));
  const parts = text.split(PIT_MARKER);
  const order: string[] = [];
  const pit: string[] = [];
  const errors: string[] = [];
  if (parts.length > 2) errors.push('There is more than one pit-lane marker. Use a single "PIT:" before the pit-lane starters.');

  parts.forEach((part, partIndex) => {
    const target = partIndex === 0 ? order : pit;
    let pending: number | null = null;

    const addWord = (word: string, label: number | null) => {
      const code = byUpper.get(word.toUpperCase());
      if (code === undefined) {
        errors.push(/^[A-Za-z]{3}$/.test(word) ? `${word.toUpperCase()} is not a driver code in this season.` : `Could not read "${word}".`);
        return;
      }
      const place = order.length + pit.length + 1;
      if (label !== null && label !== place) errors.push(`${code} is numbered ${label}, but it is entry ${place} in the list.`);
      target.push(code);
    };
    const flushPending = () => {
      if (pending !== null) errors.push(`Number ${pending} has no driver after it.`);
      pending = null;
    };

    for (const token of part.split(/[\s,;]+/).filter(Boolean)) {
      const lone = /^(\d+)[.):]?$/.exec(token);
      if (lone) {
        flushPending();
        pending = Number(lone[1]);
        continue;
      }
      const joined = /^(\d+)[.):]?([A-Za-z]+)$/.exec(token);
      if (joined) {
        flushPending();
        addWord(joined[2]!, Number(joined[1]));
        continue;
      }
      addWord(token, pending);
      pending = null;
    }
    flushPending();
  });

  if (order.length + pit.length === 0 && errors.length === 0) errors.push("The list is empty.");
  return { order, pit, errors };
}
