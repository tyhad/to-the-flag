/**
 * Where a season stands (Phase 10, Step 1, D60). Pure.
 *
 * - complete:    no session is left to run: every race, and every sprint of a sprint weekend, has a result.
 * - not-started: no round has a result yet (and the season is not complete).
 * - running:     everything in between, including a weekend whose sprint has run and whose race has not.
 *
 * The engine itself needs no special case for either edge state (every table, status and path is computed from the
 * results and the remaining sessions); this is what the API and the UI ask before they choose their words.
 */
import { remainingSessions } from "./sessions";
import type { SeasonState } from "./types";

export type SeasonPhase = "not-started" | "running" | "complete";

/** True when no session is left to run. A calendar with no round is never complete. */
export function isSeasonComplete(state: SeasonState): boolean {
  return state.rounds.length > 0 && remainingSessions(state).length === 0;
}

export function seasonPhase(state: SeasonState): SeasonPhase {
  if (isSeasonComplete(state)) return "complete";
  return state.results.length === 0 ? "not-started" : "running";
}
